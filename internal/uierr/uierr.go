// Package uierr carries errors that reach the interface — as a code, not as
// prose.
//
// Why not simply English text: the interface is fully translated, and an error
// message is the worst possible place for a break in language. It is what you
// read when something has just gone wrong, and that is not the moment to
// switch languages on somebody.
//
// So Go sends a stable code, "err.session.unknown", and the window turns it
// into a sentence through tr(). The code is part of the contract between the
// two sides, exactly like a JSON field name — and it is checked the same way:
// errors.py reports any code that has no entry in en.json.
//
// Details that cannot be translated — a path, a name, the message of an
// underlying error — travel behind a vertical bar and get substituted into
// {detail}:
//
//	uierr.With("err.dir.missing", cwd)   ->  "err.dir.missing|/no/such/place"
//
// The bar was chosen because it appears in no code and in no path we hand out.
// The window falls back to the raw text for anything it does not recognise, so
// an error is never swallowed, even one from a version that is newer than the
// window.
package uierr

import "errors"

// Sep divides the code from its untranslatable detail.
const Sep = "|"

// New returns an error that is nothing but a code.
func New(code string) error { return errors.New(code) }

// With returns a code plus a detail for {detail}.
func With(code, detail string) error { return errors.New(code + Sep + detail) }
