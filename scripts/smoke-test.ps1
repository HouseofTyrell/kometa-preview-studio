# Kometa Preview Studio - Smoke Test (PowerShell)
#
# This script verifies that a preview job completed successfully by checking:
# 1. summary.json exists and has expected structure
# 2. Kometa exited with code 0
# 3. Write attempts were captured (blocked_write_attempts or captured_uploads)
# 4. Output images were generated (*_after.*)
#
# Usage:
#   .\scripts\smoke-test.ps1 <job-id>
#   .\scripts\smoke-test.ps1          # Uses most recent job
#
# Exit codes:
#   0 - All checks passed
#   1 - Checks failed

param(
    [string]$JobId
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$JobsDir = Join-Path $ProjectRoot "jobs"

function Write-Pass { param($msg) Write-Host "✓ PASS" -ForegroundColor Green -NoNewline; Write-Host ": $msg" }
function Write-Fail { param($msg) Write-Host "✗ FAIL" -ForegroundColor Red -NoNewline; Write-Host ": $msg" }
function Write-Warn { param($msg) Write-Host "⚠ WARN" -ForegroundColor Yellow -NoNewline; Write-Host ": $msg" }
function Write-Info { param($msg) Write-Host "  INFO: $msg" }

# Find job directory
if ($JobId) {
    $JobDir = Join-Path $JobsDir $JobId
} else {
    if (-not (Test-Path $JobsDir)) {
        Write-Fail "Jobs directory not found: $JobsDir"
        exit 1
    }

    $LatestJob = Get-ChildItem -Path $JobsDir -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $LatestJob) {
        Write-Fail "No jobs found in $JobsDir"
        exit 1
    }
    $JobDir = $LatestJob.FullName
    $JobId = $LatestJob.Name
}

Write-Host "========================================"
Write-Host "Kometa Preview Studio - Smoke Test"
Write-Host "========================================"
Write-Host "Job ID: $JobId"
Write-Host "Job Dir: $JobDir"
Write-Host "----------------------------------------"

$SummaryFile = Join-Path $JobDir "output\summary.json"
$OutputDir = Join-Path $JobDir "output"
$Failed = $false

# Check 1: summary.json exists
Write-Host ""
Write-Host "Check 1: summary.json exists"
if (Test-Path $SummaryFile) {
    Write-Pass "summary.json found"
} else {
    Write-Fail "summary.json not found at $SummaryFile"
    $Failed = $true
}

# Check 2: Kometa exit code
Write-Host ""
Write-Host "Check 2: Kometa exit code"
if (Test-Path $SummaryFile) {
    try {
        $Summary = Get-Content $SummaryFile -Raw | ConvertFrom-Json
        $ExitCode = $Summary.kometa_exit_code

        if ($ExitCode -eq 0) {
            Write-Pass "Kometa exited with code 0"
        } elseif ($null -eq $ExitCode) {
            Write-Fail "Could not read kometa_exit_code from summary.json"
            $Failed = $true
        } else {
            Write-Fail "Kometa exited with code $ExitCode (expected 0)"
            $Failed = $true
        }
    } catch {
        Write-Fail "Error parsing summary.json: $_"
        $Failed = $true
    }
} else {
    Write-Warn "Skipped (no summary.json)"
}

# Check 3: Write blocking evidence
Write-Host ""
Write-Host "Check 3: Write blocking evidence (proxy captured uploads)"
if (Test-Path $SummaryFile) {
    try {
        $Summary = Get-Content $SummaryFile -Raw | ConvertFrom-Json
        $BlockedCount = if ($Summary.blocked_write_attempts) { $Summary.blocked_write_attempts.Count } else { 0 }
        $CapturedCount = if ($Summary.captured_uploads_count) { $Summary.captured_uploads_count } else { 0 }

        if ($BlockedCount -gt 0 -or $CapturedCount -gt 0) {
            Write-Pass "Write blocking active: $BlockedCount blocked requests, $CapturedCount captured uploads"
        } else {
            Write-Fail "No write attempts captured (blocked=$BlockedCount, captured=$CapturedCount)"
            Write-Info "This may indicate Kometa didn't process any overlays, or proxy didn't intercept writes"
            $Failed = $true
        }
    } catch {
        Write-Warn "Error reading capture data: $_"
    }
} else {
    Write-Warn "Skipped (no summary.json)"
}

# Check 4: Output images generated
Write-Host ""
Write-Host "Check 4: Output images generated (*_after.*)"
if (Test-Path $OutputDir) {
    $OutputFiles = Get-ChildItem -Path $OutputDir -Filter "*_after.*" -File
    $OutputCount = $OutputFiles.Count

    if ($OutputCount -ge 5) {
        Write-Pass "Found $OutputCount output images (expected 5)"
        $OutputFiles | ForEach-Object { Write-Info "  $($_.Name)" }
    } elseif ($OutputCount -gt 0) {
        Write-Warn "Found $OutputCount output images (expected 5) - partial success"
        $OutputFiles | ForEach-Object { Write-Info "  $($_.Name)" }
    } else {
        Write-Fail "No output images found in $OutputDir"
        $Failed = $true
    }
} else {
    Write-Fail "Output directory not found: $OutputDir"
    $Failed = $true
}

# Check 5: Missing targets
Write-Host ""
Write-Host "Check 5: Missing targets"
if (Test-Path $SummaryFile) {
    try {
        $Summary = Get-Content $SummaryFile -Raw | ConvertFrom-Json
        $MissingCount = if ($Summary.missing_targets) { $Summary.missing_targets.Count } else { 0 }

        if ($MissingCount -eq 0) {
            Write-Pass "No missing targets"
        } else {
            Write-Warn "$MissingCount targets missing"
            $Summary.missing_targets | ForEach-Object { Write-Info "  Missing: $_" }
        }
    } catch {
        Write-Warn "Error reading missing targets: $_"
    }
} else {
    Write-Warn "Skipped (no summary.json)"
}

# Summary
Write-Host ""
Write-Host "========================================"
if (-not $Failed) {
    Write-Host "SMOKE TEST PASSED" -ForegroundColor Green
    Write-Host "========================================"
    exit 0
} else {
    Write-Host "SMOKE TEST FAILED" -ForegroundColor Red
    Write-Host "========================================"
    Write-Host ""
    Write-Host "Troubleshooting tips:"
    Write-Host "  - Check container logs: docker compose logs backend"
    Write-Host "  - Check job logs: Get-Content `"$JobDir\logs\container.log`""
    Write-Host "  - Verify Plex is accessible from Docker"
    Write-Host "  - Ensure preview targets exist in your Plex library"
    exit 1
}
