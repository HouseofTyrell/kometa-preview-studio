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

function Write-Err {
    param([string]$Message)
    Write-Host "[ERR]  $Message" -ForegroundColor Red
}

# Determine repo root (scripts are in repo_root/scripts/)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir

Write-Info "Changing to repository root: $RepoRoot"
Set-Location $RepoRoot

# Detect compose command (v2 or v1)
$ComposeCmd = $null

$null = docker compose version 2>&1
if ($LASTEXITCODE -eq 0) {
    $ComposeCmd = "docker compose"
} else {
    $null = docker-compose version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $ComposeCmd = "docker-compose"
    }
}

if (-not $ComposeCmd) {
    Write-Err "docker-compose is not available."
    exit 1
}

Write-Info "Following logs (press Ctrl+C to stop)..."
Write-Host ""

if ($ComposeCmd -eq "docker compose") {
    docker compose logs -f
} else {
    docker-compose logs -f
}
