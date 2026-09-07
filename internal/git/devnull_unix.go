//go:build !windows

package git

// devNull is the empty side of a diff for a file git does not track yet.
const devNull = "/dev/null"
