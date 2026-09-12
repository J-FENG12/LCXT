@echo off
setlocal
cd /d "%~dp0"
"runtime\bin\node.exe" "launcher.cjs"
if errorlevel 1 (
  echo 旅策协同启动失败，请查看 logs\launcher.log。
  pause
)
