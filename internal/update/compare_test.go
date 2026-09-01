package update

import "testing"

func TestCompareIgnoresPrefix(t *testing.T) {
	cases := []struct {
		fresh, old string
		want       bool
	}{
		{"0.3.7", "0.3.6", true},
		{"0.3.6", "0.3.6", false},
		{"0.3.6", "v0.3.6", false},
		{"0.3.6", "0.3.7", false},
		{"0.4.0", "0.3.9", true},
		{"0.3.6", "dev", false},
	}
	for _, f := range cases {
		if got := isNewer(f.fresh, f.old); got != f.want {
			t.Errorf("isNewer(%q,%q) = %v, expected %v", f.fresh, f.old, got, f.want)
		}
	}
}
