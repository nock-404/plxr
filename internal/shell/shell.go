// Package shell ermittelt, womit ein Terminal starten soll.
//
// Ein Terminal, das nur Coding-Agenten startet, ist kein Terminal. Der
// Normalfall ist die Login-Shell des Nutzers — und die richtig zu starten hat
// mehr Fallstricke, als es aussieht: die Shell muss als Login-Shell laufen
// (sonst fehlen PATH-Einträge aus .zprofile), und die Umgebung muss stimmen
// (sonst zeigen Programme keine Farben oder brechen bei Umlauten).
package shell

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Standard liefert das Kommando für eine gewöhnliche Terminalsitzung.
func Standard() []string {
	if runtime.GOOS == "windows" {
		return windowsShell()
	}
	return unixShell()
}

// unixShell startet die Login-Shell.
//
// Das führende "-" im nullten Argument ist die überlieferte Art, einer Shell
// zu sagen, dass sie eine Login-Shell ist. Nur so liest sie .zprofile bzw.
// .bash_profile — und ohne die fehlen die PATH-Einträge, die der Nutzer in
// seiner normalen Konsole hat. go-pty reicht Args unverändert durch, deshalb
// geht es hier über das Argument statt über exec.Cmd.
func unixShell() []string {
	sh := os.Getenv("SHELL")
	if sh == "" {
		// $SHELL fehlt in Diensten und beim Start über LaunchServices.
		if out, err := exec.Command("dscl", ".", "-read",
			filepath.Join("/Users", os.Getenv("USER")), "UserShell").Output(); err == nil {
			if f := strings.Fields(string(out)); len(f) == 2 {
				sh = f[1]
			}
		}
	}
	if sh == "" {
		for _, k := range []string{"/bin/zsh", "/bin/bash", "/bin/sh"} {
			if _, err := os.Stat(k); err == nil {
				sh = k
				break
			}
		}
	}
	if sh == "" {
		sh = "/bin/sh"
	}
	return []string{sh, "-l"}
}

// windowsShell nimmt die beste vorhandene Shell.
//
// Reihenfolge nach Nützlichkeit: PowerShell 7 vor der mitgelieferten
// Windows PowerShell vor cmd.exe. Die Voreinstellung von Windows selbst wäre
// cmd.exe — das will heute niemand mehr.
func windowsShell() []string {
	for _, k := range []string{"pwsh.exe", "powershell.exe"} {
		if p, err := exec.LookPath(k); err == nil {
			// -NoLogo: der Startbanner steht sonst in jeder neuen Sitzung.
			return []string{p, "-NoLogo"}
		}
	}
	if p, err := exec.LookPath("cmd.exe"); err == nil {
		return []string{p}
	}
	return []string{"cmd.exe"}
}

// Umgebung sind die Variablen, die ein Terminal setzen muss.
//
// Ohne TERM erkennen Programme kein Terminal und lassen Farben und
// Zeilenbearbeitung weg. COLORTERM=truecolor schaltet 24-Bit-Farben frei, die
// xterm.js kann. LANG mit UTF-8 verhindert, dass Umlaute und Rahmenzeichen
// als Fragezeichen ankommen — das fehlt erstaunlich oft, wenn ein Programm
// nicht aus einer Konsole gestartet wurde.
func Umgebung(fassung string) []string {
	env := []string{
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"TERM_PROGRAM=plxr",
		"TERM_PROGRAM_VERSION=" + fassung,
	}
	if os.Getenv("LANG") == "" {
		env = append(env, "LANG=en_US.UTF-8")
	}
	return env
}

// Name ist der Anzeigename eines Kommandos, ohne Pfad und Argumente.
func Name(argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	return strings.TrimSuffix(filepath.Base(argv[0]), ".exe")
}
