# Copper Deck – Installation unter Windows 10/11 (ohne Administratorrechte).
# Aufruf im Repository-Ordner (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\install.ps1
#
# - baut Web-App und Helper (npm)
# - baut CopperDeckHelper.exe mit dem csc.exe des .NET Framework 4.x (auf jedem Windows 10/11 vorhanden)
# - kopiert alles nach %LOCALAPPDATA%\CopperDeck\runtime
# - richtet die Aufgabenplanung ein: Start bei der Anmeldung, Neustart nach einem Absturz (Launcher)
#Requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Repo     = Split-Path -Parent $PSScriptRoot
$Base     = Join-Path $env:LOCALAPPDATA 'CopperDeck'
$Runtime  = Join-Path $Base 'runtime'
$Staging  = Join-Path $Base 'runtime.new'
$TaskName = 'Copper Deck Helper'

function Say($m) { Write-Host "> $m" -ForegroundColor Yellow }
function Ok($m)  { Write-Host "OK $m" -ForegroundColor Green }
function Die($m) { Write-Host "FEHLER: $m" -ForegroundColor Red; exit 1 }

# --- Voraussetzungen --------------------------------------------------------
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Die 'node fehlt. Installation: winget install OpenJS.NodeJS.LTS  (danach PowerShell neu öffnen)' }
$Node = $nodeCmd.Source
$nodeMajor = [int]((& $Node -p 'process.versions.node').Split('.')[0])
if ($nodeMajor -lt 22) { Die "Node $nodeMajor ist zu alt, mindestens 22 nötig (winget upgrade OpenJS.NodeJS.LTS)." }

$mkcert = (Get-Command mkcert -ErrorAction SilentlyContinue)
if (-not $mkcert) {
  $wingetLink = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\mkcert.exe'
  if (Test-Path $wingetLink) { $mkcertPath = $wingetLink } else { Die 'mkcert fehlt. Installation: winget install FiloSottile.mkcert, danach: mkcert -install' }
} else { $mkcertPath = $mkcert.Source }
$caRoot = (& $mkcertPath -CAROOT).Trim()
if (-not (Test-Path (Join-Path $caRoot 'rootCA.pem'))) { Die 'Die mkcert-Root-CA fehlt. Einmal ausführen: mkcert -install' }

$fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
if (-not (Test-Path (Join-Path $fw 'csc.exe'))) { $fw = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319' }
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { Die ".NET Framework 4.x (csc.exe) nicht gefunden unter $fw" }
Ok "node $(& $Node -v), mkcert, csc.exe"

# --- Bauen ------------------------------------------------------------------
Say 'Baue Web-App und Helper'
Push-Location $Repo
try {
  if (-not (Test-Path (Join-Path $Repo 'node_modules'))) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Die 'npm ci fehlgeschlagen' }
  }
  npm run build --silent
  if ($LASTEXITCODE -ne 0) { Die 'npm run build fehlgeschlagen' }
} finally { Pop-Location }
Ok 'Build fertig'

Say 'Baue CopperDeckHelper.exe'
$nativeOut = Join-Path $Repo 'helper\dist\windows'
New-Item -ItemType Directory -Force -Path $nativeOut | Out-Null
$wpf = Join-Path $fw 'WPF'
$cscArgs = @(
  '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
  "/out:$(Join-Path $nativeOut 'CopperDeckHelper.exe')",
  '/r:System.dll', '/r:System.Core.dll', '/r:Microsoft.CSharp.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll', '/r:System.Xaml.dll',
  "/r:$(Join-Path $wpf 'PresentationCore.dll')", "/r:$(Join-Path $wpf 'WindowsBase.dll')",
  (Join-Path $Repo 'helper\native\windows\CopperDeckHelper.cs')
)
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { Die 'csc.exe konnte CopperDeckHelper.exe nicht bauen (Meldungen oben).' }
Ok 'CopperDeckHelper.exe gebaut'

# --- Laufenden Helper beenden ------------------------------------------------
$oldExe = Join-Path $Runtime 'helper\CopperDeckHelper.exe'
if (Test-Path $oldExe) {
  Say 'Beende laufenden Helper'
  & $oldExe stop | Out-Null
  Start-Sleep -Milliseconds 500
}

# --- Laufzeitdateien ---------------------------------------------------------
Say "Kopiere Laufzeitdateien nach $Runtime"
if (Test-Path $Staging) { Remove-Item -Recurse -Force $Staging }
New-Item -ItemType Directory -Force -Path (Join-Path $Staging 'helper'), (Join-Path $Staging 'bin') | Out-Null
Copy-Item (Join-Path $Repo 'helper\dist\copper-deck.mjs'), (Join-Path $Repo 'helper\dist\copper-deck.mjs.map') (Join-Path $Staging 'helper')
Copy-Item (Join-Path $nativeOut 'CopperDeckHelper.exe') (Join-Path $Staging 'helper')
Copy-Item -Recurse (Join-Path $Repo 'web\dist\web\browser') (Join-Path $Staging 'web')
$script = Join-Path $Runtime 'helper\copper-deck.mjs'
@{ node = $Node; script = $script } | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $Staging 'helper\launch.json')
# CLI-Starter (copper-deck pair, status, …)
"@echo off`r`n`"$Node`" `"$script`" %*`r`n" | Set-Content -Encoding ASCII (Join-Path $Staging 'bin\copper-deck.cmd')
if (Test-Path $Runtime) { Remove-Item -Recurse -Force $Runtime }
Move-Item $Staging $Runtime
Ok 'Laufzeitdateien bereit'

# --- CLI im PATH -------------------------------------------------------------
$binDir = Join-Path $Runtime 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath.Split(';') | Where-Object { $_ -eq $binDir }).Count -eq 0) {
  [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $binDir).TrimStart(';'), 'User')
  Ok "CLI: $binDir (neue PowerShell-Fenster finden copper-deck)"
} else { Ok "CLI: $binDir" }
$env:Path = "$env:Path;$binDir"

# --- Autostart über die Aufgabenplanung -------------------------------------
Say "Richte Aufgabe '$TaskName' ein"
$exe = Join-Path $Runtime 'helper\CopperDeckHelper.exe'
$user = "$env:USERDOMAIN\$env:USERNAME"
$action    = New-ScheduledTaskAction -Execute $exe -Argument 'run' -WorkingDirectory (Join-Path $Runtime 'helper')
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
               -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
# Interaktiv und ohne erhöhte Rechte: nur so erreichen Tastenkombinationen die Fenster des Benutzers.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Ok 'Aufgabe eingerichtet und gestartet'

# --- Warten, bis der Helper antwortet ---------------------------------------
$cli = Join-Path $binDir 'copper-deck.cmd'
$status = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  $status = & $cli status 2>$null
  if ($LASTEXITCODE -eq 0) { break }
}
if ($LASTEXITCODE -ne 0) { Die "Der Helper antwortet nicht. Log: $(Join-Path $Base 'Logs\launcher.log')" }
$url = (($status -join "`n") | ConvertFrom-Json).url
Ok "Helper läuft: $url"

# --- Netzwerk und Firewall ---------------------------------------------------
$public = Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' }
if ($public) {
  Write-Host ''
  Write-Host "Hinweis: Das Netzwerk '$($public[0].Name)' ist als ÖFFENTLICH eingestuft. Windows blockiert dann eingehende Verbindungen." -ForegroundColor Yellow
  Write-Host "  Im eigenen WLAN: Einstellungen → Netzwerk und Internet → WLAN → Netzwerk → Netzwerkprofil 'Privat'." -ForegroundColor Yellow
}
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
  if (-not (Get-NetFirewallRule -DisplayName 'Copper Deck' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'Copper Deck' -Direction Inbound -Program $Node -Protocol TCP -LocalPort 7443 -Action Allow -Profile Private, Domain | Out-Null
    Ok "Firewall-Regel 'Copper Deck' (TCP 7443, private Netzwerke) angelegt"
  }
} else {
  Write-Host ''
  Write-Host "Firewall: Fragt Windows beim ersten Start nach 'Node.js', bitte für PRIVATE Netzwerke zulassen." -ForegroundColor Yellow
  Write-Host '  Ohne Nachfrage, aber mit Adminrechten: install.ps1 einmal in einer Administrator-PowerShell ausführen.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host "Fertig. Copper Deck: $url"
Write-Host ''
Write-Host 'Nächste Schritte (README, Abschnitt Windows):'
Write-Host '  1. copper-deck ca        → rootCA.pem aufs iPhone/iPad bringen und dort vertrauen'
Write-Host "  2. In Safari $url öffnen → Teilen → Zum Home-Bildschirm"
Write-Host '  3. copper-deck pair      → Code in der App eingeben'
