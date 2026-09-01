package update

import (
	"os"
	"strings"
	"testing"
)

// Does the check still work when the API is closed?
//
// Sixty calls an hour per address, shared with everything else on the machine.
// Once they are gone the API answers 403, and what used to happen then was the
// worst of both: the check failed, Available stayed false, and the interface
// said "up to date".
//
// Reaches out to the network, so it does not run in the gate — check.sh would
// then be red whenever GitHub sneezes. Run it by hand:
//
//	PLXR_NET_TEST=1 go test ./internal/update/ -run Live -v
func TestLiveCheckSurvivesAClosedAPI(t *testing.T) {
	if os.Getenv("PLXR_NET_TEST") == "" {
		t.Skip("network test — set PLXR_NET_TEST=1")
	}

	tag, err := latestFromWeb()
	if err != nil {
		t.Fatalf("the website does not give a tag either: %v", err)
	}
	if !strings.HasPrefix(tag, "v") {
		t.Fatalf("that is not a tag: %q", tag)
	}
	t.Logf("website says: %s", tag)

	st := Check("0.0.1")
	if st.Error != "" {
		t.Fatalf("check reports an error: %s", st.Error)
	}
	if st.Latest == "" {
		t.Fatal("no version, and no error either — that is the silent case this exists for")
	}
	if !st.Available {
		t.Fatalf("0.0.1 against %s should be an update", st.Latest)
	}
	if st.AssetURL == "" {
		t.Fatalf("no archive for %s", assetName())
	}
	t.Logf("newest %s, archive %s", st.Latest, st.AssetURL)
}
