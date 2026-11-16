# Copper Deck – Deinstallation unter Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1          # Programm entfernen, Daten behalten
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1 -Purge   # auch Konfiguration, Kopplungen, Zertifikat löschen
#Requires -Version 5.1
param([switch]$Purge)
$ErrorActionPreference = 'Stop'

$Base     = Join-Path $env:LOCALAPPDATA 'CopperDeck'
$Runtime  = Join-Path $Base 'runtime'
$TaskName = 'Copper Deck Helper'

$exe = Join-Path $Runtime 'helper\CopperDeckHelper.exe'
if (Test-Path $exe) { & $exe stop | Out-Null }
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Aufgabe '$TaskName' entfernt"
}

$binDir = Join-Path $Runtime 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath) {
  $rest = ($userPath.Split(';') | Where-Object { $_ -and $_ -ne $binDir }) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $rest, 'User')
}

if (Test-Path $Runtime) { Remove-Item -Recurse -Force $Runtime; Write-Host "Entfernt: $Runtime" }
$shortcuts = Join-Path ([Environment]::GetFolderPath('Programs')) 'Copper Deck'
if (Test-Path $shortcuts) { Write-Host "Mit add-app angelegte Verknüpfungen bleiben erhalten: $shortcuts" }

if ($Purge) {
  if (Test-Path $Base) { Remove-Item -Recurse -Force $Base; Write-Host "Daten gelöscht: $Base" }
} else {
  Write-Host "Daten bleiben erhalten (Konfiguration, Kopplungen, Zertifikat): $Base"
}
if (Get-NetFirewallRule -DisplayName 'Copper Deck' -ErrorAction SilentlyContinue) {
  Write-Host "Die Firewall-Regel 'Copper Deck' entfernt nur eine Administrator-PowerShell: Remove-NetFirewallRule -DisplayName 'Copper Deck'"
}
Write-Host 'Copper Deck ist deinstalliert.'
