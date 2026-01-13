<#
.SYNOPSIS
    Resets Kometa Preview Studio to a clean state.

.DESCRIPTION
    This script removes all containers, volumes, and orphaned containers,
    then rebuilds all images from scratch without cache.
    WARNING: This will delete all job data stored in Docker volumes.

.NOTES
    Requires: Windows PowerShell 5.1+, Docker Desktop running
#>

$ErrorActionPreference = "Stop"

# Helper functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
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

# Warning prompt
Write-Host ""
Write-Warn "=========================================="
Write-Warn "              WARNING"
Write-Warn "=========================================="
Write-Warn "This will:"
Write-Warn "  - Stop and remove all containers"
Write-Warn "  - Remove all Docker volumes (job data)"
Write-Warn "  - Remove orphaned containers"
Write-Warn "  - Rebuild all images from scratch"
Write-Host ""

$confirmation = Read-Host "Are you sure you want to continue? (y/N)"
if ($confirmation -ne 'y' -and $confirmation -ne 'Y') {
    Write-Info "Reset cancelled"
    exit 0
}

Write-Host ""

# Remove containers and volumes
Write-Info "Stopping containers and removing volumes..."

docker-compose down -v --remove-orphans
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker-compose down failed"
    exit 1
}
Write-Success "Containers and volumes removed"

# Rebuild without cache
Write-Info "Rebuilding images without cache (this may take several minutes)..."

docker-compose build --no-cache
if ($LASTEXITCODE -ne 0) {
    Write-Err "docker-compose build --no-cache failed"
    exit 1
}
Write-Success "Images rebuilt successfully"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Reset complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Run .\scripts\start.ps1 to restart Kometa Preview Studio"
Write-Host ""
