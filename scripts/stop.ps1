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

# Detect compose command (v2 or v1)
$script:ComposeCmd = $null

$null = docker compose version 2>&1
if ($LASTEXITCODE -eq 0) {
    $script:ComposeCmd = "docker compose"
} else {
    $null = docker-compose version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $script:ComposeCmd = "docker-compose"
    }
}

if (-not $script:ComposeCmd) {
    Write-Err "docker-compose is not available."
    exit 1
}

function Invoke-Compose {
    param([string]$Arguments)
    if ($script:ComposeCmd -eq "docker compose") {
        Invoke-Expression "docker compose $Arguments"
    } else {
        Invoke-Expression "docker-compose $Arguments"
    }
    return $LASTEXITCODE
}

# Stop containers
Write-Info "Stopping Kometa Preview Studio..."

$null = Invoke-Compose "down"
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker-compose down failed"
    exit 1
}

Write-Success "Kometa Preview Studio stopped"
Write-Host ""
Write-Host "To start again, run: .\scripts\start.ps1"
Write-Host ""
