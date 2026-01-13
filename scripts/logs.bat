@echo off
REM Kometa Preview Studio - Logs Script
REM Double-click this file to view live logs (Ctrl+C to stop)

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0logs.ps1"
pause
