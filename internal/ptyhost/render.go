package ptyhost

import "strings"

// maxCol fängt kaputte Sequenzen ab, damit eine Zeile nicht ins Unendliche wächst.
const maxCol = 1000

// renderPlain baut aus dem rohen PTY-Strom lesbaren Text.
//
// Ein Regex-Filter reicht dafür nicht: Claude Code setzt jedes Wort einzeln mit
// CSI<n>G auf eine absolute Spalte, statt Leerzeichen zu schicken. Wer die
// Sequenzen nur wegwirft, bekommt "Quicksafetycheck" statt "Quick safety check".
// Also wird hier eine einzelne Zeile tatsächlich gesetzt — Cursor links/rechts,
// Zeile löschen, Bild löschen. Mehr Terminal braucht eine Vorschau nicht.
func renderPlain(raw string) []string {
	var lines []string
	line := make([]rune, 0, 200)
	col := 0

	put := func(r rune) {
		if col >= maxCol {
			return
		}
		for len(line) < col {
			line = append(line, ' ')
		}
		if col < len(line) {
			line[col] = r
		} else {
			line = append(line, r)
		}
		col++
	}
	flush := func() {
		lines = append(lines, strings.TrimRight(string(line), " "))
		line = line[:0]
		col = 0
	}

	rs := []rune(raw)
	for i := 0; i < len(rs); i++ {
		c := rs[i]

		if c == 0x1b {
			if i+1 >= len(rs) {
				break
			}
			switch rs[i+1] {
			case '[': // CSI
				j := i + 2
				for j < len(rs) && (rs[j] >= '0' && rs[j] <= '9' || rs[j] == ';' || rs[j] == '?') {
					j++
				}
				for j < len(rs) && rs[j] >= ' ' && rs[j] <= '/' {
					j++
				}
				if j >= len(rs) {
					i = len(rs)
					break
				}
				n, has := 0, false
				for k := i + 2; k < j && rs[k] >= '0' && rs[k] <= '9'; k++ {
					n, has = n*10+int(rs[k]-'0'), true
				}
				if !has {
					n = 1
				}
				switch rs[j] {
				case 'G': // absolute Spalte, 1-basiert
					if n < 1 {
						n = 1
					}
					col = n - 1
				case 'C': // n nach rechts
					col += n
				case 'D': // n nach links
					if col -= n; col < 0 {
						col = 0
					}
				case 'K': // Rest der Zeile löschen
					if col < len(line) {
						line = line[:col]
					}
				case 'J': // Bild löschen
					lines, line, col = lines[:0], line[:0], 0
				}
				i = j

			case ']': // OSC bis BEL oder ST
				j := i + 2
				for j < len(rs) && rs[j] != 0x07 && rs[j] != 0x1b {
					j++
				}
				if j < len(rs) && rs[j] == 0x1b && j+1 < len(rs) && rs[j+1] == '\\' {
					j++
				}
				i = j

			default:
				i++
			}
			continue
		}

		switch {
		case c == '\r':
			col = 0
		case c == '\n':
			flush()
		case c == '\t':
			col = (col/8 + 1) * 8
		case c < 0x20 || c == 0x7f:
			// verwerfen
		default:
			put(c)
		}
	}
	if len(line) > 0 {
		flush()
	}
	return lines
}
