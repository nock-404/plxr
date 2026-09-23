//go:build !darwin && !linux && !windows

package browse

import "plxr/internal/uierr"

func open(string) error { return uierr.New("err.link.noOpener") }
