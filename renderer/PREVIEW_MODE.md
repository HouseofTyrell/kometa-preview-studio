# Kometa Preview Mode - Technical Documentation

## Overview

The preview renderer runs **real Kometa** with a **local HTTP proxy** that:
1. **Returns synthetic library data** for only the 5 preview items (mock mode)
2. **Does NOT forward listing requests** to real Plex (avoids giant responses)
3. **Blocks all write operations** to Plex (captures uploaded images)
4. **Forwards metadata requests** only for allowed ratingKeys and their parents

This ensures pixel-identical overlay output with zero risk of modifying Plex,
while processing **only the preview items** instead of your entire library.

## Why Mock Library Mode Matters

Without mock mode, the proxy would forward listing requests to real Plex and
filter the XML response afterward. For large libraries this means:

**Before (filter mode - legacy):**
- Kometa queries `/library/sections/1/all` → proxy forwards to Plex
- Plex returns 2000+ items as XML (large response)
- Proxy filters down to 5 items → still transfers huge response
- Network overhead scales with library size

**After (mock library mode - default):**
- Kometa queries `/library/sections/1/all` → proxy returns synthetic XML
- Synthetic XML contains only 5 preview items (tiny response)
- No request to real Plex for listing endpoints
- Constant performance regardless of library size

## Mock Library Mode vs Filter Mode

| Aspect | Mock Library Mode (default) | Filter Mode (legacy) |
|--------|----------------------------|---------------------|
| Listing endpoints | Return synthetic XML | Forward + filter response |
| Network to Plex | Only metadata requests | All listing + metadata |
| Performance | Constant (5 items) | Scales with library size |
| Env variable | `PREVIEW_MOCK_LIBRARY=1` | `PREVIEW_MOCK_LIBRARY=0` |
| Parent learning | Dynamic from metadata | Not applicable |

## Safety Architecture (Mock Library Mode + Write Blocking + Upload Capture)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Renderer Container                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              preview_entrypoint.py                            │   │
│  │                                                               │   │
│  │  1. Load preview.yml → extract preview targets (5 items)     │   │
│  │                                                               │   │
│  │  2. Start PlexProxy on 127.0.0.1:32500 (Mock Library Mode)   │   │
│  │     - MOCK listing endpoints → return synthetic XML          │   │
│  │     - NO forwarding of listing requests to real Plex         │   │
│  │     - FORWARD metadata only for allowed ratingKeys           │   │
│  │     - LEARN parent relationships from forwarded metadata     │   │
│  │     - BLOCK all writes → return 200, CAPTURE image bytes     │   │
│  │     - Save to: output/by_ratingkey/<ratingKey>_poster.jpg    │   │
│  │                                                               │   │
│  │  3. Generate kometa_run.yml                                  │   │
│  │     - plex.url = http://127.0.0.1:32500 (proxy)              │   │
│  │     - plex.token = real token                                │   │
│  │                                                               │   │
│  │  4. Run Kometa subprocess                                    │   │
│  │     - Kometa connects to proxy, sees only 5 items            │   │
│  │     - Processes only those items (fast!)                     │   │
│  │     - All writes blocked + captured at network layer         │   │
│  │                                                               │   │
│  │  5. Map captured uploads to targets by ratingKey             │   │
│  │     - Match captured uploads to targets                       │   │
│  │     - Copy to output/<target_id>_after.<ext>                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │       PlexProxy (127.0.0.1:32500) - MOCK LIBRARY MODE        │   │
│  │                                                               │   │
│  │   GET /library/sections                                      │   │
│  │     └─► Return synthetic XML with Movies/TV Shows sections   │   │
│  │         (NO request to real Plex)                            │   │
│  │                                                               │   │
│  │   GET /library/sections/1/all                                │   │
│  │     └─► Return synthetic XML with only 5 preview items       │   │
│  │         (NO request to real Plex)                            │   │
│  │                                                               │   │
│  │   GET /library/metadata/12345  (allowed ratingKey)           │   │
│  │     ├─► Forward to real Plex                                 │   │
│  │     ├─► Cache response (learn parent relationships)          │   │
│  │     └─► Return response to Kometa                            │   │
│  │                                                               │   │
│  │   GET /library/metadata/99999  (NOT allowed)                 │   │
│  │     └─► Return empty <MediaContainer size="0"/>              │   │
│  │         (NO request to real Plex)                            │   │
│  │                                                               │   │
│  │   PUT /library/metadata/12345/posters                        │   │
│  │     │                                                         │   │
│  │     ├─► Extract image bytes from multipart body              │   │
│  │     ├─► Save to by_ratingkey/12345_poster_<ts>.jpg           │   │
│  │     └─► Return 200 OK {} (Kometa thinks it succeeded)        │   │
│  │                                                               │   │
│  │   PATCH/DELETE ─► BLOCKED (return 200)                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │   Real Plex     │
                    │   (read-only)   │
                    └─────────────────┘
```

## Why Proxy Instead of Monkeypatching?

Previous implementation used Python monkeypatching (`requests.Session.request`),
which **does not work across process boundaries**. When Kometa runs as a subprocess,
it has its own Python interpreter with unpatched imports.

The proxy approach is **process-boundary safe**:
- Proxy runs in the main process
- Kometa subprocess connects to proxy URL
- All HTTP traffic is intercepted at the network layer
- Works regardless of how Kometa makes HTTP requests

## Filtering Proxy Mechanism

The filtering proxy ensures Kometa only sees and processes the 5 preview items.

### How ratingKey Allowlist is Loaded

1. `preview.yml` contains targets with their Plex ratingKeys:
   ```yaml
   preview:
     targets:
       - id: matrix
         ratingKey: "12345"
       - id: dune
         ratingKey: "12346"
   ```

2. At startup, `extract_allowed_rating_keys()` builds a set: `{"12345", "12346", ...}`

3. This set is passed to `PlexProxy` which configures the handler

### Filtered Endpoints

The proxy intercepts and filters these Plex API endpoints:

| Endpoint Pattern | Description |
|-----------------|-------------|
| `/library/sections/{id}/all` | All items in a library section |
| `/library/sections/{id}/search` | Search within a section |
| `/library/search` | Global library search |
| `/hubs/search` | Hub search |
| `/library/sections/{id}/recentlyAdded` | Recently added items |
| `/library/sections/{id}/genre` | Browse by genre |
| `/library/sections/{id}/year` | Browse by year |

### XML Filtering Process

When a listing endpoint is requested:

1. **Forward to Plex**: Get the full XML response
2. **Parse XML**: Using `xml.etree.ElementTree`
3. **Filter children**: Remove elements where `ratingKey` not in allowlist
4. **Update attributes**: Set `size` and `totalSize` to filtered count
5. **Return to Kometa**: Kometa sees only allowed items

```xml
<!-- Original from Plex (2000 items) -->
<MediaContainer size="2000" totalSize="2000">
    <Video ratingKey="100" title="Matrix"/>
    <Video ratingKey="200" title="Inception"/>
    <Video ratingKey="300" title="Dune"/>
    <!-- ... 1997 more ... -->
</MediaContainer>

<!-- After filtering (only allowed items) -->
<MediaContainer size="2" totalSize="2">
    <Video ratingKey="100" title="Matrix"/>
    <Video ratingKey="300" title="Dune"/>
</MediaContainer>
```

### Metadata Endpoint Blocking

For `/library/metadata/{ratingKey}` requests:
- **Allowed ratingKey**: Forward to Plex unchanged
- **Non-allowed ratingKey**: Return empty `<MediaContainer size="0"/>`

This prevents Kometa from accessing metadata for items not in the preview set.

### Logs to Confirm Filtering

Look for these log lines to verify filtering is working:

```
| INFO     | FILTERING ENABLED: Only 5 items allowed
| INFO     | Allowed ratingKeys: ['12345', '12346', '12347', '12348', '12349']
| INFO     | FILTER_LIST endpoint=/library/sections/1/all original_bytes=245678 filtered_bytes=3456 allowed=5
| INFO     | FILTER_XML items: before=2000 after=5 removed=1995 allowed=5
| INFO     | BLOCK_METADATA ratingKey=99999 not in allowlist
```

If you see "FILTERING DISABLED", check that your preview.yml targets have ratingKey values.

## Upload Capture Mechanism

When Kometa attempts to upload a rendered overlay to Plex:

1. **Request Interception**: The proxy receives a POST/PUT to `/library/metadata/<ratingKey>/posters`
2. **Path Parsing**: Extract `ratingKey` (Plex's unique item ID) from the URL
3. **Body Parsing**: Parse multipart/form-data or raw image bytes
4. **Image Detection**: Verify image magic bytes (JPEG: `\xff\xd8`, PNG: `\x89PNG`, WebP: `RIFF...WEBP`)
5. **Save to Disk**: Write to `output/by_ratingkey/<ratingKey>_<kind>_<timestamp>.<ext>`
6. **Return Success**: Send `200 OK {}` so Kometa continues processing

### Supported Upload Paths

```
/library/metadata/<ratingKey>/posters   → kind=poster
/library/metadata/<ratingKey>/poster    → kind=poster
/library/metadata/<ratingKey>/arts      → kind=art
/library/metadata/<ratingKey>/thumbs    → kind=thumb
```

### Body Parsing

The proxy handles two upload formats:

1. **Multipart/form-data** (most common):
   - Parse boundary from Content-Type header
   - Extract first image part using `email.parser.BytesParser`
   - Detect extension from part's Content-Type or filename

2. **Raw image data**:
   - Check magic bytes directly
   - Determine extension from magic bytes

## Deterministic Output Mapping

After Kometa finishes, outputs are mapped to targets by `ratingKey`:

```python
# preview.yml contains:
preview:
  targets:
    - id: matrix
      ratingKey: "12345"  # ← Required for mapping
      title: "The Matrix (1999)"
    - id: dune
      ratingKey: "12346"
      title: "Dune (2021)"

# Captured uploads contain:
[
  { rating_key: "12345", saved_path: "by_ratingkey/12345_poster_*.jpg" },
  { rating_key: "12346", saved_path: "by_ratingkey/12346_poster_*.jpg" },
]

# Export maps ratingKey → target:
12345 → matrix → output/matrix_after.jpg
12346 → dune   → output/dune_after.jpg
```

### Mapping Priority

When multiple uploads exist for the same ratingKey:
1. Prefer `kind=poster` over `art` or `thumb`
2. Use most recent timestamp

## Configuration

### Generated Kometa Config (`kometa_run.yml`)

```yaml
plex:
  url: "http://127.0.0.1:32500"  # Proxy URL, not real Plex!
  token: "actual-plex-token"
  timeout: 60
  clean_bundles: false
  empty_trash: false
  optimize: false

settings:
  cache: false
  run_order: ['overlays']
  # ... other settings

libraries:
  Movies:
    overlay_files:
      - pmm: resolution
```

### Preview Config (`preview.yml`)

```yaml
plex:
  url: "http://192.168.1.100:32400"  # Real Plex URL
  token: "xxx"

preview:
  mode: write_blocked
  targets:
    - id: matrix
      type: movie
      title: "The Matrix (1999)"
      ratingKey: "12345"           # Required!
      input: "/jobs/input/matrix.jpg"
      output: "/jobs/output/matrix_after.png"
```

## Output Files

```
/jobs/<jobId>/output/
├── by_ratingkey/                    # Raw captured uploads
│   ├── 12345_poster_20240115_103015_123456.jpg
│   ├── 12346_poster_20240115_103016_234567.jpg
│   └── ...
├── captured_requests/               # Debug: unparseable bodies
│   └── unknown_unknown_*.bin
├── matrix_after.jpg                 # Mapped outputs
├── dune_after.jpg
├── breakingbad_series_after.jpg
├── breakingbad_s01_after.jpg
├── breakingbad_s01e01_after.jpg
└── summary.json
```

## Summary Output

`summary.json` contains:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "success": true,
  "kometa_exit_code": 0,
  "blocked_write_attempts": [
    {
      "method": "PUT",
      "path": "/library/metadata/12345/posters",
      "timestamp": "2024-01-15T10:30:15Z",
      "rating_key": "12345",
      "kind": "poster",
      "content_length": 1234567
    }
  ],
  "captured_uploads": [...],
  "captured_uploads_count": 5,
  "successful_captures_count": 5,
  "exported_files": {
    "matrix": "/jobs/.../output/matrix_after.jpg",
    "dune": "/jobs/.../output/dune_after.jpg"
  },
  "missing_targets": [],
  "output_files": ["matrix_after.jpg", "dune_after.jpg", ...],
  "mock_mode": {
    "enabled": true,
    "mock_list_requests": [
      {
        "path": "/library/sections/1/all",
        "type": "listing",
        "returned_items": 5,
        "timestamp": "2024-01-15T10:30:02Z"
      }
    ],
    "mock_list_requests_count": 8,
    "forward_requests_count": 15,
    "blocked_metadata_count": 3,
    "learned_parent_keys": ["12340", "12341"]
  },
  "filtering": {
    "enabled": false,
    "allowed_rating_keys": ["12345", "12346", "12347", "12348", "12349"],
    "allowed_count": 5,
    "filtered_requests": [],
    "filtered_requests_count": 0
  }
}
```

## Safety Guarantees

1. **Network-layer blocking**: All Plex writes blocked at HTTP proxy level
2. **Process-boundary safe**: Works with subprocess execution
3. **Captured uploads**: Every blocked write's image data is saved
4. **Deterministic mapping**: Outputs mapped by Plex ratingKey, not filename guessing
5. **No fallback rendering**: If Kometa fails, job fails (no PIL fallback)
6. **Filtered processing**: Kometa only sees and processes preview items (not entire library)

## Verification

To verify no writes occurred:

1. Check `summary.json` → `blocked_write_attempts`
2. Look for `BLOCKED_WRITE:` and `CAPTURED_UPLOAD` lines in logs
3. Compare Plex artwork before/after preview

## Failure Modes

| Condition | Result |
|-----------|--------|
| Missing ratingKey in config | `MISSING_RATINGKEY` error, target marked missing |
| No captured upload for target | `MISSING_CAPTURE` error, target marked missing |
| Multipart parse failure | Raw body saved to `captured_requests/`, `parse_error` logged |
| Kometa crashes | Non-zero exit code, job fails |
| All targets missing | Job fails with exit code 1 |
| Some targets missing | Job completes with warning, exit code 1 |
| No ratingKeys in config | Filtering disabled, all items processed (slow) |
| XML parse error in filtering | Response passed through unchanged, warning logged |

## Logging

### Mock Library Mode Logs (Default)
```
| INFO     | MOCK_LIBRARY_MODE ENABLED: Only 5 items visible
| INFO     | Listing endpoints will NOT be forwarded to Plex
| INFO     | Metadata requests forwarded only for allowed ratingKeys
| INFO     | Allowed ratingKeys: ['12345', '12346', '12347', '12348', '12349']
| INFO     | MOCK_SECTIONS returned_sections=2
| INFO     | MOCK_LIST endpoint=/library/sections/1/all returned_items=5
| INFO     | ALLOW_FORWARD ratingKey=12345 endpoint=/library/metadata/12345
| INFO     | LEARNED_PARENT ratingKey=12346 parentRatingKey=12345
| INFO     | BLOCK_METADATA ratingKey=99999 not in allowlist
| INFO     | Mock list requests: 8
| INFO     | Forwarded requests: 15
| INFO     | Blocked metadata requests: 3
```

### Filtering Logs (Legacy - when PREVIEW_MOCK_LIBRARY=0)
```
| INFO     | FILTER_MODE ENABLED: Only 5 items allowed
| INFO     | Allowed ratingKeys: ['12345', '12346', '12347', '12348', '12349']
| INFO     | FILTER_LIST endpoint=/library/sections/1/all items_before=2000 items_after=5 allowed_keys=5
| INFO     | FILTER_XML items: before=2000 after=5 removed=1995 allowed=5
| INFO     | BLOCK_METADATA ratingKey=99999 not in allowlist
| INFO     | Filtered 15 listing requests
```

### Upload Capture Logs
```
| INFO     | CAPTURED_UPLOAD ratingKey=12345 kind=poster bytes=1234567 saved=/jobs/.../by_ratingkey/12345_poster_*.jpg
| WARNING  | BLOCKED_WRITE (no image): PUT /library/metadata/99999/posters ratingKey=99999
| ERROR    | MISSING_CAPTURE ratingKey=12345 target=matrix
| ERROR    | MISSING_RATINGKEY target=unknown_item
```

## Preview Accuracy Modes

The preview system supports two accuracy modes to balance speed vs. completeness:

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PREVIEW_ACCURACY` | `fast` | Mode: `fast` or `accurate` |
| `PREVIEW_EXTERNAL_ID_LIMIT` | `25` | Max IDs per external builder (fast mode) |
| `PREVIEW_EXTERNAL_PAGES_LIMIT` | `1` | Max pages per external API (fast mode) |
| `PREVIEW_TMDB_PROXY` | `1` | Enable TMDb proxy (fast mode only) |

### Fast Mode (Default)

Fast mode optimizes for speed by limiting external API expansions:

1. **TMDb API Capping**: A local proxy intercepts TMDb API calls and:
   - Caps `discover`, `trending`, `popular`, `top_rated` results to `PREVIEW_EXTERNAL_ID_LIMIT`
   - Forces `total_pages=1` to prevent pagination
   - Preserves JSON schema for Kometa compatibility

2. **Bounded Expansion**: External builders (TMDb, Trakt) are limited to avoid
   unbounded ID expansion that can slow preview generation.

3. **Deduplication**: Identical TMDb requests within a preview run are cached
   and deduplicated to avoid repeated expensive API calls.

**Logs:**
```
| INFO     | PREVIEW_MODE: fast
| INFO     | TMDB_PROXY started on port 8191
| INFO     | TMDB_CAP: discover/movie capped from 1500 to 25 results
| INFO     | TMDB_CACHE_HIT: discover/movie (fingerprint=abc123)
| INFO     | FAST_PREVIEW: skipped TMDb discover for non-overlay context
```

### Accurate Mode

Accurate mode provides full Kometa behavior without capping:

1. **Full Expansion**: All external API results are used without limits
2. **No TMDb Proxy**: Requests go directly to TMDb API
3. **Complete Results**: Useful for testing overlays that depend on full metadata

**When to use Accurate Mode:**
- Testing overlays that use ranking/position data
- Verifying behavior matches production Kometa
- Debugging issues not reproducible in fast mode

```bash
PREVIEW_ACCURACY=accurate python preview_entrypoint.py
```

### Fast Mode Guarantees (G3)

Fast mode guarantees bounded runtime:
- No unbounded external ID expansion
- Max `PREVIEW_EXTERNAL_ID_LIMIT` IDs per external builder
- No repeated expansion of the same builder request (deduplication)
- Total preview time independent of library size

#### G1: Request Deduplication

Within a single preview run, identical TMDb requests are cached and deduplicated:

- **Fingerprint computation**: Based on endpoint path and sorted query params
- **Cache storage**: In-memory for the duration of the preview run
- **Subsequent requests**: Return cached response without network call

```
| INFO     | TMDB_CACHE_HIT: /3/discover/movie (fingerprint=abc123def456)
```

#### G2: Non-Overlay Discover Suppression

In FAST mode, TMDb discover requests for non-overlay contexts are suppressed:

**Suppressed requests** (return empty results):
- Genre collections (`with_genres=28`)
- Keyword collections (`with_keywords=9715`)
- Certification collections (`certification=PG-13`)
- Company/network filters (`with_companies`, `with_networks`)
- People/cast/crew filters (`with_people`, `with_cast`, `with_crew`)
- High vote thresholds (`vote_count.gte >= 100`)

**Allowed requests** (capped but not suppressed):
- Simple discover for overlay evaluation
- Requests without collection-building indicators

```
| INFO     | FAST_PREVIEW: skipped TMDb discover for non-overlay context: /3/discover/movie
```

This ensures collections, charts, and defaults builders don't slow down preview mode.

#### H1: TVDb Conversion Suppression

In FAST mode, TMDb → TVDb ID conversion requests are skipped:

**Suppressed requests** (return empty external_ids):
- `/tv/{id}/external_ids` - TV show external IDs (used to get TVDb IDs)
- `/find/{external_id}?external_source=tvdb_id` - TVDb → TMDb lookups

**Why suppress?**
- TVDb ID lookups add significant latency (external API calls)
- Overlays typically don't require TVDb IDs for preview rendering
- Show identification by TMDb ID is sufficient for previews

**Logged once per run:**
```
| INFO     | FAST_PREVIEW: skipped TMDb→TVDb conversions (external_ids)
```

**Summary stats:**
```json
{
  "preview_accuracy": {
    "tmdb_skipped_tvdb_conversions": 15
  }
}
```

### H2: Kometa Internal Logging (Cannot Be Suppressed)

Some log messages originate from Kometa internals and cannot be suppressed by the preview proxy:

**Examples of unsuppressed Kometa messages:**
- `"No Items found for Overlay File Overlay File 1 or it was excluded by the overlay filter"` - Kometa's internal builder evaluation
- `"Collection was not added to any items"` - Collection builder results
- `"No Overlay Images found"` - Overlay file evaluation

**Why not suppressed?**
- These messages are generated inside the Kometa subprocess
- The proxy only controls network traffic, not Kometa's internal logging
- Suppressing would require modifying Kometa source code

**Workaround:**
- These messages are informational warnings, not errors
- Preview can still succeed even with these warnings
- Filter logs by `CAPTURED_UPLOAD` or `success: true` for results

## Cache Metadata Validation

The proxy validates metadata responses before caching to prevent parse errors:

1. **Non-empty check**: Response must have content
2. **XML format check**: Response must start with `<`
3. **MediaContainer check**: Must contain MediaContainer element
4. **Parse validation**: Must be valid XML

**Compression Handling:**
- Requests sent with `Accept-Encoding: identity` to prefer uncompressed
- Gzip/deflate responses are decompressed before parsing
- `Content-Encoding` header removed after decompression

**Logs:**
```
| WARNING  | CACHE_METADATA_SKIP ratingKey=12345: empty response
| WARNING  | CACHE_METADATA_SKIP ratingKey=12345: not XML (starts with: '\x1f\x8b...')
| WARNING  | CACHE_METADATA_SKIP ratingKey=12345: no MediaContainer
| WARNING  | CACHE_METADATA_PARSE_ERROR ratingKey=12345: (detailed error)
```

## Upload Capture (P0 Fix)

The proxy captures all poster uploads from Kometa:

### Captured Endpoints
- `/library/metadata/<ratingKey>/poster(s)`
- `/library/metadata/<ratingKey>/art(s)`
- `/library/metadata/<ratingKey>/thumb(s)`
- `/photo/:/transcode` with ratingKey in query
- Any PUT/POST with image content-type

### Capture Logic
1. Parse ratingKey from URL path or query params
2. Extract image from multipart or raw body
3. Save to `output/by_ratingkey/<ratingKey>_<kind>_<timestamp>.<ext>`
4. Return 200 OK to Kometa

**Logs:**
```
| INFO     | CAPTURED_UPLOAD ratingKey=12345 kind=poster bytes=234567 path=/library/metadata/12345/poster
| WARNING  | UPLOAD_IGNORED: PUT /photo/:/transcode reason=no_image_data
```

### Safety Check
If no uploads are captured but targets exist, the log shows:
```
============================================================
UPLOAD CAPTURE FAILURE - No images were captured!
============================================================
Targets: 5
Total blocked requests: 15
Last 20 PUT/POST requests:
  PUT /library/metadata/12345/poster content_type=image/jpeg ...
============================================================
```

## Library Type Fix (P0 Fix)

The proxy ensures correct library types are returned to Kometa:

### Problem Solved
- "Unknown libtype 'movie' ... Available libtypes: ['collection']"
- Caused by real Plex returning a different library at section ID

### Solution
The proxy intercepts `/library/sections/{id}` requests and returns synthetic
section details with the correct type based on preview targets:

```xml
<MediaContainer>
  <Directory key="1" type="movie" title="Movies" ... />
</MediaContainer>
```

**Logs:**
```
| INFO     | MOCK_SECTION_DETAIL section_id=1 type=movie
```

## Font Configuration (P1)

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `PREVIEW_STRICT_FONTS` | `0` | If `1`, fail if fonts missing |
| `PREVIEW_FALLBACK_FONT` | `/fonts/Inter-Regular.ttf` | Default fallback font |

### Validation

At startup, the proxy validates font directories:
- `/config/fonts`
- `/fonts`
- `/usr/share/fonts`

**Logs:**
```
| INFO     | FONT_DIR_FOUND: /config/fonts (12 fonts)
| INFO     | FALLBACK_FONT_OK: /config/fonts/Inter-Regular.ttf
| WARNING  | FONT_DIR_EMPTY: /fonts exists but contains no fonts
```

### Mounting Fonts

To add custom fonts to the container:
```yaml
volumes:
  - ./fonts:/config/fonts:ro
```

Required fonts depend on your overlay configuration. The proxy logs warnings
if common font directories are missing.

## No Fallback Rendering

This implementation does **NOT** include PIL/manual rendering fallback.
If Kometa fails to produce output, the preview job fails with an error.

This ensures:
- Output is always pixel-identical to real Kometa
- No custom rendering that might differ from Kometa
- Clear failure mode when something goes wrong
