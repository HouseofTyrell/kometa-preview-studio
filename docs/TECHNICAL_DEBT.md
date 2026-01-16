# Technical Debt & Improvement Roadmap

This document tracks technical debt, code quality issues, and planned improvements for Kometa Preview Studio.

**Last Updated:** 2026-01-16

---

## Recently Resolved Issues

### ✅ 1. Zero Test Coverage → Test Framework Set Up
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Jest configured for backend with ESM support (`jest.config.js`)
- Vitest configured for frontend with React Testing Library
- Initial unit tests for `yaml.ts`, `hash.ts`, `resolveTargets.ts`, `configGenerator.ts`
- Run: `npm test` in backend/frontend directories

---

### ✅ 2. In-Memory Profile Storage → Persistent Storage
**Status:** RESOLVED (Previously)

`ProfileStore` now persists profiles to disk in `/jobs/profiles/` with in-memory caching.

---

### ✅ 3. Status Enum Mismatch → Fixed
**Status:** RESOLVED (Previously)

Frontend and backend now use consistent status values: `'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'`

---

### ✅ 4. Input Validation → Zod Schema Validation
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added `configSchema.ts` with Zod schemas for Kometa config validation
- Config uploads now validated for structure before processing
- Preview requirements validated with warnings returned to frontend
- Zod added to dependencies

---

### ✅ 7. JobManager Does Too Much → Extracted Classes
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Extracted `JobRepository` class for job persistence operations
- Extracted `ArtifactManager` class for image/log retrieval
- `JobManager` reduced to orchestration role (~400 lines from 791)
- Clear separation of concerns between components

---

### ✅ 9. Hardcoded Preview Targets → Backend API
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added `GET /api/preview/targets` endpoint
- Frontend can fetch targets via `fetchPreviewTargets()`
- Single source of truth in `backend/src/plex/resolveTargets.ts`
- Frontend falls back to static values if API unavailable

---

### ✅ 5. Docker Image Pull Blocks Requests → Pre-pull on Startup
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added `prePullImage()` method to `KometaRunner` class
- Added `checkDockerAvailable()` method for Docker availability check
- Server startup calls `prePullDockerImageInBackground()` after listen
- Progress messages logged during pull
- Graceful handling when Docker unavailable

---

## Remaining High Priority Issues

### Expand Test Coverage
**Priority:** HIGH
**Impact:** Limited regression protection

**Current State:**
- Test framework configured ✅
- Basic unit tests for pure functions ✅
- Missing: Integration tests, E2E tests, Plex client mocks

**Action Items:**
- [ ] Add integration tests for API endpoints
- [ ] Add tests for `plexClient.ts` with mocked HTTP
- [ ] Target 80% coverage for core modules
- [ ] Add E2E test for full preview workflow

---

### ✅ Console.log Migration to Pino
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Installed `pino` and `pino-pretty` for structured logging
- Created logger utility (`backend/src/util/logger.ts`) with domain-specific loggers:
  - `apiLogger`, `jobLogger`, `plexLogger`, `configLogger`, `runnerLogger`
  - `storageLogger`, `tmdbLogger`, `communityLogger`, `sharingLogger`, `builderLogger`
- Migrated all console.log/error/warn calls in backend source (48 calls across 10 files)
- Debug tools in `debug/` folder intentionally left with console output
- All logs now include structured context for better observability

**Remaining Low Priority:**
- [x] Add request logging middleware (RESOLVED 2026-01-16 - pino-http)
- [ ] Configure log aggregation for production

---

## Medium Priority Issues

### ✅ 6. Code Duplication in Plex Client → Refactored
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Extracted `searchByType()` for common section/type filtering logic
- Extracted `searchInSection()` for search/fallback logic
- Extracted `mapToMediaItem()` for response mapping
- `searchMovies()` and `searchShows()` are now thin wrappers
- Reduced code from ~130 duplicated lines to <30 lines each

---

### ✅ 8. Error Boundaries in React
**Status:** VERIFIED
**Verification Date:** 2026-01-16

- ErrorBoundary component wraps all Routes in App.tsx (lines 75-111)
- Fallback UI shows error message with "Try Again" button
- Errors logged via componentDidCatch
- Styling uses CSS variables for theme consistency

---

### ✅ 10. Complex State in Preview Page → useReducer
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Defined `PreviewState` interface with all 9 state variables
- Created `previewReducer` function with typed actions
- Replaced 9 `useState` calls with single `useReducer`
- Defined `PreviewAction` discriminated union for all state transitions
- State transitions are now explicit and predictable

---

### ✅ 11. No Pagination for Job List
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added `page` and `limit` query parameters to `/api/preview/jobs`
- Implemented offset-based pagination with total count
- Added optional `status` filter for job filtering
- Response includes `pagination` object with page, total, totalPages, hasNextPage, hasPrevPage
- Default: 20 items per page, max: 100

**Remaining:**
- [x] Update frontend to use pagination - RESOLVED 2026-01-16
  - Updated `listJobs()` API function to accept pagination params
  - Added `JobListParams` interface with page, limit, status options
  - Added `PaginatedJobsResponse` type for typed responses

---

### ✅ Profile Expiry Not Communicated
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added `calculateExpiresAt()` helper to return expiry timestamp in API responses
- Created `ProfileExpiryWarning.tsx` React component with live countdown
- Component shows info (>2hrs), warning (<2hrs), or expired states
- Countdown updates every minute

---

### ✅ Instant Compositor HDR/DV Incomplete
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- HDR/DV badges now properly composite with resolution PNG assets
- Creates "dovetail" effect by stacking resolution PNG with HDR/DV text badge
- Dolby Vision shows cyan "DV" badge, HDR shows gold "HDR" badge
- Falls back to combined text badge when PNG assets unavailable

---

## Low Priority Issues

### ✅ 13. Magic Numbers Extracted to Constants
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

Backend constants extracted to `backend/src/constants.ts`:
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` - API rate limiting
- `PAGINATION` object - page, limit defaults and bounds
- `RETRY_DEFAULTS` object - retry configuration
- `TMDB_RETRY` object - TMDb API retry settings
- `PROGRESS` object - job progress milestones (5, 10, 15, 30, 45, 50, 75, 90, 100)
- `QUEUE_CONFIG` object - BullMQ queue settings
- `CACHE_CONTROL` object - HTTP cache ages
- `CONTAINER_STOP_TIMEOUT_SECONDS` - Docker container timeout

Frontend constants created in `frontend/src/constants.ts`:
- `DEBOUNCE_MS` object - autosave, search debounce values
- `MESSAGE_TIMEOUT_MS` object - error, success, info message timeouts
- `POLLING_INTERVAL_MS` object - job status, expiry update intervals
- `ZOOM` object - min, max, step, default zoom values
- `UNDO_HISTORY` object - max undo stack size
- `TIME` object - profile expiry warnings, time conversions
- `PAGINATION` object - default page and limit

---

### ✅ 14. Missing Security Headers
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added `helmet` middleware with CSP configured for Plex artwork
- Added `express-rate-limit` middleware (200 req/min, health checks exempt)
- Relaxed CSP to allow cross-origin images and API calls to Plex servers

---

### ✅ Community/Sharing APIs Documentation
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

- Added full API documentation to README.md
- Documented Builder, Community, and Sharing API endpoints with examples
- Added curl examples for common operations
- Noted GITHUB_TOKEN requirement for increased rate limits

---

## Architecture Improvements

### ✅ Shared Types Package
**Status:** RESOLVED
**Resolution Date:** 2026-01-16

Created `shared/types.ts` with:
- Job status types (JobStatus, JobStatusValue, JobTarget)
- Media types (MediaType, PreviewTarget)
- Config types (ConfigAnalysis)
- Artifact types (JobArtifacts, JobArtifactItem)
- Event types (JobEvent)
- System control types (SystemAction, SystemActionResult)
- Test options types (TestOptions)
- API response types (ApiError, PaginatedResponse)

Usage:
- Backend: `import { JobStatus } from '../shared/types.js'`
- Frontend: `import { JobStatus } from '../../shared/types'`

### Repository Pattern
Status:
- ✅ Profile storage (`ProfileStore`)
- ✅ Job metadata (`JobRepository`)
- ✅ Artifact management (`ArtifactManager`)

### Event-Driven Architecture
Status:
- ✅ Retry logic with exponential backoff - ADDED 2026-01-16
  - Created `util/retry.ts` with `withRetry()` and `isRetryableHttpError()`
  - TMDb client now retries on network errors and rate limiting

**✅ P4: Job Queue with BullMQ**
**Status:** IMPLEMENTED
**Resolution Date:** 2026-01-16

Benefits:
- Concurrent job execution with configurable limits
- Job persistence across server restarts
- Automatic retries with exponential backoff
- Job prioritization and scheduling
- Dead letter queue for failed jobs

Implementation:
- Created `queueConfig.ts` - Redis connection and queue configuration
- Created `queueService.ts` - BullMQ queue and worker management
- Updated `jobManager.ts` - Queue integration with fallback to direct mode
- Added Redis service to `docker-compose.yml` with health checks
- Queue mode auto-detected via REDIS_HOST environment variable

Usage:
- Development: Jobs process directly (no Redis required)
- Production: Set REDIS_HOST=redis to enable queue mode
- Queue stats available via `jobManager.getQueueStats()`

---

## Testing Strategy

### Unit Tests (Implemented)
- ✅ Pure functions: `yaml.ts`, `hash.ts`
- ✅ Business logic: `resolveTargets.ts`, `configGenerator.ts`
- ✅ Plex client (`plexClient.test.ts` with mocked HTTP) - ADDED 2026-01-16

### ✅ Integration Tests (Priority 2) - RESOLVED 2026-01-16
- [x] API endpoint contracts - `api.test.ts` (26 tests)
  - Health, targets, jobs pagination, status, artifacts
  - Config upload/retrieval, job control endpoints
- [x] Job lifecycle - `job-lifecycle.test.ts` (52 tests)
  - State machine transitions, progress updates
  - Event emissions, repository operations
  - Complete lifecycle scenarios (success, pause/resume, cancel, failure)
- [x] SSE event streaming - `sse-events.test.ts` (21 tests)
  - Event formatting, connection lifecycle
  - Full job lifecycle events, concurrent connections
  - Helper functions (safeSSEWrite, parseSSEEvents)

### ✅ E2E Tests with Playwright (P4)
**Status:** IMPLEMENTED
**Resolution Date:** 2026-01-16

Test scenarios covered:
- [x] Smoke tests (app loads, navigation, API health)
- [x] Full preview workflow (upload config → select target → run job)
- [x] Error scenarios (invalid config, network failures, API errors)
- [x] Browser compatibility (Chrome, Firefox, Safari, Mobile Chrome)
- [ ] Visual regression testing (optional, not yet configured)

Implementation:
- Installed `@playwright/test` in frontend
- Created `playwright.config.ts` with multi-browser support
- Created page objects: `ConfigPage`, `PreviewPage`, `ResultsPage`
- Created test files: `smoke.spec.ts`, `preview-workflow.spec.ts`, `error-scenarios.spec.ts`

Usage:
```bash
cd frontend
npm run test:e2e           # Run all E2E tests
npm run test:e2e:ui        # Run with visual UI
npm run test:e2e:headed    # Run with visible browser
npx playwright install     # First-time: install browsers
```

---

## Dependencies Status

### Added
| Package | Purpose | Status |
|---------|---------|--------|
| `zod` | Runtime validation | ✅ Installed |
| `jest` | Backend testing | ✅ Installed |
| `vitest` | Frontend testing | ✅ Installed |
| `pino` | Structured logging | ✅ Installed |
| `pino-pretty` | Dev log formatting | ✅ Installed |
| `pino-http` | Request logging | ✅ Installed |
| `helmet` | Security headers | ✅ Installed |
| `express-rate-limit` | Rate limiting | ✅ Installed |
| `bullmq` | Job queue | ✅ Installed |
| `ioredis` | Redis client | ✅ Installed |
| `@playwright/test` | E2E testing | ✅ Installed |

### Still Needed
| Package | Purpose | Priority |
|---------|---------|----------|
| - | All major dependencies installed | - |

---

## Quick Wins Remaining

1. [x] Add request logging middleware (RESOLVED 2026-01-16 - pino-http)
2. [x] Verify error boundary coverage (VERIFIED 2026-01-16)
3. [x] Add profile expiry to API response (RESOLVED 2026-01-16)
4. [x] Document Community/Sharing API status (RESOLVED 2026-01-16 - in README.md)
5. [x] Add environment variable validation on startup (RESOLVED 2026-01-16)

**All quick wins completed!**

---

## Definition of Done for Technical Debt

- [x] Issue is documented in this file
- [x] Fix is implemented and tested
- [x] Existing tests pass
- [x] New tests added for the fix
- [ ] Code reviewed by another developer
- [x] Documentation updated if needed
