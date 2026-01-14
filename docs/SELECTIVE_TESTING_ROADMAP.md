# Selective Testing Options Roadmap

## Overview

This document outlines the implementation plan for adding selective testing capabilities to Kometa Preview Studio. Users will be able to customize their preview tests by selecting specific libraries, media types, overlays, and individual preview targets.

---

## Phase 1: Core Test Options Infrastructure

### 1.1 Data Models (TypeScript Types)

Create shared types for test options that flow from frontend → backend → renderer.

```typescript
// Types to implement in backend/src/types/testOptions.ts

interface TestOptions {
  // Target selection
  selectedTargets: string[];           // IDs of targets to include (empty = all)

  // Media type filtering
  mediaTypes: {
    movies: boolean;
    shows: boolean;
    seasons: boolean;
    episodes: boolean;
  };

  // Library selection (from parsed config)
  selectedLibraries: string[];         // Library names (empty = all)

  // Overlay selection
  selectedOverlays: string[];          // Overlay file paths/identifiers (empty = all)

  // Future: custom targets
  customTargets?: CustomTarget[];
}

interface CustomTarget {
  type: 'movie' | 'show' | 'season' | 'episode';
  searchTitle: string;
  searchYear?: number;
  seasonIndex?: number;
  episodeIndex?: number;
}
```

### 1.2 API Updates

**Endpoint: `POST /api/preview/start`**

```typescript
// Updated request body
{
  profileId?: string;
  configYaml?: string;
  testOptions?: TestOptions;  // NEW
}
```

---

## Phase 2: Target Selection

### 2.1 Backend Changes

**File: `resolveTargets.ts`**
- Add `filterTargets(targets: PreviewTarget[], options: TestOptions)` function
- Filter by `selectedTargets` array
- Filter by `mediaTypes` object

**File: `jobManager.ts`**
- Accept `testOptions` in `createJob()`
- Pass filtered targets through pipeline

### 2.2 Frontend Changes

**New Component: `TestOptionsPanel.tsx`**
- Collapsible panel above "Run Preview" button
- Checkbox list for each of the 5 static targets
- Media type toggles (Movies, TV Shows, Seasons, Episodes)
- "Select All" / "Deselect All" buttons

**Update: `Preview.tsx`**
- State for `testOptions`
- Pass to `startPreview()` API call
- Only render tiles for selected targets

---

## Phase 3: Library Selection

### 3.1 Backend Changes

**File: `configGenerator.ts`**
- Filter `libraries` section based on `selectedLibraries`
- Only include overlay_files from selected libraries

**File: `yaml.ts`**
- Enhance `analyzeConfig()` to return library-overlay mapping:
  ```typescript
  libraryOverlays: {
    [libraryName: string]: string[];  // overlay files per library
  }
  ```

### 3.2 Frontend Changes

**Update: `TestOptionsPanel.tsx`**
- Display libraries parsed from config
- Checkbox for each library
- Show associated overlays per library

---

## Phase 4: Overlay Selection

### 4.1 Backend Changes

**File: `configGenerator.ts`**
- Filter `overlay_files` array based on `selectedOverlays`
- Reconstruct library config with only selected overlays

### 4.2 Frontend Changes

**New Component: `OverlaySelector.tsx`**
- List all overlay files from config analysis
- Grouped by library
- Individual enable/disable toggles
- Preview which overlays will apply

---

## Phase 5: Enhanced Features (Future)

### 5.1 Custom Target Search

Allow users to test their own media items instead of just the 5 static targets.

**New Endpoint: `POST /api/plex/search`**
```typescript
{
  query: string;
  type: 'movie' | 'show';
  year?: number;
}
// Returns: PlexMediaItem[]
```

**Frontend:**
- Search input field
- Results dropdown
- Add to test queue functionality

### 5.2 Overlay Quick Test

Single-overlay testing mode for rapid iteration.

**Features:**
- Select one overlay file
- Apply to all selected targets
- Faster preview cycle

### 5.3 Preset Configurations

Save and load test configurations.

**Features:**
- "Save current options" button
- Named presets (e.g., "Movies only", "Resolution overlays")
- Quick-select buttons

### 5.4 Before/After Comparison Modes

Enhanced visualization options.

**Features:**
- Side-by-side view
- Slider comparison
- Diff highlighting

---

## Implementation Order

### Sprint 1: Foundation
1. ✅ Create roadmap document
2. [ ] Define `TestOptions` types
3. [ ] Update backend API to accept test options
4. [ ] Create `TestOptionsPanel` component skeleton

### Sprint 2: Target Selection
5. [ ] Implement target filtering in `resolveTargets.ts`
6. [ ] Add target checkboxes to UI
7. [ ] Wire up frontend → backend flow
8. [ ] Update preview grid to show only selected

### Sprint 3: Library & Overlay Selection
9. [ ] Enhance config analysis for library-overlay mapping
10. [ ] Add library selection UI
11. [ ] Implement overlay filtering in config generator
12. [ ] Add overlay selection UI

### Sprint 4: Polish & UX
13. [ ] Add "Select All" / "Deselect All" buttons
14. [ ] Add selection persistence (localStorage)
15. [ ] Add tooltips and help text
16. [ ] Test edge cases (no selection, invalid selection)

---

## File Changes Summary

| File | Changes |
|------|---------|
| `backend/src/types/testOptions.ts` | NEW - TypeScript types |
| `backend/src/api/previewStart.ts` | Accept testOptions parameter |
| `backend/src/jobs/jobManager.ts` | Pass testOptions through pipeline |
| `backend/src/plex/resolveTargets.ts` | Add filtering functions |
| `backend/src/kometa/configGenerator.ts` | Filter libraries and overlays |
| `backend/src/util/yaml.ts` | Enhanced analysis output |
| `frontend/src/types/testOptions.ts` | NEW - Shared types |
| `frontend/src/components/TestOptionsPanel.tsx` | NEW - Main options UI |
| `frontend/src/components/TargetSelector.tsx` | NEW - Target checkboxes |
| `frontend/src/components/OverlaySelector.tsx` | NEW - Overlay toggles |
| `frontend/src/pages/Preview.tsx` | Integrate options panel |
| `frontend/src/api/client.ts` | Updated API types |

---

## Success Metrics

- Users can run previews with subset of targets (reduces test time)
- Users can isolate specific libraries for testing
- Users can test individual overlays without running all
- No breaking changes to existing "run all" workflow
- Options persist across sessions (localStorage)
