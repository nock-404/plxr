//go:build !darwin

package update

// nachbereiten hat außerhalb von macOS nichts zu tun: Windows und Linux
// knüpfen Berechtigungen nicht an eine Code-Signatur.
func resign(string) error { return nil }
