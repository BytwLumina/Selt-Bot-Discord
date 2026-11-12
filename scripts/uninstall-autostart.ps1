$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Lumina Selfbot.lnk'

if (Test-Path $lnk) {
  Remove-Item $lnk -Force
  Write-Host 'Da tat tu khoi dong cung Windows.'
} else {
  Write-Host 'Chua bat tu khoi dong.'
}
