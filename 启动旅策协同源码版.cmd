@echo off
chcp 65001 >nul
title 旅策协同 4.2.0 源码版
node "%~dp0tourism\agent-server.cjs"
if errorlevel 1 pause
