//go:build windows

package ptyhost

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows kennt keine Prozessgruppen im Unix-Sinn. TerminateProcess trifft
// genau eine PID — startet die Session `npm run dev`, überlebt der node-Enkel
// und hält seinen Port. Das Gegenstück heißt Job Object: ein Behälter, dem
// Prozesse zugeordnet werden und der sie gemeinsam beendet.
//
// UNGETESTET auf echter Hardware. Der Aufbau folgt der Dokumentation von
// Microsoft, und jeder Schritt fällt einzeln auf das einfache Beenden zurück,
// damit ein Fehler hier höchstens den alten Zustand herstellt statt einen
// schlechteren.

type jobObjekt struct{ handle windows.Handle }

// nachStart legt ein Job Object an und ordnet den eben gestarteten Prozess zu.
//
// Zwischen Start und Zuordnung liegt ein kurzer Moment, in dem ein Kind
// entkommen könnte. Sauberer wäre CREATE_SUSPENDED und ein Resume danach, doch
// go-pty gibt den Thread-Handle nicht heraus. Für ein CLI, das in den ersten
// Millisekunden noch nichts abspaltet, ist das vertretbar.
func nachStart(p *os.Process) any {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil
	}

	// Ohne diese Grenze stirbt der Behälter, sobald plxr endet — und nimmt
	// alle Sessions mit. Genau das soll er nicht.
	var info windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job, windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)),
	); err != nil {
		windows.CloseHandle(job)
		return nil
	}

	h, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(p.Pid))
	if err != nil {
		windows.CloseHandle(job)
		return nil
	}
	defer windows.CloseHandle(h)

	if err := windows.AssignProcessToJobObject(job, h); err != nil {
		windows.CloseHandle(job)
		return nil
	}
	return &jobObjekt{handle: job}
}

// killProcess beendet den Behälter samt allem darin.
//
// Ein sanftes Beenden gibt es hier nicht: Windows kennt kein SIGTERM, und
// TerminateJobObject ist immer hart. Der weiche Weg wäre 0x03 in die
// Eingabe-Pipe — das macht die Oberfläche, wenn der Nutzer abbrechen will.
func killProcess(p *os.Process, plattform any) {
	if j, ok := plattform.(*jobObjekt); ok && j != nil {
		if windows.TerminateJobObject(j.handle, 1) == nil {
			windows.CloseHandle(j.handle)
			return
		}
		windows.CloseHandle(j.handle)
	}
	_ = p.Kill()
}
