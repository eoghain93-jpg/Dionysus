@echo off
REM Wrapper for the print bridge — invoked by the DionysusPrintBridge
REM scheduled task at user logon. Expects print-bridge.mjs to be in the
REM SAME folder as this script. Logs to logs\bridge.log alongside.

cd /d "%~dp0"
if not exist logs mkdir logs

echo. >> logs\bridge.log
echo === Started %date% %time% === >> logs\bridge.log

node print-bridge.mjs >> logs\bridge.log 2>&1
