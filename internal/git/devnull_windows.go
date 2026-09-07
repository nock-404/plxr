package git

// devNull is the empty side of a diff for a file git does not track yet.
//
// Windows has no /dev/null, and git for Windows accepts NUL here — the same
// name the shell uses for the bit bucket.
const devNull = "NUL"
