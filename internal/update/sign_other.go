//go:build !darwin

package update

// resign has nothing to do outside macOS: Windows and Linux do not tie
// permissions to a code signature.
func resign(string) error { return nil }
