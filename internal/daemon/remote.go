package daemon

import (
	"crypto/rand"
	"encoding/json"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

/* Reaching plxr from another machine.
 *
 * The daemon listens on 127.0.0.1, so the window can only ever be opened on the
 * machine plxr runs on. That is the right default and it stays the default:
 * anything that can talk to this daemon can start processes here, read the
 * files it can read, and answer an agent's questions.
 *
 * Switched on, it listens on every interface instead, and the token is what
 * stands between the network and all of that. The token is 24 bytes of
 * randomness and nobody is going to type it into a browser in another room, so
 * there is a second way in: a short code, good for a few minutes, that hands
 * the browser a cookie and forgets itself.
 */

// RemoteFile is where the choice is kept. Beside daemon.json rather than in it,
// because daemon.json is written fresh on every start and this outlives one.
func remotePath() string { return filepath.Join(Root(), "remote.json") }

type remoteState struct {
	// On: listen on the network as well as on this machine.
	On bool `json:"on"`
}

// RemoteWanted says whether the network listener is asked for. Read before the
// listener is opened, so changing it takes a restart — which is said in the
// window rather than pretended away.
func RemoteWanted() bool {
	b, err := os.ReadFile(remotePath())
	if err != nil {
		return false
	}
	var s remoteState
	if json.Unmarshal(b, &s) != nil {
		return false
	}
	return s.On
}

// SetRemote records the choice. It does not move the listener: that happens
// when the daemon next starts.
func SetRemote(on bool) error {
	if err := os.MkdirAll(Root(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(remoteState{On: on}, "", "  ")
	if err != nil {
		return err
	}
	tmp := remotePath() + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, remotePath())
}

// bindAddress is where to listen. Only ever the network when it was asked for.
func bindAddress() string {
	if RemoteWanted() {
		return ":0"
	}
	return "127.0.0.1:0"
}

/* ---- The short way in ---- */

// CodeLife is how long a pairing code is good for. Long enough to walk into
// another room, short enough that a code left on screen is not a key.
const CodeLife = 10 * time.Minute

type pairing struct {
	until time.Time
}

var codes = struct {
	sync.Mutex
	m map[string]pairing
}{m: map[string]pairing{}}

// Letters a person reads off a screen and types on another keyboard. No 0/O,
// no 1/I/L: the whole point is that it is typed by hand, once, in a hurry.
const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

// NewCode makes a pairing code and remembers it until it expires.
func NewCode() (string, time.Time) {
	sweep()
	out := make([]byte, 8)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			// Never seen; a code that cannot be made is better than a
			// predictable one, so this one simply will not match anything.
			return "", time.Time{}
		}
		out[i] = alphabet[n.Int64()]
	}
	code := string(out[:4]) + "-" + string(out[4:])
	until := time.Now().Add(CodeLife)
	codes.Lock()
	codes.m[code] = pairing{until: until}
	codes.Unlock()
	return code, until
}

// TakeCode says whether this code is good, and uses it up.
//
// Used up rather than reusable: a code is for handing one browser the cookie,
// and a browser only needs it once. Left usable, a code read off a screen stays
// a key for as long as it lives.
func TakeCode(code string) bool {
	code = strings.ToUpper(strings.TrimSpace(code))
	sweep()
	codes.Lock()
	defer codes.Unlock()
	p, ok := codes.m[code]
	if !ok || time.Now().After(p.until) {
		return false
	}
	delete(codes.m, code)
	return true
}

func sweep() {
	now := time.Now()
	codes.Lock()
	for code, p := range codes.m {
		if now.After(p.until) {
			delete(codes.m, code)
		}
	}
	codes.Unlock()
}

/* ---- Where to reach it ---- */

// Addresses are the ways this machine can be reached, best first.
//
// Only real addresses of real interfaces: no loopback, nothing that is down,
// and no link-local IPv6, which needs a zone index nobody is going to type.
func Addresses() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	out := []string{}
	for _, i := range ifaces {
		if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := i.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ip, _, err := net.ParseCIDR(a.String())
			if err != nil || ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			out = append(out, ip.String())
		}
	}
	// A plain IPv4 first: it is the one somebody can type.
	sort.SliceStable(out, func(i, j int) bool {
		return strings.Count(out[i], ".") > strings.Count(out[j], ".")
	})
	return out
}
