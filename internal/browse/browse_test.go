package browse

import "testing"

/* What plxr will open, and what it will not.
 *
 * The address comes out of a terminal — a line some program printed — so it is
 * not a thing to be trusted. Checked without opening anything: a test that
 * opened what it allows would put a browser on the screen of whoever ran it.
 */
func TestOnlyWebAddressesAreOpened(t *testing.T) {
	for _, ok := range []string{
		"https://example.com",
		"http://127.0.0.1:8080/path?q=1",
		"HTTPS://Example.com/Upper",
		"mailto:somebody@example.com",
	} {
		if _, err := Allowed(ok); err != nil {
			t.Errorf("%q should be opened: %v", ok, err)
		}
	}
	for _, no := range []string{
		"",
		"   ",
		"file:///etc/passwd",
		"/etc/passwd",
		"javascript:alert(1)",
		"data:text/html,<script>alert(1)</script>",
		"ssh://box/../../etc",
		"https://",
	} {
		if _, err := Allowed(no); err == nil {
			t.Errorf("%q should be refused", no)
		}
	}
}
