@echo off
setlocal
cd /d "%~dp0"
"runtime\bin\node.exe" "tourism\agent-server.cjs"
if errorlevel 1 pause
