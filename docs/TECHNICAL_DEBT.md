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

### Console.log Migration to Pino (Partial)
**Priority:** MEDIUM-HIGH
**Impact:** No structured logging, hard to debug production issues
**Status:** IN PROGRESS

**Completed:**
- [x] Install `pino` and `pino-pretty` for structured logging
- [x] Create logger utility (`backend/src/util/logger.ts`) with component loggers
- [x] Migrate `index.ts` to use structured logging
- [x] Migrate `jobManager.ts` to use structured logging
- [x] Migrate `runner.ts` to use structured logging
- [x] Add log levels (debug, info, warn, error)

**Remaining Action Items:**
- [ ] Migrate remaining ~170 console.log calls in other files
- [ ] Add request logging middleware
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

### 8. Error Boundaries in React
**Priority:** MEDIUM
**Impact:** Unclear error handling
**Location:** `frontend/src/components/ErrorBoundary.tsx`

`ErrorBoundary` component exists but needs verification that it wraps routes.

**Action Items:**
- [ ] Verify error boundary is wrapping routes in App.tsx
- [ ] Add fallback UI for uncaught errors
- [ ] Test error boundary behavior

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

### 11. No Pagination for Job List
**Priority:** MEDIUM
**Impact:** Performance issue with many jobs
**Location:** `backend/src/api/previewStatus.ts`

**Action Items:**
- [ ] Add `page` and `limit` query parameters
- [ ] Implement offset-based pagination
- [ ] Add `total` count to response
- [ ] Update frontend to paginate

---

### Profile Expiry Not Communicated
**Priority:** MEDIUM
**Impact:** Users may lose data unexpectedly
**Location:** `backend/src/constants.ts`

Profiles auto-expire after 24 hours with no warning to users.

**Action Items:**
- [ ] Add expiry timestamp to profile API response
- [ ] Show warning in UI when profile expires soon
- [ ] Consider configurable expiry time

---

### Instant Compositor HDR/DV Incomplete
**Priority:** MEDIUM
**Impact:** Draft previews don't match final for HDR/DV content
**Location:** `renderer/instant_compositor.py:347-351`

HDR/DV badges don't composite correctly in fast preview mode.

**Action Items:**
- [ ] Implement HDR/DV badge compositing
- [ ] Or document as known limitation

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

### 14. Missing Security Headers
**Priority:** LOW (local-only app)
**Location:** `backend/src/index.ts`

**Action Items:**
- [ ] Add `helmet` middleware for security headers
- [ ] Document HTTPS requirement for production
- [ ] Add rate limiting for API endpoints

---

### Community/Sharing APIs Documentation
**Priority:** LOW
**Impact:** Unclear feature completeness

Community and Sharing APIs exist but documentation is sparse.

**Action Items:**
- [ ] Document Community API usage and limitations
- [ ] Document Sharing API usage
- [ ] Add rate limiting for GitHub API calls
- [ ] Or mark features as experimental in docs

---

## Architecture Improvements

### Shared Types Package
Consider creating `packages/shared` with:
- API request/response types
- Job status enums
- Preview target definitions
- Test options types

### Repository Pattern
Status:
- ✅ Profile storage (`ProfileStore`)
- ✅ Job metadata (`JobRepository`)
- ✅ Artifact management (`ArtifactManager`)

### Event-Driven Architecture
Consider for future:
- Job queue (Bull/BullMQ) for background processing
- Concurrent job limits
- Retry logic with exponential backoff

---

## Testing Strategy

### Unit Tests (Implemented)
- ✅ Pure functions: `yaml.ts`, `hash.ts`
- ✅ Business logic: `resolveTargets.ts`, `configGenerator.ts`
- [ ] Plex client (with mocked HTTP)

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
3. [ ] Add profile expiry to API response
4. [ ] Document Community/Sharing API status
5. [ ] Add environment variable validation on startup

---

## Definition of Done for Technical Debt

- [x] Issue is documented in this file
- [x] Fix is implemented and tested
- [x] Existing tests pass
- [x] New tests added for the fix
- [ ] Code reviewed by another developer
- [x] Documentation updated if needed
