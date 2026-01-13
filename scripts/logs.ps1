<#
.SYNOPSIS
    Shows live logs from Kometa Preview Studio containers.

.DESCRIPTION
    This script follows the Docker Compose logs for all services.
    Press Ctrl+C to stop viewing logs.

.NOTES
    Requires: Windows PowerShell 5.1+, Docker Desktop running
#>

$ErrorActionPreference = "Stop"

# Helper functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

# Determine repo root (scripts are in repo_root/scripts/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Info "Changing to repository root: $RepoRoot"
Set-Location $RepoRoot

Write-Info "Following logs (press Ctrl+C to stop)..."
Write-Host ""

docker-compose logs -f
