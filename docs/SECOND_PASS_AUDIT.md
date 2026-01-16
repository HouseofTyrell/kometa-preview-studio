# Second-Pass Audit Report: Kometa Preview Studio

**Date:** 2026-01-16
**Auditor:** Claude (Opus 4.5)
**Purpose:** Catch issues missed in initial audit by using a different lens

---

## 1. What the Repo Is (Based on Code)

**Kometa Preview Studio** is a local-first web application for previewing Kometa overlays on Plex media without modifying actual Plex metadata.

### How It Actually Runs

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND (React/Vite on port 5173)                                 │
│  - Preview.tsx: Main preview UI with target selection               │
│  - OverlayBuilder.tsx: Visual overlay configuration                 │
│  - Config.tsx: YAML upload and Plex credential input                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ REST + SSE
┌──────────────────────────────▼──────────────────────────────────────┐
│  BACKEND (Node.js/Express on port 3001)                             │
│  Entry: backend/src/index.ts                                        │
│  - JobManager: Orchestrates preview jobs                            │
│  - KometaRunner: Spawns Docker containers via dockerode             │
│  - PlexClient: Resolves targets and fetches artwork                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Docker API
┌──────────────────────────────▼──────────────────────────────────────┐
│  RENDERER (Python, kometa-preview-renderer image)                   │
│  Entry: renderer/preview_entrypoint.py                              │
│  - PlexProxy: Intercepts Plex traffic, blocks writes, captures images│
│  - TMDbProxy: Rate-limits external API calls in fast mode           │
│  - Uses real Kometa rendering code from kometateam/kometa:v2.2.2    │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Execution Flow:**
1. User uploads `config.yml` → parsed by `configUpload.ts` → saved to `ProfileStore`
2. User clicks "Run Preview" → `previewStart.ts` creates job → `JobManager.createJob()`
3. JobManager: Resolves Plex targets → Fetches artwork → Generates preview config
4. KometaRunner: Spawns Docker container with `preview_entrypoint.py`
5. Renderer: Starts PlexProxy (port 32500) → Runs Kometa subprocess → Captures output images
6. Images written to `/jobs/<jobId>/output/` → Served via `previewArtifacts.ts`

### Orphan/Disconnected Areas

| Path | Status | Notes |
|------|--------|-------|
| `backend/src/debug/testPlexSearch.ts` | 🧪 Dev-only | Debugging utility, not wired into build |
| `docs/SELECTIVE_TESTING_ROADMAP.md` | 🟨 Orphan | Describes future features not yet implemented |
| `renderer/PREVIEW_MODE.md` | ✅ Documentation | Technical reference for proxy architecture |
| `fonts/` | Runtime directory | Requires user-populated fonts |
| `getOverlayAssetsHostPath()` in `paths.ts:98` | Deprecated | Returns `undefined`, assets bundled in image |

---

## 2. What Will Break First (New Machine Simulation)

### Required Runtimes & Versions

| Runtime | Version | Where Specified | Validated At Startup? |
|---------|---------|-----------------|----------------------|
| Node.js | 18+ | README only | ❌ No |
| Docker | Latest | README | ✅ Yes (start.sh) |
| Docker Compose | v1 or v2 | Implicit | ✅ Yes (start.sh) |
| Python | 3.x (Kometa bundled) | Dockerfile | ✅ Bundled |

### Failure-First Install Narrative

**New user on fresh Ubuntu/Mac:**

1. **"I would get stuck here..."** Clone repo, run `./scripts/start.sh` — this actually works well. The script:
   - ✅ Checks for Docker
   - ✅ Creates `fonts/`, `jobs/`, `cache/` directories
   - ✅ Auto-downloads Inter font
   - ✅ Creates `.env` with defaults

2. **First likely failure: Kometa base image pull timeout**
   - The start script runs `docker-compose build --no-cache --pull kometa-renderer-build`
   - The `kometateam/kometa:v2.2.2` image is ~1.5GB
   - **No pull progress shown** during script execution (output suppressed)
   - Users on slow connections may think the script is frozen

3. **Second likely failure: Font file corruption**
   - Script downloads from `https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip`
   - Uses `curl -L` which follows redirects but doesn't validate checksum
   - If GitHub returns a 404 or partial file, `unzip` silently fails
   - The error message "Could not find Inter-Regular.ttf" doesn't explain why

4. **Third likely failure: Local development mode (Option 2)**
   - README says "Install backend dependencies: `cd backend && npm install`"
   - **Missing**: `tsx` is a devDependency but `npm run dev` requires it
   - **Missing**: No mention that Python renderer won't work in local dev mode (Docker required)
   - Running `npm run dev` works, but trying to run a preview will fail with Docker socket errors

5. **Fourth likely failure: Windows path issues**
   - `docker-compose.yml:20` uses `${PWD}/jobs` for host path
   - On Windows PowerShell, `${PWD}` resolves to `C:\Users\...` with backslashes
   - Docker Desktop may not correctly translate these to Unix paths
   - **Mitigation exists**: start.ps1 handles this, but docker-compose direct users will fail

6. **Fifth likely failure: Plex token/URL extraction**
   - Users must have a valid Kometa config.yml with Plex token
   - If user copies from Plex web (not Kometa), token format may differ
   - No validation UI for "test Plex connection before running preview"

---

## 3. Docs ↔ Code Mismatch Table

| Claim | Location | Actual Behavior | Severity | Fix |
|-------|----------|-----------------|----------|-----|
| "Node.js 18+ (for local development)" | README:33 | No version check anywhere; works with Node 16+ | 🟡 Low | Add engines field to package.json |
| "Frontend: http://localhost:5173" | README:77 | Correct in dev; Docker uses nginx on :80 mapped to :5173 | 🟢 OK | N/A |
| "/api/config/:id GET saved profile" | README:298, index.ts:125 | Endpoint exists at `/api/config/:id` | 🟢 OK | N/A |
| "JOBS_PATH default: ./jobs" | README:315 | Code uses `path.resolve(__dirname, '../../../jobs')` in paths.ts:7 | 🟡 Medium | Docs should note relative to build output |
| "HOST default: 127.0.0.1" | README:313 | docker-compose.yml sets HOST=0.0.0.0 for container | 🟡 Low | Clarify container vs local defaults |
| KOMETA_IMAGE_TAG "v2.2.2" | README:317, docker-compose.yml:25 | ✅ Consistent | 🟢 OK | N/A |
| "Profile auto-expire after 24 hours" | constants.ts:66 | `PROFILE_EXPIRY_MS = 24 * 60 * 60 * 1000` implemented | ⚠️ Medium | Document in README; add UI warning |
| "/api/preview/events/:id SSE stream" | README:301 | Implemented in previewStatus.ts | 🟢 OK | N/A |
| "Start/Stop/Reset in Config page" | README:118 | Implemented in systemControl.ts, triggers scripts | 🟢 OK | N/A |
| "5 preview items" | README:10, 18-27 | Code uses constants.ts PREVIEW_TARGET_IDS (5 items) | 🟢 OK | N/A |
| Sample env `KOMETA_CONFIG_PATH=` | .env.example | docker-compose.yml uses `${KOMETA_CONFIG_PATH:-}` but volume mount is commented out | ⚠️ Medium | Either uncomment or clarify setup |
| "Read-only mounts" | README:404 | `./fonts:/app/fonts:ro` correct; `./jobs:/app/jobs` is rw | 🟢 OK | Jobs must be rw |
| `/api/builder/*` endpoints | Not in README | Fully implemented in builderApi.ts | 🟡 Low | Document builder API |
| `/api/community/*` endpoints | Not in README | Fully implemented in communityApi.ts | 🟡 Low | Document community API |
| `/api/share/*` endpoints | Not in README | Fully implemented in sharingApi.ts | 🟡 Low | Document sharing API |
| "Smoke test verifies 5 *_after.* files" | README:361 | smoke-test.sh greps for `_after` files in output | 🟢 OK | N/A |

---

## 4. Feature Inventory

### ✅ Implemented & Working

| Feature | Files | Notes |
|---------|-------|-------|
| YAML config upload & parsing | configUpload.ts, yaml.ts | Zod validation added |
| Plex connection & target resolution | plexClient.ts, resolveTargets.ts | Timeout conversion fix applied |
| Job creation & management | jobManager.ts, jobRepository.ts | Extracted to proper classes |
| Docker container execution | runner.ts, dockerode | Pre-pull on startup |
| PlexProxy write-blocking | proxy_plex.py | Mock library mode + upload capture |
| TMDbProxy rate limiting | proxy_tmdb.py | Fast mode with configurable limits |
| SSE event streaming | previewStatus.ts | Real-time logs to frontend |
| Before/After image comparison | PreviewTile.tsx, ComparisonView.tsx | Working |
| Pause/Resume/Cancel jobs | jobManager.ts | Full lifecycle support |
| Force-stop stuck jobs | previewStatus.ts:DELETE /force/:id | Emergency kill |
| Profile persistence | profileStore.ts | Disk-backed with 24h expiry |
| Draft instant preview | instant_compositor.py | Fast preview while Kometa runs |
| Output caching | caching.py | Skip re-render if config unchanged |
| Granular per-overlay caching | overlay_fingerprints.py | Partial cache hits |
| Cross-platform scripts | scripts/*.{sh,ps1,bat} | Linux/Mac/Windows |
| Theme toggle (dark/light) | ThemeContext.tsx | Persistent |

### 🟨 Partially Implemented or Fragile

| Feature | Files | Issue |
|---------|-------|-------|
| Overlay Builder (Simple mode) | OverlayBuilder.tsx | Works but limited overlay types |
| Overlay Builder (Advanced mode) | AdvancedConfigurator.tsx | UI exists but export may not match all Kometa options |
| Community overlay browser | CommunityBrowser.tsx, communityApi.ts | Depends on GitHub API; rate limits possible |
| Share to Gist | sharingApi.ts | Requires user-provided GitHub token |
| Custom fonts | fonts.py | Font fallback exists but HDR/DV badges incomplete (TODO in code) |
| Test suite | __tests__/*.ts | 6 test files; ~40% coverage; no E2E |
| Plex timeout handling | plexClient.ts | Timeout works but no retry logic |
| Config validation warnings | configSchema.ts | Zod schemas exist but not all edge cases covered |

### 🟥 Not Implemented But Implied/Documented

| Feature | Where Implied | Status |
|---------|---------------|--------|
| Job pagination | docs/TECHNICAL_DEBT.md:161 | Listed as "Medium priority" |
| Environment variable validation at startup | docs/TECHNICAL_DEBT.md:309 | Not implemented |
| Concurrent job limits | docs/TECHNICAL_DEBT.md:259 | Single job at a time currently |
| Retry logic with backoff | docs/TECHNICAL_DEBT.md:260 | Not implemented |
| Profile expiry warning UI | docs/TECHNICAL_DEBT.md:176-178 | Not implemented |
| Request logging middleware | docs/TECHNICAL_DEBT.md:305 | Listed but not done |
| Rate limiting on API | docs/TECHNICAL_DEBT.md:223-224 | Not implemented |
| Security headers (helmet) | docs/TECHNICAL_DEBT.md:217-225 | Not implemented |
| HDR/DV badge compositing | renderer/instant_compositor.py:347 | TODO in code |

### 🧪 Experimental / Dev-Only

| Feature | Files | Notes |
|---------|-------|-------|
| Fast path (skip Kometa) | constants.py:36 | PREVIEW_FAST_PATH=0 by default; visual differences |
| Parallel Kometa execution | constants.py:29 | PREVIEW_PARALLEL_KOMETA=1 default |
| Debug mock XML | constants.py:83 | PREVIEW_DEBUG_MOCK_XML=0 |
| testPlexSearch.ts | backend/src/debug/ | Standalone debug utility |

---

## 5. Stealth Debt: Top 10

### 1. **134 Console.log Calls Remain in Backend**
**Location**: 11 files in `backend/src/` (counted via grep)
**Impact**: Inconsistent logging, no structured log aggregation
**Severity**: HIGH for production debugging

### 2. **PlexProxy Uses Class-Level Mutable State**
**Location**: `proxy_plex.py:69-106`
**Issue**: `PlexProxyHandler` stores state in class attributes (`blocked_requests`, `captured_uploads`, etc.). If multiple requests arrive simultaneously, race conditions are possible despite `data_lock`.
**Impact**: Potential data corruption under concurrent load

### 3. **No Retry Logic for Plex/TMDb API Calls**
**Location**: `plexClient.ts`, `tmdbClient.ts`
**Issue**: Single attempt with timeout; transient network errors cause immediate failure
**Impact**: Flaky preview jobs on unstable networks

### 4. **Hardcoded Metadata in jobManager.ts**
**Location**: `jobManager.ts:608-642`
**Issue**: `getItemMetadata()` has hardcoded values for specific movie IDs (`if (target.id === 'dune')`)
**Impact**: Only works for the 5 static preview targets; breaks if targets change

### 5. **Profile Expiry Without User Warning**
**Location**: `constants.ts:66` (24h expiry), no UI notification
**Issue**: User profiles silently expire; uploaded config disappears
**Impact**: User confusion, data loss

### 6. **Environment Variable Fallback Chain Complexity**
**Location**: `paths.ts`, `constants.py`
**Issue**: `JOBS_HOST_PATH || JOBS_PATH || path.resolve(...)` creates 3-level fallback that's hard to debug
**Impact**: Path configuration errors are silent and hard to trace

### 7. **Docker Stream Output Parsing Assumes 8-Byte Header**
**Location**: `runner.ts:161-171`
**Issue**: `chunk.slice(8)` assumes Docker multiplexed stream format; no validation
**Impact**: Corrupted logs if Docker API changes or errors occur

### 8. **XML Parsing Without Entity Limit**
**Location**: `proxy_plex.py` uses `xml.etree.ElementTree`
**Issue**: No defusedxml; vulnerable to XML bomb attacks from malicious Plex responses
**Impact**: Low (local-only app, but defense-in-depth missing)

### 9. **Unclosed EventSource Connections**
**Location**: `frontend/src/api/client.ts:305-313`
**Issue**: `subscribeToJobEvents` returns cleanup function but if component unmounts during connection, EventSource may leak
**Impact**: Memory leaks over extended use

### 10. **No Input Sanitization on Job IDs**
**Location**: `previewArtifacts.ts`, `paths.ts`
**Issue**: Job IDs come from UUIDs but path construction doesn't validate
**Code**: `getImagePath(jobId, folder, filename)` constructs paths directly
**Impact**: Low (UUIDs are safe), but no defense if ID source changes

---

## 6. Highest ROI Fixes (Next 1-2 Days)

### 1. Migrate Remaining console.log to Pino (2-4 hours)
**Files**: 11 files with 134 calls
**Action**: Systematically replace with appropriate logger calls
**ROI**: Enables production debugging, log aggregation

### 2. Add Profile Expiry Warning (1-2 hours)
**Files**: `backend/src/api/configUpload.ts`, `frontend/src/pages/Config.tsx`
**Action**: Return `expiresAt` in API response; show countdown/warning in UI
**ROI**: Prevents user confusion and data loss

### 3. Add Environment Variable Validation at Startup (1 hour)
**Files**: `backend/src/index.ts`
**Action**: Check required env vars; fail fast with clear error messages
**ROI**: Faster debugging of configuration issues

### 4. Fix Font Download Robustness (1 hour)
**Files**: `scripts/start.sh`, `scripts/start.ps1`
**Action**: Add checksum verification; better error messages on download failure
**ROI**: Reduces first-run failures

### 5. Document Builder/Community/Sharing APIs (2 hours)
**Files**: `README.md`
**Action**: Add API documentation for undocumented endpoints
**ROI**: Enables integrations, reduces support burden

---

## 7. Strategic Refactors (Next 1-2 Weeks)

### 1. Create Shared Types Package
**Current**: Types duplicated between `backend/src/types/` and `frontend/src/types/`
**Proposal**: `packages/shared/` with API contracts, job status enums, test options
**ROI**: Eliminates frontend/backend type drift

### 2. Implement Job Queue with BullMQ
**Current**: Single job at a time, no retry logic, in-memory state
**Proposal**: Replace JobManager with Redis-backed queue
**ROI**: Concurrent jobs, automatic retries, persistence across restarts

### 3. Extract Python Proxy to Standalone Service
**Current**: Proxy runs inside renderer container
**Proposal**: Long-running proxy service with gRPC/HTTP interface
**ROI**: Eliminates per-job proxy startup overhead, enables WebSocket streaming

### 4. Add E2E Test Suite
**Current**: 6 unit/integration tests, no E2E
**Proposal**: Playwright tests for full preview workflow
**ROI**: Regression protection, CI/CD confidence

### 5. Implement Retry Logic for External APIs
**Current**: Single attempt, fail on timeout
**Proposal**: Exponential backoff with configurable limits
**ROI**: Resilience on flaky networks

---

## 8. Open Questions / Unverifiable Assumptions

1. **Kometa API Stability**: The renderer depends on Kometa's internal modules (`/modules/overlays`). If Kometa v2.3+ changes internal APIs, the renderer breaks. No version pinning beyond image tag.

2. **Plex API Version**: The PlexClient assumes specific XML response formats. Changes in Plex API versions are not handled.

3. **TMDb API Rate Limits**: The TMDbProxy caps requests but doesn't handle 429 responses gracefully. Unknown if cached responses respect TMDb TOS.

4. **Docker Socket Security**: Backend requires `/var/run/docker.sock` access. This grants root-equivalent privileges inside the container.

5. **Profile ID Generation**: `uuid.v4()` for profile IDs. If users share profile IDs across machines, behavior is undefined.

6. **Cache Invalidation**: Output caching uses config hash, but doesn't invalidate when:
   - Kometa base image updates
   - Asset files change
   - Font files change

7. **Windows Line Endings**: Scripts use `#!/bin/bash` but if cloned with `git config core.autocrlf true`, start.sh will fail.

8. **Community Overlay Sources**: CommunityAPI fetches from GitHub. If Kometa-Config repo structure changes, browser breaks.

---

## Summary: Priority Matrix

| Priority | Items | Estimated Effort |
|----------|-------|-----------------|
| **P0** | Profile expiry warning, Env validation | 2-3 hours |
| **P1** | Console.log migration, Font download fix | 3-5 hours |
| **P2** | API documentation, E2E test scaffolding | 4-6 hours |
| **P3** | Shared types package, Retry logic | 1-2 days |
| **P4** | BullMQ queue, Standalone proxy | 1-2 weeks |

---

*This audit complements `docs/TECHNICAL_DEBT.md` with a focus on what would break for new users and contributors.*
