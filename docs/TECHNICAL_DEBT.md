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
- [ ] Update frontend to use pagination (currently fetches all)

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

### 13. Magic Numbers Remain
**Priority:** LOW
**Locations:** Various

Some hardcoded values should be in constants:
- Badge dimensions in `instant_compositor.py` (305, 105)
- Poll intervals in frontend (2000ms)

**Action Items:**
- [ ] Audit for remaining magic numbers
- [ ] Extract to constants files
- [ ] Document units in names

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
Consider for future:
- Job queue (Bull/BullMQ) for background processing
- Concurrent job limits
- ✅ Retry logic with exponential backoff - ADDED 2026-01-16
  - Created `util/retry.ts` with `withRetry()` and `isRetryableHttpError()`
  - TMDb client now retries on network errors and rate limiting

---

## Testing Strategy

### Unit Tests (Implemented)
- ✅ Pure functions: `yaml.ts`, `hash.ts`
- ✅ Business logic: `resolveTargets.ts`, `configGenerator.ts`
- ✅ Plex client (`plexClient.test.ts` with mocked HTTP) - ADDED 2026-01-16

### Integration Tests (Priority 2)
- [ ] API endpoint contracts
- [ ] Job lifecycle
- [ ] SSE event streaming

### E2E Tests (Priority 3)
- [ ] Full preview workflow
- [ ] Error scenarios
- [ ] Browser compatibility

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

### Still Needed
| Package | Purpose | Priority |
|---------|---------|----------|
| `helmet` | Security headers | Low |
| `express-rate-limit` | Rate limiting | Low |

---

## Quick Wins Remaining

1. [ ] Add request logging middleware
2. [ ] Verify error boundary coverage
3. [x] Add profile expiry to API response (RESOLVED 2026-01-16)
4. [ ] Document Community/Sharing API status
5. [x] Add environment variable validation on startup (RESOLVED 2026-01-16)

---

## Definition of Done for Technical Debt

- [x] Issue is documented in this file
- [x] Fix is implemented and tested
- [x] Existing tests pass
- [x] New tests added for the fix
- [ ] Code reviewed by another developer
- [x] Documentation updated if needed
