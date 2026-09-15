# plxr, installed with one command.
#
#   irm https://raw.githubusercontent.com/nock-404/plxr/main/install.ps1 | iex
#
# What it does: asks GitHub for the newest release, downloads the Windows
# archive, and puts the program under %LOCALAPPDATA%\Programs\plxr with a
# Start-menu shortcut. No admin rights, no installer, nothing in the registry.
$ErrorActionPreference = 'Stop'
$repo = 'nock-404/plxr'

function Say($text) { Write-Host "  $text" }

$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
$asset = "plxr-windows-$arch.zip"

# The newest version, read off the redirect /releases/latest sends.
$latest = [System.Net.WebRequest]::Create("https://github.com/$repo/releases/latest")
$latest.AllowAutoRedirect = $false
$tag = ($latest.GetResponse().Headers['Location'] -split '/')[-1]
if (-not $tag) { throw 'could not work out the newest version' }
Say "plxr $tag, $asset"

$tmp = Join-Path $env:TEMP ("plxr-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
	$url = "https://github.com/$repo/releases/download/$tag/$asset"
	Invoke-WebRequest -Uri $url -OutFile "$tmp\plxr.zip"
	Expand-Archive -Path "$tmp\plxr.zip" -DestinationPath "$tmp\out" -Force

	$dest = Join-Path $env:LOCALAPPDATA 'Programs\plxr'
	New-Item -ItemType Directory -Path $dest -Force | Out-Null
	# The window may be running: a copy over a running program fails, so it is
	# closed first and only the one this installs is started again.
	Get-Process plxr -ErrorAction SilentlyContinue | Stop-Process -Force
	Copy-Item "$tmp\out\*" $dest -Recurse -Force

	$exe = Join-Path $dest 'plxr.exe'
	$menu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\plxr.lnk'
	$shell = New-Object -ComObject WScript.Shell
	$link = $shell.CreateShortcut($menu)
	$link.TargetPath = $exe
	$link.WorkingDirectory = $dest
	$link.Description = 'Control room for coding CLI sessions'
	$link.Save()

	Say "installed: $exe"
	Say "start it:  it is in the Start menu as plxr"
} finally {
	Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
