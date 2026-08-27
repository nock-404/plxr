package update

import "testing"

func TestVergleichOhnePrefix(t *testing.T) {
	faelle := []struct {
		neu, alt string
		will     bool
	}{
		{"0.3.7", "0.3.6", true},
		{"0.3.6", "0.3.6", false},
		{"0.3.6", "v0.3.6", false},
		{"0.3.6", "0.3.7", false},
		{"0.4.0", "0.3.9", true},
		{"0.3.6", "dev", false},
	}
	for _, f := range faelle {
		if got := neuer(f.neu, f.alt); got != f.will {
			t.Errorf("neuer(%q,%q) = %v, erwartet %v", f.neu, f.alt, got, f.will)
		}
	}
}
