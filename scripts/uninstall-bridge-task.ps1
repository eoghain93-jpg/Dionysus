# Removes the DionysusPrintBridge scheduled task.
#
#   powershell -ExecutionPolicy Bypass -File scripts\uninstall-bridge-task.ps1

$ErrorActionPreference = 'Stop'
$taskName = 'DionysusPrintBridge'

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Task '$taskName' is not installed."
    exit 0
}

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Removed scheduled task: $taskName" -ForegroundColor Green
