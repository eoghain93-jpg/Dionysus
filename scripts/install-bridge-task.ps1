# Registers the print bridge as a Windows scheduled task that starts at user
# logon and restarts on failure.
#
# Designed to live in a flat folder on the till PC (e.g. C:\dionysus-bridge\)
# alongside print-bridge.mjs and start-bridge.cmd. Does NOT assume the full
# Dionysus repo is checked out — only the four files in this folder are needed.
#
# Run this ONCE after dropping the files onto the till PC:
#   powershell -ExecutionPolicy Bypass -File install-bridge-task.ps1
#
# Requirements:
#   - Node.js installed and on PATH (`node --version` works)
#   - Run as the same user that will be logged in at the till
#   - Admin rights NOT required (task is per-user)

$ErrorActionPreference = 'Stop'

$bridgeDir = $PSScriptRoot
$batFile = Join-Path $bridgeDir 'start-bridge.cmd'
$bridgeJs = Join-Path $bridgeDir 'print-bridge.mjs'
$taskName = 'DionysusPrintBridge'

# Validate the three required files are co-located
if (-not (Test-Path $batFile))  { Write-Error "Missing: $batFile";  exit 1 }
if (-not (Test-Path $bridgeJs)) { Write-Error "Missing: $bridgeJs"; exit 1 }

# Validate Node is reachable
try {
    $nodeVersion = & node --version 2>&1
    Write-Host "Found Node.js $nodeVersion"
} catch {
    Write-Error "node.exe is not on PATH. Install Node.js 20 LTS: https://nodejs.org/"
    exit 1
}

# Remove existing task if already installed (idempotent reinstall)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing $taskName task..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $batFile -WorkingDirectory $bridgeDir

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

# Hidden window, allow on battery, restart up to 3 times if the process exits
# non-zero, 365-day execution limit (default 72h would kill the bridge).
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365) `
    -Hidden

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Dionysus print bridge — forwards browser POSTs to Star mC-Print3 on TCP 9100'

Write-Host ""
Write-Host "Installed scheduled task: $taskName" -ForegroundColor Green
Write-Host "Bridge folder: $bridgeDir"
Write-Host ""
Write-Host "Start it RIGHT NOW without rebooting:"
Write-Host "  Start-ScheduledTask -TaskName $taskName"
Write-Host ""
Write-Host "Verify it's listening (should respond, not 'connection refused'):"
Write-Host "  curl http://127.0.0.1:3001"
Write-Host ""
Write-Host "Logs: $bridgeDir\logs\bridge.log"
