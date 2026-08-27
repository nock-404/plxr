//go:build windows

package ptyhost

import (
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows kennt keine Prozessgruppen im Unix-Sinn. TerminateProcess trifft
// exactly one PID — if the session starts `npm run dev`, the node grandchild
// survives and keeps holding its port. The counterpart is called a job object: a
// container that processes are assigned to and that terminates them together.
//
// UNTESTED on real hardware. The setup follows Microsoft's documentation, and
// every step falls back individually to the plain terminate, so a failure here
// at worst restores the old behaviour instead of
// schlechteren.

type jobObject struct{ handle windows.Handle }

// afterStart creates a job object and assigns the just-started process to it.
//
// Between start and assignment there is a brief window in which a child could
// escape. CREATE_SUSPENDED with a resume afterwards would be cleaner, but go-pty
// does not hand out the thread handle. For a CLI that forks nothing in its first
// milliseconds this is acceptable.
func afterStart(p *os.Process) any {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil
	}

	// Without this limit the container dies as soon as plxr ends — taking all
	// sessions with it. That is precisely what it must not do.
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
	return &jobObject{handle: job}
}

// killProcess terminates the container along with everything inside it.
//
// There is no gentle shutdown here: Windows has no SIGTERM, and
// TerminateJobObject is always hard. The soft path would be 0x03 into the input
// pipe — which is what the UI does when the user wants to cancel.
func killProcess(p *os.Process, platform any) {
	if j, ok := platform.(*jobObject); ok && j != nil {
		if windows.TerminateJobObject(j.handle, 1) == nil {
			windows.CloseHandle(j.handle)
			return
		}
		windows.CloseHandle(j.handle)
	}
	_ = p.Kill()
}

// killProcessHard exists on Windows only for completeness: TerminateJobObject
// is hard anyway, a second attempt changes nothing.
func killProcessHard(p *os.Process, platform any) { killProcess(p, platform) }

/*
Windows has no SIGSTOP. What comes closest is suspending every thread of

	every process in the job — NtSuspendProcess is undocumented, and walking the
	threads by hand is a race against threads being created while we walk.

	Until that is built and tested on real hardware, freezing reports that it did
	not happen. Claiming an emergency brake that does not brake would be worse
	than not offering one: the user lets go of the mouse and the migration runs.
*/
func freezeProcess(p *os.Process) bool { return false }
func resumeProcess(p *os.Process) bool { return false }
