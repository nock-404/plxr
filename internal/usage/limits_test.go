package usage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"plxr/internal/accounts"
)

/* What the readout is allowed to claim.

   Every number here decides whether somebody keeps working or stops, so the
   two things worth testing are the arithmetic and the honesty: a percentage
   that was read off the disk must come through unchanged, and one that was
   never there must not arrive as a zero.
*/

// ---- a machine to test against -------------------------------------------

// home builds a config directory per account under a temporary home, with the
// second and third account's projects/ linked to the first one's where asked —
// which is exactly how this machine is set up.
func home(t *testing.T, shared bool, names ...string) (string, []accounts.Account) {
	t.Helper()
	root := t.TempDir()
	t.Setenv("HOME", root)
	t.Setenv("PLXR_HOME", filepath.Join(root, ".plxr"))

	var out []accounts.Account
	first := ""
	for i, name := range names {
		dir := filepath.Join(root, "."+name)
		projects := filepath.Join(dir, "projects")
		if i == 0 || !shared {
			if err := os.MkdirAll(projects, 0o755); err != nil {
				t.Fatal(err)
			}
			if i == 0 {
				first = projects
			}
		} else {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(first, projects); err != nil {
				t.Fatal(err)
			}
		}
		out = append(out, accounts.Account{Name: name, Number: i + 1, Dir: dir, Short: "~/." + name})
	}
	return root, out
}

// transcript writes one session file with an assistant line per moment given.
func transcript(t *testing.T, projects, project, id, model string, at ...time.Time) {
	t.Helper()
	dir := filepath.Join(projects, project)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := ""
	for _, when := range at {
		body += fmt.Sprintf(
			`{"type":"assistant","cwd":"/work/%s","timestamp":%q,"message":{"model":%q,"usage":{"input_tokens":1,"output_tokens":2,"cache_creation_input_tokens":3,"cache_read_input_tokens":4}}}`+"\n",
			project, when.UTC().Format(time.RFC3339Nano), model)
	}
	if err := os.WriteFile(filepath.Join(dir, id+".jsonl"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// utilization writes the part of Claude Code's own state file that plxr reads.
func utilization(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	// Wrapped in the noise the real file carries, so the decoder is proven to
	// walk past what is none of its business.
	full := `{"numStartups":41,"projects":{"/work":{"history":[]}},"cachedUsageUtilization":` + body + `,"autoUpdates":true}`
	if !json.Valid([]byte(full)) {
		t.Fatalf("the fixture is not valid JSON: %s", full)
	}
	if err := os.WriteFile(path, []byte(full), 0o600); err != nil {
		t.Fatal(err)
	}
}

func util(fetched int64, session, week int, sessionReset, weekReset string, model string, modelPct int) string {
	return fmt.Sprintf(`{"fetchedAtMs":%d,"accountUuid":"x","utilization":{
      "five_hour":{"utilization":%d,"resets_at":%q},
      "seven_day":{"utilization":%d,"resets_at":%q},
      "limits":[
        {"kind":"session","group":"session","percent":%d,"severity":"normal","resets_at":%q,"scope":null,"is_active":true},
        {"kind":"weekly_all","group":"weekly","percent":%d,"severity":"normal","resets_at":%q,"scope":null,"is_active":true},
        {"kind":"weekly_scoped","group":"weekly","percent":%d,"severity":"normal","resets_at":%q,"scope":{"model":{"id":null,"display_name":%q}},"is_active":false}
      ]}}`,
		fetched, session, sessionReset, week, weekReset,
		session, sessionReset, week, weekReset, modelPct, weekReset, model)
}

// ---- the pools -----------------------------------------------------------

/*
Three accounts, one shared directory.

	On this machine the second and third account's projects/ are links to the
	first one's, so all three read one set of transcripts. Counted per account
	that would triple every number; counted per directory it is one pool with
	three readers, which is what the interface has to be told so it can say so.
*/
func TestThreeAccountsOneSharedDirectoryAreOnePool(t *testing.T) {
	root, accs := home(t, true, "claude", "claude2", "claude3")
	projects := filepath.Join(root, ".claude", "projects")
	transcript(t, projects, "work", "a", "opus", time.Now().Add(-time.Hour))
	transcript(t, projects, "work", "b", "opus", time.Now().Add(-2*time.Hour))

	ps := pools(accs)
	if len(ps) != 1 {
		t.Fatalf("three linked accounts came out as %d pools, wanted 1", len(ps))
	}
	if len(ps[0].Accounts) != 3 {
		t.Fatalf("the one pool is read by %v, wanted all three", ps[0].Accounts)
	}
	if !ps[0].Shared() {
		t.Fatal("a pool with three readers does not call itself shared")
	}
	if len(ps[0].files) != 2 {
		t.Fatalf("the two transcripts were listed %d times — they must be counted once", len(ps[0].files))
	}
}

func TestAccountsWithDirectoriesOfTheirOwnAreSeparatePools(t *testing.T) {
	root, accs := home(t, false, "claude", "claude2")
	transcript(t, filepath.Join(root, ".claude", "projects"), "work", "a", "opus", time.Now().Add(-time.Hour))
	transcript(t, filepath.Join(root, ".claude2", "projects"), "work", "b", "opus", time.Now().Add(-time.Hour))

	ps := pools(accs)
	if len(ps) != 2 {
		t.Fatalf("two separate directories came out as %d pools, wanted 2", len(ps))
	}
	for _, p := range ps {
		if p.Shared() {
			t.Fatalf("%v calls itself shared with one reader", p.Accounts)
		}
	}
}

/*
The transcripts are shared; the limits are not.

	That is the whole point of the split: the percentages come out of three
	different files and are genuinely per account, while the tokens come out of
	one directory and cannot be divided. Both have to survive the same call.
*/
func TestSharedTranscriptsStillGiveEachAccountItsOwnLimits(t *testing.T) {
	root, accs := home(t, true, "claude", "claude2", "claude3")
	now := time.Now().UTC()
	transcript(t, filepath.Join(root, ".claude", "projects"), "work", "a", "opus", now.Add(-30*time.Minute))

	// The default account keeps its state beside the directory; the others
	// keep theirs inside it.
	utilization(t, filepath.Join(root, ".claude.json"), util(now.UnixMilli(), 28, 4, now.Add(2*time.Hour).Format(time.RFC3339), now.Add(72*time.Hour).Format(time.RFC3339), "Fable", 5))
	utilization(t, filepath.Join(root, ".claude2", ".claude.json"), util(now.UnixMilli(), 0, 100, "", now.Add(9*time.Hour).Format(time.RFC3339), "Opus", 100))
	utilization(t, filepath.Join(root, ".claude3", ".claude.json"), util(now.UnixMilli(), 12, 100, now.Add(time.Hour).Format(time.RFC3339), now.Add(40*time.Hour).Format(time.RFC3339), "Opus", 90))

	got := Accounts(accs)
	if len(got.Accounts) != 3 {
		t.Fatalf("%d accounts came back, wanted 3", len(got.Accounts))
	}
	if got.Pools != 1 {
		t.Fatalf("%d pools, wanted 1", got.Pools)
	}
	want := []struct {
		name              string
		session, week     int
		sharedWith        int
		weekModel         string
		weekModelPercent  int
		sessionResetKnown bool
	}{
		{"claude", 28, 4, 2, "Fable", 5, true},
		{"claude2", 0, 100, 2, "Opus", 100, false},
		{"claude3", 12, 100, 2, "Opus", 90, true},
	}
	for i, w := range want {
		a := got.Accounts[i]
		if a.Name != w.name {
			t.Fatalf("account %d is %q, wanted %q", i, a.Name, w.name)
		}
		if !a.Known {
			t.Fatalf("%s: a reading was written and the report says none was found", a.Name)
		}
		if a.Session.Percent != w.session || a.Week.Percent != w.week {
			t.Errorf("%s: session %d%% week %d%%, wanted %d%% and %d%%", a.Name, a.Session.Percent, a.Week.Percent, w.session, w.week)
		}
		if a.WeekModel.Model != w.weekModel || a.WeekModel.Percent != w.weekModelPercent {
			t.Errorf("%s: the model window says %q at %d%%, wanted %q at %d%%", a.Name, a.WeekModel.Model, a.WeekModel.Percent, w.weekModel, w.weekModelPercent)
		}
		if len(a.SharedWith) != w.sharedWith {
			t.Errorf("%s: shared with %v, wanted %d others", a.Name, a.SharedWith, w.sharedWith)
		}
		if (a.Session.ResetsAt != 0) != w.sessionResetKnown {
			t.Errorf("%s: the session reset is %d, and known was meant to be %v", a.Name, a.Session.ResetsAt, w.sessionResetKnown)
		}
		if a.Session.Measured != w.sessionResetKnown {
			t.Errorf("%s: measured=%v with a reset time of %d — the two have to agree", a.Name, a.Session.Measured, a.Session.ResetsAt)
		}
	}
}

/*
The one line that must never be invented.

An account nobody has run has no reading on disk. Zero percent used is the
most dangerous possible answer there — it says "carry on" about a window
nobody measured — so the report has to come back saying it knows nothing.
*/
func TestAnAccountWithNoReadingSaysSoRatherThanZero(t *testing.T) {
	_, accs := home(t, false, "claude")
	got := Accounts(accs)
	a := got.Accounts[0]
	if a.Known || a.Session.Known || a.Week.Known || a.WeekModel.Known {
		t.Fatalf("nothing was written and the report claims a reading: %+v", a)
	}
	if a.Source != "" || a.FetchedAt != 0 {
		t.Fatalf("nothing was written and the report names a source %q fetched at %d", a.Source, a.FetchedAt)
	}
	if a.Session.Left() != 100 {
		t.Fatalf("an unmeasured window says %d%% is left — an unknown must not read as spent", a.Session.Left())
	}
}

// The default account's state file sits beside its directory, not inside it.
func TestTheDefaultAccountsStateIsFoundBesideItsDirectory(t *testing.T) {
	root, accs := home(t, false, "claude")
	now := time.Now().UTC()
	utilization(t, filepath.Join(root, ".claude.json"), util(now.UnixMilli(), 42, 7, now.Add(time.Hour).Format(time.RFC3339), now.Add(time.Hour).Format(time.RFC3339), "Fable", 1))

	session, week, _, fetched, source := Limits(accs[0].Dir)
	if source != filepath.Join(root, ".claude.json") {
		t.Fatalf("the reading came from %q", source)
	}
	if session.Percent != 42 || week.Percent != 7 {
		t.Fatalf("session %d%% week %d%%, wanted 42%% and 7%%", session.Percent, week.Percent)
	}
	if fetched != now.UnixMilli() {
		t.Fatalf("fetched at %d, wanted %d", fetched, now.UnixMilli())
	}
}

// A state file with no utilisation in it at all is not a reading.
func TestAStateFileWithoutAReadingIsNotOne(t *testing.T) {
	root, accs := home(t, false, "claude")
	if err := os.WriteFile(filepath.Join(root, ".claude.json"), []byte(`{"numStartups":3}`), 0o600); err != nil {
		t.Fatal(err)
	}
	session, week, model, _, source := Limits(accs[0].Dir)
	if source == "" {
		t.Fatal("the file is there and was not found")
	}
	if session.Known || week.Known || model.Known {
		t.Fatalf("a file with no utilisation produced readings: %+v %+v %+v", session, week, model)
	}
}

// The older shape — five_hour / seven_day without the limits array — still
// reads, because an account that has not run since will have nothing else.
func TestTheOlderShapeIsStillRead(t *testing.T) {
	root, accs := home(t, false, "claude")
	at := time.Now().UTC().Add(3 * time.Hour).Format(time.RFC3339)
	utilization(t, filepath.Join(root, ".claude.json"),
		`{"fetchedAtMs":1700000000000,"utilization":{"five_hour":{"utilization":63,"resets_at":"`+at+`"},"seven_day":{"utilization":9,"resets_at":null}}}`)

	session, week, _, _, _ := Limits(accs[0].Dir)
	if !session.Known || session.Percent != 63 {
		t.Fatalf("the five-hour window read as %+v, wanted 63%%", session)
	}
	if !week.Known || week.Percent != 9 || week.ResetsAt != 0 {
		t.Fatalf("the weekly window read as %+v, wanted 9%% with no reset time", week)
	}
}

// ---- the windows ---------------------------------------------------------

func TestAWindowStartsOneLengthBeforeItsReset(t *testing.T) {
	now := time.Date(2026, 9, 13, 9, 30, 0, 0, time.UTC)
	reset := now.Add(80 * time.Minute)

	at, measured := startOf(Window{Known: true, ResetsAt: reset.UnixMilli()}, now, sessionLength)
	if !measured {
		t.Fatal("a window with a reset time has a real start and said it does not")
	}
	if got := time.UnixMilli(at).UTC(); !got.Equal(reset.Add(-sessionLength)) {
		t.Fatalf("the window started at %s, wanted %s", got, reset.Add(-sessionLength))
	}

	at, measured = startOf(Window{}, now, sessionLength)
	if measured {
		t.Fatal("a window with no reset time has no real start and claims one")
	}
	if got := time.UnixMilli(at).UTC(); !got.Equal(now.Add(-sessionLength)) {
		t.Fatalf("without a reset it reached back to %s, wanted the last five hours from %s", got, now.Add(-sessionLength))
	}
}

/*
The window's start is a moment, not an hour.

The spend is bucketed by the hour so that seven days of transcripts do not
have to be read again on every look. A window that opened at 10:50 wants
ten minutes of the ten o'clock hour and not the hour, so that one hour is
read out of the files exactly. This is the test that the boundary is not
quietly rounded: four lines, two on each side of it.
*/
func TestTheSpendIsCountedFromTheWindowsRealStartNotTheHour(t *testing.T) {
	root, accs := home(t, false, "claude")
	projects := filepath.Join(root, ".claude", "projects")

	now := time.Now().UTC()
	// Ten minutes before the current hour began: the window's start lies
	// inside the hour before it, which is the case the buckets cannot answer.
	open := now.Truncate(time.Hour).Add(-10 * time.Minute)
	transcript(t, projects, "work", "a", "opus",
		open.Add(-20*time.Minute), // before the window opened
		open.Add(-1*time.Minute),  // still before, same hour
		open.Add(1*time.Minute),   // inside, same hour
		open.Add(20*time.Minute),  // inside, the next hour
	)

	p := pools(accs)[0]
	sp := loadCache()
	got := p.spend(sp, map[int64]bool{open.UnixMilli(): true}, now)[open.UnixMilli()]
	if got.total.Messages != 2 {
		t.Fatalf("%d messages fell inside the window, wanted the 2 after it opened", got.total.Messages)
	}
	// Every line is 1 in, 2 out, 3 written, 4 read.
	want := Item{In: 2, Out: 4, CacheWrite: 6, CacheRead: 8, Messages: 2}
	if got.total != want {
		t.Fatalf("the window adds up to %+v, wanted %+v", got.total, want)
	}
	if got.byModel["opus"] == nil || got.byModel["opus"].Messages != 2 {
		t.Fatalf("by model it came out %+v", got.byModel)
	}
}

// A line with no readable timestamp belongs to no window: a spend that cannot
// be placed in time must not be added to the one somebody is deciding by.
func TestALineWithNoTimestampIsInNoWindow(t *testing.T) {
	root, accs := home(t, false, "claude")
	dir := filepath.Join(root, ".claude", "projects", "work")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"type":"assistant","cwd":"/work","timestamp":"","message":{"model":"opus","usage":{"input_tokens":5000,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "a.jsonl"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	p := pools(accs)[0]
	from := now.Add(-sessionLength).UnixMilli()
	got := p.spend(loadCache(), map[int64]bool{from: true}, now)[from]
	if got.total.Total() != 0 {
		t.Fatalf("a line with no time landed in the window: %+v", got.total)
	}

	// It is still counted in the history, where it is honest: the report by
	// day keeps it under its own heading.
	all := Compute(accs, 0)
	if all.Sum.In != 5000 {
		t.Fatalf("the history lost the line as well: %+v", all.Sum)
	}
}

/*
The total is the pool once, not once per account.

	Three accounts reading one directory and a total that adds each of them
	would report three times the tokens actually spent — the exact mistake the
	old byAccount split made in the other direction.
*/
func TestASharedPoolIsAddedIntoTheTotalOnce(t *testing.T) {
	root, accs := home(t, true, "claude", "claude2", "claude3")
	now := time.Now().UTC()
	transcript(t, filepath.Join(root, ".claude", "projects"), "work", "a", "opus",
		now.Add(-10*time.Minute), now.Add(-20*time.Minute))

	got := Accounts(accs)
	if got.Total.Accounts != 3 {
		t.Fatalf("the total says %d accounts", got.Total.Accounts)
	}
	// Two lines, one in each: 1+1 input, 2+2 output.
	want := Item{In: 2, Out: 4, CacheWrite: 6, CacheRead: 8, Messages: 2}
	if got.Total.Session != want {
		t.Fatalf("the total for the last five hours is %+v, wanted %+v — the pool counted once", got.Total.Session, want)
	}
	if got.Total.Week != want {
		t.Fatalf("the total for the week is %+v, wanted %+v", got.Total.Week, want)
	}
	// And each account shows the pool's figure, not a third of it.
	for _, a := range got.Accounts {
		if a.Session.Spend.Messages != 2 {
			t.Fatalf("%s shows %d messages, wanted the pool's 2", a.Name, a.Session.Spend.Messages)
		}
	}
}

// Two pools are both in the total, added rather than deduplicated away.
func TestSeparatePoolsAreBothInTheTotal(t *testing.T) {
	root, accs := home(t, false, "claude", "claude2")
	now := time.Now().UTC()
	transcript(t, filepath.Join(root, ".claude", "projects"), "work", "a", "opus", now.Add(-5*time.Minute))
	transcript(t, filepath.Join(root, ".claude2", "projects"), "work", "b", "sonnet", now.Add(-5*time.Minute))

	got := Accounts(accs)
	if got.Pools != 2 {
		t.Fatalf("%d pools, wanted 2", got.Pools)
	}
	if got.Total.Session.Messages != 2 {
		t.Fatalf("the total counted %d messages, wanted one from each pool", got.Total.Session.Messages)
	}
	if len(got.Total.ByModel) != 2 {
		t.Fatalf("the total by model came out %+v, wanted both models", got.Total.ByModel)
	}
	if got.Accounts[0].Session.Spend.Messages != 1 || got.Accounts[1].Session.Spend.Messages != 1 {
		t.Fatalf("each account should see only its own directory: %+v", got.Accounts)
	}
	if len(got.Accounts[0].SharedWith) != 0 {
		t.Fatalf("an account with a directory of its own is shared with %v", got.Accounts[0].SharedWith)
	}
}

// What is left, for the caller that decides something with it.
func TestHowMuchIsLeft(t *testing.T) {
	cases := []struct {
		w    Window
		left int
		why  string
	}{
		{Window{Known: true, Percent: 0}, 100, "nothing used"},
		{Window{Known: true, Percent: 28}, 72, "the reference screen's own example"},
		{Window{Known: true, Percent: 100}, 0, "full"},
		{Window{Known: true, Percent: 140}, 0, "past full never reads as negative"},
		{Window{}, 100, "unmeasured must not read as spent"},
	}
	for _, c := range cases {
		if got := c.w.Left(); got != c.left {
			t.Errorf("%s: %d%% left, wanted %d%%", c.why, got, c.left)
		}
	}
}

// Which account is close to the wall, and at which threshold.
func TestWhichAccountIsCloseToTheWall(t *testing.T) {
	a := AccountUsage{
		Session:   Window{Kind: KindSession, Known: true, Percent: 30},
		Week:      Window{Kind: KindWeek, Known: true, Percent: 82},
		WeekModel: Window{Kind: KindWeekModel, Known: true, Percent: 40},
	}
	cases := []struct {
		at   int
		hot  bool
		kind string
	}{
		{0, false, ""},  // no threshold set: nothing is hot
		{90, false, ""}, // under everything
		{82, true, KindWeek},
		{80, true, KindWeek},
		{30, true, KindSession}, // the session window is checked first
	}
	for _, c := range cases {
		w, hot := a.Hot(c.at)
		if hot != c.hot || (hot && w.Kind != c.kind) {
			t.Errorf("at %d%%: hot=%v on %q, wanted hot=%v on %q", c.at, hot, w.Kind, c.hot, c.kind)
		}
	}
	quiet := AccountUsage{Week: Window{Kind: KindWeek, Percent: 100}}
	if _, hot := quiet.Hot(50); hot {
		t.Error("a window nobody measured was called hot at 100% — an unknown is not a reading")
	}
}
