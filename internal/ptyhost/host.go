// Package ptyhost starts processes in a pseudo terminal owned by the daemon
// rather than by a terminal window. That way the session survives the window
// being closed.
//
// The PTY binding goes through go-pty because it offers one API for Unix PTYs
// and Windows ConPTY. creack/pty cannot do Windows, and os/exec alone is not
// enough there: ConPTY needs a process attribute os/exec cannot set
// (golang/go#62708).
package ptyhost

import (
	"bytes"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"plxr/internal/shell"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aymanbagabas/go-pty"
)

// Scrollback per session. Older output falls off the back.
const MaxBuf = 2 << 20

// Version is set at startup and ends up in TERM_PROGRAM_VERSION.
var Version = "dev"

// notInherited is extended below: we set TERM and relatives ourselves.

type Host struct {
	ID  string
	TTY string
	PID int

	pty pty.Pty
	cmd *pty.Cmd

	mu     sync.Mutex
	buf    []byte
	subs   map[*Viewer]struct{}
	alive  bool
	frozen bool
	exit   int
	last   time.Time // last output — the basis of the quiet heuristic

	// rows and cols are the size the terminal is set to, see wantedSizeLocked.
	rows, cols uint16

	/* Cache for the rendered preview, see tailLines.
	 *
	 * Keyed on how much has ever been written, not on how long the ring is:
	 * pump trims the ring to exactly MaxBuf, so once it is full that length
	 * never changes again and the cache was never invalidated after the first
	 * two megabytes. The tile then showed the same frame for the rest of the
	 * session — and since the status is read off that same text, a session
	 * that had started waiting for an answer went on reporting that it was
	 * working. */
	produced  int64 // bytes ever read from the terminal
	tailAt    int64
	tailCache []string

	// recording is the file the whole stream runs into — including what falls
	// off the front of the ring buffer.
	recording *os.File
	timeline  *timeline
	written   int64
	// capped says the recording has reached MaxRecording and stopped. Said
	// once in the log, because from that point playback and marks silently
	// end while the session goes on.
	capped bool

	// platform holds whatever only one specific system needs — on Windows for
	// instance the job object through which the whole process group ends.
	platform any

	// killing says the escalation in Kill is under way; a second TERMINATE —
	// two buttons, two windows — joins it rather than starting another.
	killing bool
	// mark is what this run's processes carry in their environment, see
	// SessionMark. It is the id plus the start, so a restart under the same
	// id — while the old run's escalation is still sweeping — can never be
	// mistaken for a stray of the old one.
	mark string

	Done chan struct{}
}

// Start hangs argv into a fresh PTY. cwd is the working directory, env holds
// additional environment variables as "NAME=value" — that is how the Claude
// account is chosen (CLAUDE_CONFIG_DIR).
func Start(id, cwd string, argv []string, env []string) (*Host, error) {
	if len(argv) == 0 {
		argv = shell.Default()
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	// What was asked for is not always what this system can start — see
	// runnable, and the day Windows could not find a claude that was plainly
	// on the PATH.
	argv = runnable(argv)
	c := p.Command(argv[0], argv[1:]...)
	c.Dir = cwd
	c.Env = append(cleanEnv(), shell.Environment(Version)...)
	c.Env = append(c.Env, "PLXR=1")
	// The mark by which everything this session starts is found again when
	// it is terminated — see strays. A `setsid` child leaves the process
	// group and the pty; the environment it inherited is what still says
	// where it came from.
	mark := id + "." + strconv.FormatInt(time.Now().UnixNano(), 36)
	c.Env = append(c.Env, SessionMark+"="+mark)
	c.Env = append(c.Env, env...)

	// Set the size BEFORE starting: otherwise ConPTY settles on 80x25 and the
	// CLI draws its first frame in the wrong geometry.
	_ = p.Resize(140, 44) // width, height

	if err := c.Start(); err != nil {
		p.Close()
		return nil, err
	}

	h := &Host{
		ID:   id,
		TTY:  p.Name(),
		mark: mark,
		pty:  p,
		cmd:  c,
		subs: map[*Viewer]struct{}{},
		rows: 44, cols: 140, // what was set above, before the start
		alive: true,
		last:  time.Now(),
		Done:  make(chan struct{}),
	}
	if c.Process != nil {
		h.PID = c.Process.Pid
		h.platform = afterStart(c.Process)
	}
	// Open the recording. If that fails everything carries on — just without a
	// recording. A terminal that refuses to start because a disk is full would
	// be the worse trade.
	if RecordingDir != "" {
		if err := os.MkdirAll(RecordingDir, 0o755); err == nil {
			f, err := os.OpenFile(filepath.Join(RecordingDir, id+".log"),
				os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
			if err == nil {
				h.recording = f
				h.timeline = openTimeline(filepath.Join(RecordingDir, id+".idx"))
				/* A restart under the same id appends to the recording that is
				   already there, and the timeline marks carry offsets into that
				   file. Counting from zero again would point every new mark at
				   the beginning of the old run, so the count starts where the
				   file already ends. */
				if fi, err := f.Stat(); err == nil {
					h.written = fi.Size()
				}
				if h.written >= MaxRecording {
					h.capped = true
					log.Printf("session %s: recording %s is at its cap of %d bytes; this run is not recorded", id, id+".log", MaxRecording)
				}
			}
		}
	}

	go h.pump()
	return h, nil
}

// RecordingDir is the directory for the recordings. Empty means: none.
var RecordingDir string

// MaxRecording limits a single recording.
//
// A dev server running for weeks would otherwise write gigabytes. Once the
// limit is passed nothing more is appended — the beginning is kept, because that
// is usually where what the session actually does is written down.
const MaxRecording = 64 << 20

// notInherited are variables a Claude Code session passes on to its child
// processes. Start plxr from inside such a session and they travel
// through os.Environ() into every new session — and CLAUDE_CODE_CHILD_SESSION
// turns off saving the transcript there. The session does run, but leaves
// nothing behind that could be picked up later.
var notInherited = []string{
	"CLAUDECODE",
	"CLAUDE_CODE_CHILD_SESSION",
	"CLAUDE_CODE_ENTRYPOINT",
	"CLAUDE_CODE_SSE_PORT",
	"CLAUDE_CODE_SIMPLE",
	"CLAUDE_CODE_SAFE_MODE",
	"CLAUDE_JOB_DIR",
	"CLAUDE_PLUGIN_ROOT",
	"CLAUDE_SESSION_ID",
	"CLAUDE_CONFIG_DIR", // deliberately set per session, not inherited
	"PLXR",
	SessionMark,
}

// SessionMark is the environment variable every process of a session carries:
// its value is the session id and the start of this run. It is how a process
// that has left the group — `setsid`, a double fork, a job the shell put in a
// group of its own — is still found and ended with the session.
const SessionMark = "PLXR_SESSION"

func cleanEnv() []string {
	all := os.Environ()
	out := make([]string, 0, len(all))
	for _, kv := range all {
		name, _, _ := strings.Cut(kv, "=")
		drop := false
		for _, n := range notInherited {
			if name == n {
				drop = true
				break
			}
		}
		if !drop {
			out = append(out, kv)
		}
	}
	return out
}

func (h *Host) pump() {
	b := make([]byte, 32*1024)
	for {
		n, err := h.pty.Read(b)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, b[:n])
			h.mu.Lock()
			h.last = time.Now()
			if h.recording != nil && h.written < MaxRecording {
				// Mark BEFORE the write: the mark points at the offset this
				// chunk starts at, which is what playback needs to seek to.
				h.timeline.mark(h.written, h.last)
				if n, err := h.recording.Write(chunk); err == nil {
					h.written += int64(n)
				}
			} else if h.recording != nil && !h.capped {
				h.capped = true
				log.Printf("session %s: recording stopped at its cap of %d bytes; playback ends here while the session goes on", h.ID, MaxRecording)
			}
			h.produced += int64(len(chunk))
			h.buf = append(h.buf, chunk...)
			if len(h.buf) > MaxBuf {
				h.buf = h.buf[len(h.buf)-MaxBuf:]
			}
			for v := range h.subs {
				if v.behind {
					// Nothing new until it has caught up, otherwise the
					// window would see the newer output before the screen
					// that is supposed to explain it — a hole that the
					// catch-up then no longer closes but merely overwrites.
					continue
				}
				select {
				case v.c <- chunk:
				default:
					/* Full. A bounded wait first: the reader is often only a
					   beat behind — the browser painting a big frame — and a
					   few milliseconds of backpressure on the terminal costs
					   nothing, while a resend of the whole screen is a flash
					   the person sees. The wait is bounded because the lock is
					   held here and every other viewer waits with it. */
					t := time.NewTimer(slowWait)
					select {
					case v.c <- chunk:
					case <-t.C:
						v.fellBehindLocked(len(chunk))
					}
					t.Stop()
				}
			}
			h.mu.Unlock()
		}
		if err != nil {
			break
		}
	}

	exit := 0
	if err := h.cmd.Wait(); err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		} else {
			exit = -1
		}
	}

	h.mu.Lock()
	h.alive, h.exit = false, exit
	for v := range h.subs {
		close(v.c)
		delete(h.subs, v)
	}
	if h.recording != nil {
		h.recording.Close()
		h.recording = nil
	}
	h.timeline.close()
	h.mu.Unlock()
	h.pty.Close()
	close(h.Done)
}

func (h *Host) Alive() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.alive }
func (h *Host) Exit() int   { h.mu.Lock(); defer h.mu.Unlock(); return h.exit }

// IdleFor reports how long nothing has come out of the PTY.
func (h *Host) IdleFor() time.Duration {
	h.mu.Lock()
	defer h.mu.Unlock()
	return time.Since(h.last)
}

// Snapshot returns the complete scrollback for a newly connected client.
func (h *Host) Snapshot() []byte {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.snapshotLocked()
}

func (h *Host) snapshotLocked() []byte {
	out := make([]byte, len(h.buf))
	copy(out, h.buf)
	return out
}

// tailWindow limits how much raw buffer the preview touches.
//
// Without the limit every call renders the full 2 MB of scrollback. With a
// handful of sessions and one tick per second that is enough to drive the daemon
// past 300 % CPU and bring the UI to a standstill.
const tailWindow = 48 << 10

// tailLines renders the end of the buffer and remembers the result for as long
// as nothing new has arrived.
func (h *Host) tailLines() []string {
	h.mu.Lock()
	if h.tailCache != nil && h.tailAt == h.produced {
		out := h.tailCache
		h.mu.Unlock()
		return out
	}
	at := h.produced
	raw := h.buf
	if len(raw) > tailWindow {
		raw = raw[len(raw)-tailWindow:]
		// Do not start in the middle of an escape sequence, otherwise its
		// introducer is missing and the remains show up visibly in the text. A
		// line break alone is not enough: full-screen UIs like Claude Code write
		// whole frames without a single one. So enter behind the last ESC that
		// began before the window.
		if i := bytes.IndexByte(raw, '\n'); i >= 0 && i < 4096 {
			raw = raw[i+1:]
		} else if i := bytes.IndexByte(raw, 0x1b); i >= 0 && i < 4096 {
			raw = raw[i:]
		}
	}
	src := string(raw)
	h.mu.Unlock()

	// Render outside the lock — that is the expensive part.
	lines := renderPlain(src)
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}

	h.mu.Lock()
	h.tailAt, h.tailCache = at, lines
	h.mu.Unlock()
	return lines
}

// Tail returns the last n lines as plain text — for the tile preview.
func (h *Host) Tail(n int) string {
	lines := h.tailLines()
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// A Viewer is one window looking at this session. There can be several at the
// same time — the machine the session runs on, and a browser somewhere else on
// the network — and they all see the same bytes.
type Viewer struct {
	// Back is the scrollback as it stood the moment this viewer attached.
	// Stream carries everything from that moment on. The two are taken under
	// one lock on purpose: fetching the scrollback first and subscribing after
	// leaves a gap, and whatever the program writes inside that gap is in
	// neither of them. On a busy session that is a hole in the middle of the
	// output, which nothing later repairs.
	Back []byte

	c      chan []byte
	wake   chan struct{}
	behind bool // guarded by h.mu: output was dropped, the screen must be redone
	// dropped counts the bytes this viewer never got, and warned says the log
	// has been told — once, since a window that is slow stays slow and a line
	// per chunk would be the only thing left in the log.
	dropped int64
	warned  bool

	h          *Host
	rows, cols uint16 // 0 while this viewer has not said how big it is
}

// Attach opens a viewer on the session.
func (h *Host) Attach() *Viewer {
	v := &Viewer{c: make(chan []byte, 64), wake: make(chan struct{}, 1), h: h}
	h.mu.Lock()
	defer h.mu.Unlock()
	v.Back = h.snapshotLocked()
	if !h.alive {
		close(v.c)
		return v
	}
	h.subs[v] = struct{}{}
	return v
}

// Detach closes the viewer. The session carries on without it, and the
// terminal grows back to whatever the remaining windows can hold.
func (v *Viewer) Detach() {
	h := v.h
	h.mu.Lock()
	if _, ok := h.subs[v]; ok {
		delete(h.subs, v)
		close(v.c)
	}
	rows, cols := h.wantedSizeLocked()
	h.mu.Unlock()
	h.applySize(rows, cols)
}

// Stream hands every piece of output to write, in the order the terminal
// produced it, until the session ends or write returns an error.
//
// The queue is drained before a catch-up is even considered. That order is the
// whole point: a catch-up carries the current screen, so it may follow older
// output, but nothing older may follow it. Taking whichever is ready — the way
// a plain select does — puts a stale chunk after the fresh screen now and
// then, and that chunk stays on the screen as the last word.
func (v *Viewer) Stream(write func([]byte) error) error {
	for {
		select {
		case chunk, ok := <-v.c:
			if !ok {
				return v.lastWord(write)
			}
			if err := write(chunk); err != nil {
				return err
			}
			continue
		default:
		}

		select {
		case chunk, ok := <-v.c:
			if !ok {
				return v.lastWord(write)
			}
			if err := write(chunk); err != nil {
				return err
			}
		case <-v.wake:
			if err := v.writeCatchUp(write); err != nil {
				return err
			}
		}
	}
}

// lastWord delivers the screen once more if output was dropped just before the
// session ended — otherwise the window would keep the state from before.
func (v *Viewer) lastWord(write func([]byte) error) error {
	return v.writeCatchUp(write)
}

func (v *Viewer) writeCatchUp(write func([]byte) error) error {
	h := v.h
	h.mu.Lock()
	if !v.behind {
		h.mu.Unlock()
		return nil
	}
	v.behind = false
	snap := h.snapshotLocked()
	h.mu.Unlock()
	if len(snap) == 0 {
		return nil
	}
	/* The screen is redone, not appended to.
	 *
	 * The ring holds the last two megabytes, and most of that is already on
	 * the viewer's screen — it dropped one chunk, not two megabytes. Sent as
	 * a plain chunk the whole scrollback appeared a second time below what
	 * was there. So the catch-up begins with a terminal reset (RIS), which
	 * every terminal and xterm.js handle as "clear everything", and the ring
	 * then rebuilds the screen from a blank one — the same picture a fresh
	 * attach draws. */
	out := make([]byte, 0, len(resync)+len(snap))
	out = append(out, resync...)
	out = append(out, snap...)
	return write(out)
}

// resync is what a catch-up starts with: a full terminal reset, so the ring
// that follows lands on a blank screen rather than under the old one.
const resync = "\x1bc"

// slowWait is how long the terminal is held back for one viewer whose queue is
// full before that viewer is dropped and marked for a catch-up.
const slowWait = 15 * time.Millisecond

// fellBehindLocked notes that this viewer missed output.
//
// Waiting for it is not an option: the send happens under the lock that every
// other viewer, the preview and the session list also need, so one window that
// stopped reading — a laptop that went to sleep, a Wi-Fi link that stalled —
// would freeze the session for everyone, including the machine it runs on.
// Dropping the chunk quietly is not an option either: the missing bytes are
// usually half of an escape sequence, and that screen stays broken for good.
//
// So the chunk is dropped and the viewer is marked. It is served the whole
// screen again as soon as it has worked through what it already has.
func (v *Viewer) fellBehindLocked(n int) {
	v.behind = true
	v.dropped += int64(n)
	if !v.warned {
		v.warned = true
		log.Printf("session %s: a viewer cannot keep up — %d bytes dropped after a %v wait; it is served the screen afresh when it catches up (said once per viewer)", v.h.ID, n, slowWait)
	}
	select {
	case v.wake <- struct{}{}:
	default:
	}
}

// Resize reports how much room this one window has.
func (v *Viewer) Resize(rows, cols uint16) {
	h := v.h
	h.mu.Lock()
	v.rows, v.cols = rows, cols
	rows, cols = h.wantedSizeLocked()
	h.mu.Unlock()
	h.applySize(rows, cols)
}

// wantedSizeLocked picks the size the terminal is set to: the smallest of all
// attached windows.
//
// A terminal has one size, the windows looking at it need not. Whoever asked
// last used to win, so with two windows attached the program wrapped its lines
// for the other one — the kitchen screen showed the bedroom's line breaks. The
// smaller size is the one both can display; the bigger window keeps a margin,
// which is the same trade a terminal multiplexer makes.
func (h *Host) wantedSizeLocked() (rows, cols uint16) {
	for v := range h.subs {
		if v.rows == 0 || v.cols == 0 {
			continue
		}
		if rows == 0 || v.rows < rows {
			rows = v.rows
		}
		if cols == 0 || v.cols < cols {
			cols = v.cols
		}
	}
	return rows, cols
}

func (h *Host) applySize(rows, cols uint16) {
	if rows == 0 || cols == 0 {
		return // nobody has said anything; leave the terminal as it is
	}
	h.mu.Lock()
	if rows == h.rows && cols == h.cols {
		h.mu.Unlock()
		return
	}
	h.rows, h.cols = rows, cols
	h.mu.Unlock()
	_ = h.pty.Resize(int(cols), int(rows))
}

// Size is the size the terminal currently has.
func (h *Host) Size() (rows, cols uint16) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rows, h.cols
}

// Write sends input — keystrokes — into the terminal.
func (h *Host) Write(p []byte) (int, error) { return h.pty.Write(p) }

// Kill ends the session — everything it started, not only its root.
//
// In three steps, each to the whole process group and to every stray that has
// left it: SIGTERM, after the grace SIGHUP, after another grace SIGKILL. The
// steps are what the programs expect: an interactive shell and Claude Code
// itself ignore SIGTERM, because otherwise any slip in a terminal would end
// them, but a shell takes SIGHUP as "the terminal is gone" and passes it on
// to its jobs — and SIGKILL cannot be ignored by anything.
//
// Strays are why the group is not enough. A job the shell put in a group of
// its own, `setsid sleep 300`, a program that double-forked: none of them is in
// the root's group, and the pty they still hold open kept the session "alive"
// with nobody in it. They are found by the mark in their environment (see
// SessionMark) and signalled with each step, and the session does not count as
// ended until the last of them is gone.
//
// Returns once the first step is sent — a scan of the process table and a
// signal, some tens of milliseconds; the escalation runs on its own. Done
// closes when the pty is finished, which is after the last holder of it has
// gone.
func (h *Host) Kill() {
	if h.cmd.Process == nil {
		return
	}
	h.mu.Lock()
	again := h.killing
	h.killing = true
	h.mu.Unlock()
	if again {
		return
	}
	// The first step before this returns — TERMINATE has been sent when the
	// request is answered — and the rest on its own.
	h.signalAll(0)
	go func() {
		for step := 1; step <= 2; step++ {
			if h.settled(KillGrace) {
				return
			}
			h.signalAll(step)
		}
		if !h.settled(KillGrace) {
			log.Printf("session %s: still running after SIGKILL — %d strays left", h.ID, len(h.strays()))
		}
	}()
}

/* strays lists the processes of this run that the group signal does not reach.
 *
 * Three ways to belong: the mark in the environment (every child inherits it,
 * and it is unique to this run); the session's terminal as controlling
 * terminal (a job the shell put in a group of its own); and descent from the
 * root (a child whose parent is still alive). The mark alone would do on
 * Linux, where /proc shows every own process's environment; on macOS the
 * kernel withholds the environment of its own binaries — `sleep` among them —
 * and the other two fill that in.
 *
 * The terminal and the descent are only trusted while the root is alive —
 * before the scan and after it. Once the pty is closed its name is free for
 * the next terminal on the machine, and the next one is often this very
 * session started again in place, on the same number: a scan that began
 * while the old run was alive and ended after its pty had closed found the
 * new run's shell "on our tty" and sent it the next step. Measured, in the
 * tests, as a flood cut short. The mark carries no such risk: it is nobody
 * else's. */
func (h *Host) strays() []int {
	alive := h.Alive()
	q := strayQuery{mark: h.mark}
	if alive {
		q.tty, q.root = h.TTY, h.PID
	}
	sure, loose := findStrays(q)
	if alive && !h.Alive() {
		loose = nil
	}
	return append(sure, loose...)
}

type strayQuery struct {
	mark string
	tty  string // empty: do not go by the terminal
	root int    // 0: do not go by descent
}

// signalAll sends one step of the escalation to the group and to the strays.
//
// The strays are listed BEFORE the group is signalled. A parent that goes on
// the signal takes the parent-child links with it — its children are handed
// to init in the same instant — and the pty closes with the root; listed
// after, a stray that had been plain to see a moment earlier was an orphan
// with no trace of where it came from. Measured: a `sleep` that ignored
// SIGTERM survived the hangup step every time.
func (h *Host) signalAll(step int) {
	strays := h.strays()
	killStep(h.cmd.Process, h.platform, step)
	for _, pid := range strays {
		if pid == h.PID {
			continue
		}
		killStrayStep(pid, step)
	}
}

// settled waits up to d for the session to be over: root gone, no strays.
func (h *Host) settled(d time.Duration) bool {
	deadline := time.Now().Add(d)
	for {
		if !h.Alive() && len(h.strays()) == 0 {
			return true
		}
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(100 * time.Millisecond)
	}
}

// Strays lists the processes of this session that are outside its process
// group — for the tests, and for whoever wants to know what a terminate is up
// against.
func (h *Host) Strays() []int { return h.strays() }

/*
Freeze suspends the session, Resume lets it go again.

	Unlike Kill nothing is lost: the process keeps everything it holds open and
	carries on exactly where it stood. That is the point of the emergency brake —
	a command appears in a tile that must not run, and there is no time to read
	it properly first.

	Returns whether it worked. On Windows it does not yet, and saying so is
	better than a brake that does not brake.
*/
func (h *Host) Freeze() bool {
	if h.cmd.Process == nil {
		return false
	}
	ok := freezeProcess(h.cmd.Process)
	if ok {
		h.mu.Lock()
		h.frozen = true
		h.mu.Unlock()
	}
	return ok
}

func (h *Host) Resume() bool {
	if h.cmd.Process == nil {
		return false
	}
	ok := resumeProcess(h.cmd.Process)
	if ok {
		h.mu.Lock()
		h.frozen = false
		h.mu.Unlock()
	}
	return ok
}

// Frozen reports whether this session is suspended. A frozen session writes
// nothing, so the quiet heuristic would otherwise call it idle after a few
// seconds — and the tile would look calm while it is in fact stopped.
func (h *Host) Frozen() bool { h.mu.Lock(); defer h.mu.Unlock(); return h.frozen }

// KillGrace is the time between the polite and the hard termination.
var KillGrace = 2 * time.Second
