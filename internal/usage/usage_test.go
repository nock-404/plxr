package usage

import (
	"encoding/json"
	"testing"
)

/* What the usage view is counting.

   Nothing here talks to anything: it is arithmetic and ordering, which is
   exactly the kind of thing that is never wrong until it is, and then is wrong
   quietly — a number on a screen has no way of looking incorrect.
*/

func TestAddingUpTheFourKinds(t *testing.T) {
	got := Item{In: 1, Out: 2, CacheWrite: 3, CacheRead: 4}
	got.add(Item{In: 10, Out: 20, CacheWrite: 30, CacheRead: 40})

	want := Item{In: 11, Out: 22, CacheWrite: 33, CacheRead: 44}
	if got != want {
		t.Fatalf("adding two items gave %+v, wanted %+v", got, want)
	}
	if total := got.Total(); total != 110 {
		t.Fatalf("the total is %d, and the four numbers add up to 110", total)
	}
}

func TestAddingNothingChangesNothing(t *testing.T) {
	before := Item{In: 5, Out: 6, CacheWrite: 7, CacheRead: 8}
	after := before
	after.add(Item{})
	if after != before {
		t.Fatalf("adding an empty item changed %+v into %+v", before, after)
	}
}

func TestTheOrderIsWhatTheViewNeeds(t *testing.T) {
	items := map[string]*Item{
		"2026-08-29": {In: 5},
		"2026-08-31": {In: 1},
		"2026-08-30": {In: 100},
	}

	// By key: newest day first, because that is the one being looked at.
	byKey := sorted(items, true)
	if byKey[0].Key != "2026-08-31" || byKey[2].Key != "2026-08-29" {
		t.Fatalf("by day, the order came out %s, %s, %s", byKey[0].Key, byKey[1].Key, byKey[2].Key)
	}

	// By size: the biggest first, because that is the one worth knowing about.
	bySize := sorted(items, false)
	if bySize[0].Key != "2026-08-30" || bySize[0].Total() != 100 {
		t.Fatalf("by size, the biggest came out as %s with %d", bySize[0].Key, bySize[0].Total())
	}
	if bySize[2].Key != "2026-08-31" {
		t.Fatalf("by size, the smallest came out as %s", bySize[2].Key)
	}
}

func TestSortingNothingIsNotACrash(t *testing.T) {
	if got := sorted(map[string]*Item{}, true); len(got) != 0 {
		t.Fatalf("an empty set sorted into %d lines", len(got))
	}
}

/*
A cache written by an older build must not be read as current.

	The size field used to be stored under a German name. Renaming it means every
	cache written before that reads back a size of zero — which would compare
	unequal to the file's real size for ever, so nothing would ever be reused, and
	the version number is what says so out loud instead. This holds the two in
	step: whoever changes the shape has to change the number.
*/
func TestAnOlderCacheIsNotTakenAtFaceValue(t *testing.T) {
	old := []byte(`{"version":2,"groesse":1234,"mod":99,"days":{},"project":"p"}`) // german-ok: the field name the older shape used, which is the point

	var e entry
	if err := json.Unmarshal(old, &e); err != nil {
		t.Fatalf("the old shape no longer parses at all: %v", err)
	}
	if e.Version == cacheVersion {
		t.Fatal("a cache from the older shape claims to be the current version")
	}
	if e.Size != 0 {
		t.Fatalf("the old size field is being read as %d — then the rename was not complete", e.Size)
	}
}

func TestTheCurrentShapeSurvivesARoundTrip(t *testing.T) {
	before := entry{
		Version: cacheVersion,
		Size:    4096,
		Mod:     1700000000,
		Days:    map[string]map[string]Item{"2026-08-31": {"opus": {In: 7, Out: 8}}},
		Project: "plxr",
	}
	b, err := json.Marshal(before)
	if err != nil {
		t.Fatal(err)
	}
	var after entry
	if err := json.Unmarshal(b, &after); err != nil {
		t.Fatal(err)
	}
	if after.Size != before.Size || after.Version != before.Version || after.Project != before.Project {
		t.Fatalf("a round trip changed %+v into %+v", before, after)
	}
	if after.Days["2026-08-31"]["opus"].In != 7 {
		t.Fatal("the numbers did not survive the round trip")
	}
}
