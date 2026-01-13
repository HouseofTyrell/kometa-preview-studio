# Kometa Preview Mode - Technical Documentation

## Overview

The preview renderer runs **real Kometa** with a **local HTTP proxy** that blocks
all write operations to Plex while allowing reads. This ensures pixel-identical
overlay output with zero risk of modifying Plex.

## Safety Architecture (Proxy-Based Write Blocking)

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Container                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              preview_entrypoint.py                    │   │
│  │                                                       │   │
│  │  1. Start PlexProxy on 127.0.0.1:32500               │   │
│  │     - Forward GET/HEAD to real Plex                  │   │
│  │     - Block PUT/POST/PATCH/DELETE → return 200       │   │
│  │     - Log all blocked attempts                        │   │
│  │                                                       │   │
│  │  2. Generate kometa_run.yml                          │   │
│  │     - plex.url = http://127.0.0.1:32500 (proxy)      │   │
│  │     - plex.token = real token                        │   │
│  │                                                       │   │
│  │  3. Run Kometa subprocess                            │   │
│  │     - Kometa connects to proxy, not real Plex        │   │
│  │     - All writes blocked at network layer            │   │
│  │                                                       │   │
│  │  4. Export rendered images to output/                │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                               │
│                              ▼                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              PlexProxy (127.0.0.1:32500)              │   │
│  │                                                       │   │
│  │   GET /library/...  ──────────────►  Real Plex       │   │
│  │   HEAD /...         ──────────────►  Real Plex       │   │
│  │                                                       │   │
│  │   PUT /...          ──► BLOCKED (return 200)         │   │
│  │   POST /...         ──► BLOCKED (return 200)         │   │
│  │   PATCH /...        ──► BLOCKED (return 200)         │   │
│  │   DELETE /...       ──► BLOCKED (return 200)         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
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

## Request Flow

### Allowed (GET/HEAD)
```
Kometa → Proxy:32500 → Real Plex:32400 → Response → Kometa
```

### Blocked (PUT/POST/PATCH/DELETE)
```
Kometa → Proxy:32500 → BLOCKED → 200 OK {} → Kometa
                     └─► Logged to blocked_requests[]
```

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

## Output Export

After Kometa runs, the renderer locates and exports overlay outputs:

1. Check `{config_dir}/overlays/` for rendered images
2. Look for `temp.png`, `temp.jpg`, `temp.webp` files
3. Copy to `/jobs/<id>/output/<target>_after.png`

### Output Files

```
/jobs/<jobId>/output/
├── matrix_after.png
├── dune_after.png
├── breakingbad_series_after.png
├── breakingbad_s01_after.png
├── breakingbad_s01e01_after.png
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
      "timestamp": "2024-01-15T10:30:15Z"
    }
  ],
  "exported_files": {
    "matrix": "/jobs/.../output/matrix_after.png"
  },
  "output_files": ["matrix_after.png", "dune_after.png", ...]
}
```

## Safety Guarantees

1. **Network-layer blocking**: All Plex writes blocked at HTTP proxy level
2. **Process-boundary safe**: Works with subprocess execution
3. **Logged attempts**: Every blocked write recorded in summary.json
4. **No fallback rendering**: If Kometa fails, job fails (no PIL fallback)

## Verification

To verify no writes occurred:

1. Check `summary.json` → `blocked_write_attempts`
2. Look for `BLOCKED_WRITE:` lines in logs
3. Compare Plex artwork before/after preview

## Limitations

1. **Full library processing**: Kometa processes entire library, not just 5 items
2. **Single temp file**: Output export assumes one overlay at a time
3. **No item tracking**: Cannot map which overlay went to which item

## No Fallback Rendering

This implementation does **NOT** include PIL/manual rendering fallback.
If Kometa fails to produce output, the preview job fails with an error.

This ensures:
- Output is always pixel-identical to real Kometa
- No custom rendering that might differ from Kometa
- Clear failure mode when something goes wrong
