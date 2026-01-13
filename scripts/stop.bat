@echo off
REM Kometa Preview Studio - Stop Script
REM Double-click this file to stop the application

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
pause
