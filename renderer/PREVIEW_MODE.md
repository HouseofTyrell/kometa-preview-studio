# Kometa Preview Mode - Technical Documentation

## Overview

The preview renderer runs **real Kometa** with a **local HTTP proxy** that blocks
all write operations to Plex while **capturing the uploaded images**. This ensures
pixel-identical overlay output with zero risk of modifying Plex.

## Safety Architecture (Proxy-Based Write Blocking + Upload Capture)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Renderer Container                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              preview_entrypoint.py                            │   │
│  │                                                               │   │
│  │  1. Start PlexProxy on 127.0.0.1:32500                       │   │
│  │     - Forward GET/HEAD to real Plex                          │   │
│  │     - Block PUT/POST → return 200, CAPTURE image bytes       │   │
│  │     - Parse ratingKey from /library/metadata/<id>/posters    │   │
│  │     - Save to: output/by_ratingkey/<ratingKey>_poster.jpg    │   │
│  │                                                               │   │
│  │  2. Generate kometa_run.yml                                  │   │
│  │     - plex.url = http://127.0.0.1:32500 (proxy)              │   │
│  │     - plex.token = real token                                │   │
│  │                                                               │   │
│  │  3. Run Kometa subprocess                                    │   │
│  │     - Kometa connects to proxy, not real Plex                │   │
│  │     - All writes blocked + captured at network layer         │   │
│  │                                                               │   │
│  │  4. Map captured uploads to targets by ratingKey             │   │
│  │     - Read preview.targets[].ratingKey from config           │   │
│  │     - Match captured uploads to targets                       │   │
│  │     - Copy to output/<target_id>_after.<ext>                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              PlexProxy (127.0.0.1:32500)                      │   │
│  │                                                               │   │
│  │   GET /library/...  ──────────────────►  Real Plex           │   │
│  │   HEAD /...         ──────────────────►  Real Plex           │   │
│  │                                                               │   │
│  │   PUT /library/metadata/12345/posters                        │   │
│  │     │                                                         │   │
│  │     ├─► Parse ratingKey (12345) from path                    │   │
│  │     ├─► Extract image bytes from multipart body              │   │
│  │     ├─► Save to by_ratingkey/12345_poster_<ts>.jpg           │   │
│  │     └─► Return 200 OK {} (Kometa thinks it succeeded)        │   │
│  │                                                               │   │
│  │   POST /...  ─► Same as PUT (block + capture)                │   │
│  │   PATCH /... ─► BLOCKED (return 200)                         │   │
│  │   DELETE /.. ─► BLOCKED (return 200)                         │   │
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
  "captured_uploads": [
    {
      "rating_key": "12345",
      "method": "PUT",
      "path": "/library/metadata/12345/posters",
      "kind": "poster",
      "timestamp": "2024-01-15T10:30:15Z",
      "size_bytes": 1234567,
      "saved_path": "/jobs/.../output/by_ratingkey/12345_poster_*.jpg",
      "parse_error": null
    }
  ],
  "captured_uploads_count": 5,
  "successful_captures_count": 5,
  "exported_files": {
    "matrix": "/jobs/.../output/matrix_after.jpg",
    "dune": "/jobs/.../output/dune_after.jpg"
  },
  "missing_targets": [],
  "output_files": ["matrix_after.jpg", "dune_after.jpg", ...]
}
```

## Safety Guarantees

1. **Network-layer blocking**: All Plex writes blocked at HTTP proxy level
2. **Process-boundary safe**: Works with subprocess execution
3. **Captured uploads**: Every blocked write's image data is saved
4. **Deterministic mapping**: Outputs mapped by Plex ratingKey, not filename guessing
5. **No fallback rendering**: If Kometa fails, job fails (no PIL fallback)

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

## Logging

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
