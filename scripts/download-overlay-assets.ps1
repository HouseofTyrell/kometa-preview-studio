<#
.SYNOPSIS
    Downloads Kometa default overlay assets from the Default-Images repository.

.DESCRIPTION
    This ensures the preview studio uses the exact same overlay images as production Kometa.

.NOTES
    Requires: Windows PowerShell 5.1+, Internet connection
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

# Determine repo root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$AssetsDir = Join-Path $RepoRoot "overlay-assets"

Write-Info "Kometa Overlay Assets Downloader"
Write-Info "=================================="
Write-Info "This will download default overlay images from:"
Write-Info "https://github.com/Kometa-Team/Default-Images"
Write-Info ""
Write-Info "Target directory: $AssetsDir"
Write-Info ""

# Create assets directory
if (-not (Test-Path $AssetsDir)) {
    New-Item -ItemType Directory -Path $AssetsDir -Force | Out-Null
}

# Base URL for Default-Images repository
$BaseUrl = "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master"

# Function to download assets for an overlay type
function Download-OverlayType {
    param(
        [string]$OverlayType,
        [string]$SubDir
    )

    $TargetDir = Join-Path $AssetsDir $OverlayType

    Write-Info "Downloading $OverlayType overlays..."

    # Create target directory
    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }

    $Files = @()
    switch ($OverlayType) {
        "resolution" {
            $Files = @("4K.png", "1080p.png", "720p.png", "480p.png", "fullhd.png", "ultrahd.png")
        }
        "audio_codec" {
            $Files = @("dolby atmos.png", "dts-hd ma.png", "truehd.png", "aac.png")
        }
        "ribbon" {
            $Files = @("imdb top 250.png", "rotten tomatoes certified fresh.png")
        }
        "streaming" {
            $Files = @("netflix.png", "max.png", "disney+.png", "amazon prime video.png", "apple tv+.png", "amc+.png")
        }
        "network" {
            $Files = @("amc.png", "hbo.png", "fx.png", "netflix.png")
        }
        "studio" {
            $Files = @("a24.png", "marvel studios.png", "netflix.png", "sony pictures television.png", "warner bros. pictures.png", "legendary pictures.png")
        }
        "ratings" {
            $Files = @("imdb.png", "tmdb.png", "rotten tomatoes critics.png")
        }
    }

    foreach ($File in $Files) {
        $EncodedFile = [System.Uri]::EscapeDataString($File)
        $Url = "$BaseUrl/$OverlayType/$SubDir/$EncodedFile"
        $TargetFile = Join-Path $TargetDir $File

        if (Test-Path $TargetFile) {
            Write-Info "  + $File (already exists)"
            continue
        }

        Write-Info "  Downloading $File..."
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri $Url -OutFile $TargetFile -UseBasicParsing -ErrorAction Stop
            Write-Success "  + $File"
        } catch {
            Write-Warn "  x $File (404 or network error)"
            if (Test-Path $TargetFile) {
                Remove-Item $TargetFile -Force -ErrorAction SilentlyContinue
            }
        }
    }

    Write-Host ""
}

# Download each overlay type
Download-OverlayType -OverlayType "resolution" -SubDir "overlays/standard"
Download-OverlayType -OverlayType "audio_codec" -SubDir "overlays/standard"
Download-OverlayType -OverlayType "ribbon" -SubDir "overlays/standard"
Download-OverlayType -OverlayType "streaming" -SubDir "overlays/standard"
Download-OverlayType -OverlayType "network" -SubDir "logos/standard"
Download-OverlayType -OverlayType "studio" -SubDir "logos/standard"
Download-OverlayType -OverlayType "ratings" -SubDir "overlays/standard"

Write-Info "Download complete!"
Write-Info ""
Write-Info "Next steps:"
Write-Info "1. Update docker-compose.yml to mount overlay-assets/"
Write-Info "2. Update preview config to reference local assets"
Write-Info "3. Restart the services"
