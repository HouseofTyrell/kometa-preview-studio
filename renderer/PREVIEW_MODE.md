# Kometa Preview Mode - Technical Documentation

## Overview

The preview renderer runs **real Kometa** with a **local HTTP proxy** that:
1. **Blocks all write operations** to Plex (captures uploaded images)
2. **Filters library listings** to only show the preview targets (5 items)

This ensures pixel-identical overlay output with zero risk of modifying Plex,
while processing **only the preview items** instead of your entire library.

## Why Filtering Matters

Without filtering, Kometa would enumerate your entire library and process
hundreds or thousands of items, even though we only want to preview 5.

**Before (no filtering):**
- Kometa queries `/library/sections/1/all` → receives 2000+ items
- Processes all items → takes 10+ minutes
- Only 5 captures matter, rest is wasted work

**After (with filtering proxy):**
- Kometa queries `/library/sections/1/all` → receives only 5 items
- Processes only those 5 items → completes in seconds
- All work directly produces useful preview output

## Safety Architecture (Filtering Proxy + Write Blocking + Upload Capture)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Renderer Container                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              preview_entrypoint.py                            │   │
│  │                                                               │   │
│  │  1. Load preview.yml → extract allowed ratingKeys (5 items)  │   │
│  │                                                               │   │
│  │  2. Start PlexProxy on 127.0.0.1:32500                       │   │
│  │     - FILTER library listings to only allowed ratingKeys     │   │
│  │     - BLOCK metadata requests for non-allowed ratingKeys     │   │
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
│  │          PlexProxy (127.0.0.1:32500) - FILTERING             │   │
│  │                                                               │   │
│  │   GET /library/sections/1/all                                │   │
│  │     │                                                         │   │
│  │     ├─► Forward to real Plex                                 │   │
│  │     ├─► Parse XML response (2000 items)                      │   │
│  │     ├─► FILTER: keep only allowed ratingKeys (5 items)       │   │
│  │     ├─► Update MediaContainer size=5                         │   │
│  │     └─► Return filtered XML to Kometa                        │   │
│  │                                                               │   │
│  │   GET /library/metadata/12345  (allowed)                     │   │
│  │     └─► Forward to real Plex → return response               │   │
│  │                                                               │   │
│  │   GET /library/metadata/99999  (NOT allowed)                 │   │
│  │     └─► Return empty <MediaContainer size="0"/>              │   │
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
  "filtering": {
    "enabled": true,
    "allowed_rating_keys": ["12345", "12346", "12347", "12348", "12349"],
    "allowed_count": 5,
    "filtered_requests": [
      {
        "path": "/library/sections/1/all",
        "method": "GET",
        "original_bytes": 245678,
        "filtered_bytes": 3456,
        "timestamp": "2024-01-15T10:30:05Z"
      }
    ],
    "filtered_requests_count": 3
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

### Filtering Logs
```
| INFO     | FILTERING ENABLED: Only 5 items allowed
| INFO     | Allowed ratingKeys: ['12345', '12346', '12347', '12348', '12349']
| INFO     | FILTER_LIST endpoint=/library/sections/1/all original_bytes=245678 filtered_bytes=3456 allowed=5
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

## No Fallback Rendering

This implementation does **NOT** include PIL/manual rendering fallback.
If Kometa fails to produce output, the preview job fails with an error.

This ensures:
- Output is always pixel-identical to real Kometa
- No custom rendering that might differ from Kometa
- Clear failure mode when something goes wrong
