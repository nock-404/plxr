// Package ptyhost starts processes in a pseudo terminal owned by the daemon
// rather than by a terminal window. That way the session survives closing
// des Fensters.
//
// The PTY binding goes through go-pty because it offers one API for Unix PTYs
// and Windows ConPTY. creack/pty cannot do Windows, and os/exec alone is not
// enough there: ConPTY needs a process attribute that os/exec does not
// setzen kann (golang/go#62708).
package ptyhost

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"plxr/internal/shell"
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

	mu    sync.Mutex
	buf   []byte
	subs  map[chan []byte]struct{}
	alive bool
	exit  int
	last  time.Time // last output — the basis of the quiet heuristic

	// Cache for the rendered preview, see tailLines.
	tailLen   int
	tailCache []string

	// recording is the file the whole stream runs into — including what falls
	// off the front of the ring buffer.
	recording *os.File
	timeline  *timeline
	written   int64

	// platform holds whatever only one specific system needs — on Windows for
	// instance the job object through which the whole process group ends.
	platform any

	Done chan struct{}
}

// Start hangs argv into a fresh PTY. cwd is the working directory, env holds
// additional environment variables as "NAME=value" — that is how the choice of
// Claude-Kontos (CLAUDE_CONFIG_DIR).
func Start(id, cwd string, argv []string, env []string) (*Host, error) {
	if len(argv) == 0 {
		argv = shell.Default()
	}

	p, err := pty.New()
	if err != nil {
		return nil, err
	}

	c := p.Command(argv[0], argv[1:]...)
	c.Dir = cwd
	c.Env = append(cleanEnv(), shell.Environment(Version)...)
	c.Env = append(c.Env, "PLXR=1")
	c.Env = append(c.Env, env...)

	// Set the size BEFORE starting: otherwise ConPTY settles on 80x25 and the
	// CLI draws its first frame in the wrong geometry.
	_ = p.Resize(140, 44) // width, height

	if err := c.Start(); err != nil {
		p.Close()
		return nil, err
	}

	h := &Host{
		ID:    id,
		TTY:   p.Name(),
		pty:   p,
		cmd:   c,
		subs:  map[chan []byte]struct{}{},
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

// notInherited are variables a Claude Code session passes to its child processes
// weitergibt. Wird plxr aus einer solchen Session heraus gestartet, landen sie
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
}

func cleanEnv() []string {
	alle := os.Environ()
	out := make([]string, 0, len(alle))
	for _, kv := range alle {
		name, _, _ := strings.Cut(kv, "=")
		verwerfen := false
		for _, n := range notInherited {
			if name == n {
				verwerfen = true
				break
			}
		}
		if !verwerfen {
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
			}
			h.buf = append(h.buf, chunk...)
			if len(h.buf) > MaxBuf {
				h.buf = h.buf[len(h.buf)-MaxBuf:]
			}
			for c := range h.subs {
				select {
				case c <- chunk:
				default: // langsamer Client verliert lieber Bytes als alle zu bremsen
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
	for c := range h.subs {
		close(c)
		delete(h.subs, c)
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
	if h.tailCache != nil && h.tailLen == len(h.buf) {
		out := h.tailCache
		h.mu.Unlock()
		return out
	}
	bufLen := len(h.buf)
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
	h.tailLen, h.tailCache = bufLen, lines
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

func (h *Host) Subscribe() chan []byte {
	c := make(chan []byte, 64)
	h.mu.Lock()
	if !h.alive {
		h.mu.Unlock()
		close(c)
		return c
	}
	h.subs[c] = struct{}{}
	h.mu.Unlock()
	return c
}

func (h *Host) Unsubscribe(c chan []byte) {
	h.mu.Lock()
	if _, ok := h.subs[c]; ok {
		delete(h.subs, c)
		close(c)
	}
	h.mu.Unlock()
}

func (h *Host) Write(p []byte) (int, error) { return h.pty.Write(p) }

// Resize takes rows and columns; go-pty expects the other order.
func (h *Host) Resize(rows, cols uint16) error {
	return h.pty.Resize(int(cols), int(rows))
}

// Kill terminates the process. On Unix the whole group, so child processes
// started by the session do not carry on orphaned.
//
// Politely first, then firmly: an interactive login shell — and Claude Code
// itself — ignores SIGTERM, because otherwise any slip in a terminal would end
// it. Without following up, "terminate" would stay without effect and the user
// would get a 204 back while the session keeps running. Hence
// nach einer Schonfrist SIGKILL.
func (h *Host) Kill() {
	if h.cmd.Process == nil {
		return
	}
	killProcess(h.cmd.Process, h.platform)

	go func() {
		frist := time.Now().Add(KillGrace)
		for time.Now().Before(frist) {
			if !h.Alive() {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		if h.Alive() {
			killProcessHard(h.cmd.Process, h.platform)
		}
	}()
}

// KillGrace is the time between the polite and the hard termination.
var KillGrace = 2 * time.Second
