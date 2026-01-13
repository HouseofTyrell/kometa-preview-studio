<#
.SYNOPSIS
    Stops Kometa Preview Studio containers.

.DESCRIPTION
    This script stops all Docker Compose services for Kometa Preview Studio.

.NOTES
    Requires: Windows PowerShell 5.1+, Docker Desktop running
#>

$ErrorActionPreference = "Stop"

# Helper functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERR]  $Message" -ForegroundColor Red
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK]   $Message" -ForegroundColor Green
}

# Determine repo root (scripts are in repo_root/scripts/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Info "Changing to repository root: $RepoRoot"
Set-Location $RepoRoot

# Stop containers
Write-Info "Stopping Kometa Preview Studio..."

docker-compose down
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker-compose down failed"
    exit 1
}

Write-Success "Kometa Preview Studio stopped"
Write-Host ""
Write-Host "To start again, run: .\scripts\start.ps1"
Write-Host ""
