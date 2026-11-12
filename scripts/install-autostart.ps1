$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-forever.cmd'
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Lumina Selfbot.lnk'

if (-not (Test-Path $runner)) {
  Write-Host "Khong tim thay $runner"
  exit 1
}

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:WINDIR 'System32\cmd.exe'
$s.Arguments = '/c ""' + $runner + '""'
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = 'Lumina selfbot'
$s.Save()

Write-Host "Da bat tu khoi dong cung Windows:"
Write-Host "  $lnk"
