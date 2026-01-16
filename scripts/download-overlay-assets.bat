@echo off
REM Kometa Preview Studio - Download Overlay Assets
REM Double-click this file to download overlay assets

cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-overlay-assets.ps1"
pause
