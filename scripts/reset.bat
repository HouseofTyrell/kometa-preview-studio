@echo off
REM Kometa Preview Studio - Reset Script
REM Double-click this file to reset the application (removes volumes/data)

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset.ps1"
pause
