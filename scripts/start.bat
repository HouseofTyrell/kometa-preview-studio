@echo off
REM Kometa Preview Studio - Start Script
REM Double-click this file to start the application

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
