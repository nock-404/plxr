package find

import (
	"context"
	"sort"
	"strings"
	"time"
)

// MaxNames is how many file names one go-to-file answer carries.
const MaxNames = 50

/* NamesReport is go-to-file's answer: paths whose names match what was typed,
 * best first, relative to the folder asked about.
 *
 * The palette reached every command, view and session there is and no file:
 * opening one meant the tree, a folder at a time, or a content search for a
 * word that happened to be inside it. Typing part of a name is how every
 * editor does it, and it is how a file is looked for here as well. */
type NamesReport struct {
	Paths []string `json:"paths"`
	Total int      `json:"total"` // files considered
	// Capped names every bound that was reached, the way Report does: a short
	// list that looks complete is worse than one that says it is short.
	Capped []string `json:"capped"`
	TookMs int64    `json:"took_ms"`
}

// Names lists the files under root whose paths match q, best first, at most
// limit of them. What counts as a file is what a search reads: git's list inside
// a repository, a walk that steps over the usual heaps outside one.
func Names(root, q string, limit int) (NamesReport, error) {
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	list, _, err := files(ctx, root)
	if err != nil && len(list) == 0 {
		return NamesReport{}, err
	}
	report := NamesReport{Paths: []string{}, Capped: []string{}}
	if len(list) > MaxFiles {
		list = list[:MaxFiles]
		report.Capped = append(report.Capped, "files")
	}
	report.Total = len(list)
	if limit <= 0 || limit > MaxNames {
		limit = MaxNames
	}
	type scored struct {
		path  string
		score int
	}
	var hits []scored
	for _, p := range list {
		if s := nameScore(q, p); s >= 0 {
			hits = append(hits, scored{p, s})
		}
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		return len(hits[i].path) < len(hits[j].path)
	})
	if len(hits) > limit {
		hits = hits[:limit]
		report.Capped = append(report.Capped, "names")
	}
	for _, h := range hits {
		report.Paths = append(report.Paths, h.path)
	}
	report.TookMs = time.Since(start).Milliseconds()
	return report, nil
}

/* nameScore ranks one path against what was typed, or -1 when it does not match.
 *
 * The file's own name counts before the folders it sits in: somebody typing
 * "keymap" means keymap.ts, not every file under a folder called keymaps. In
 * order: the name itself, a name that starts with it, a name that holds it, a
 * path that holds it, and last the letters in order anywhere in the path, so
 * "kmts" still finds keymap.ts. */
func nameScore(q, path string) int {
	if q == "" {
		return 0
	}
	lq := strings.ToLower(q)
	lp := strings.ToLower(path)
	base := lp[strings.LastIndex(lp, "/")+1:]
	switch {
	case base == lq:
		return 3000
	case strings.HasPrefix(base, lq):
		return 2500 - min(len(base), 400)
	case strings.Contains(base, lq):
		return 2000 - min(strings.Index(base, lq), 400)
	case strings.Contains(lp, lq):
		return 1500 - min(strings.Index(lp, lq), 400)
	}
	qi, gaps := 0, 0
	for i := 0; i < len(lp) && qi < len(lq); i++ {
		if lp[i] == lq[qi] {
			qi++
		} else if qi > 0 {
			gaps++
		}
	}
	if qi == len(lq) {
		return 1000 - min(gaps, 999)
	}
	return -1
}
