# Kometa Preview Mode - Technical Documentation

## Overview

The preview renderer runs **real Kometa** inside the container with **write blocking**
to produce pixel-identical overlay outputs without modifying Plex.

This is the "Path A" implementation: run Kometa normally, intercept outputs.

## Key Differences from Normal Kometa Runs

| Aspect | Normal Kometa Run | Preview Mode |
|--------|-------------------|--------------|
| Plex Connection | Read/Write | Read-only (writes blocked) |
| Artwork Source | Plex server | Local files + Plex read |
| Metadata Updates | Yes (labels, artwork) | No (blocked) |
| Output Destination | Uploaded to Plex | Saved to local files |
| Network for Plex | Full access | GET requests only |

## Architecture (Path A)

```
┌─────────────────────────────────────────────────────────────┐
│                    Kometa Docker Container                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              preview_entrypoint.py                    │   │
│  │                                                       │   │
│  │  1. Install PlexWriteBlocker (monkeypatch requests)  │   │
│  │     - Block PUT/POST/DELETE/PATCH to Plex URL        │   │
│  │     - Log all blocked attempts                        │   │
│  │                                                       │   │
│  │  2. Install OverlayOutputCapture                     │   │
│  │     - Patch upload_poster() to copy files instead    │   │
│  │     - Save outputs to /jobs/<id>/output/              │   │
│  │                                                       │   │
│  │  3. Run real Kometa via subprocess                   │   │
│  │     - Uses generated kometa_config.yml               │   │
│  │     - Streams stdout/stderr for SSE logging          │   │
│  │                                                       │   │
│  │  4. Write summary.json with results                  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Kometa (real execution)                  │   │
│  │                                                       │   │
│  │  - Connects to Plex (GET requests allowed)           │   │
│  │  - Reads library metadata                            │   │
│  │  - Applies overlays using real overlay pipeline      │   │
│  │  - Attempts to upload (captured by our patches)      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Write Blocking Mechanism

### PlexWriteBlocker

Monkeypatches `requests.Session.request` to intercept all HTTP requests:

```python
# Pseudocode
def blocked_request(session, method, url, **kwargs):
    if url.startswith(plex_url) and method != 'GET':
        log(f"BLOCKED: {method} {url}")
        return fake_200_response()
    return original_request(session, method, url, **kwargs)
```

**Blocked methods:**
- `PUT` - artwork uploads
- `POST` - metadata updates
- `DELETE` - item removal
- `PATCH` - partial updates

**Allowed:**
- `GET` - Kometa needs to read library/item metadata

### OverlayOutputCapture

Patches Kometa's upload methods to capture outputs:

```python
# Pseudocode
def patched_upload_poster(library, item, image_path, url=False):
    if image_path and os.path.exists(image_path):
        # Copy to our output directory instead of uploading
        output_path = output_dir / f"{item_id}_after.png"
        shutil.copy2(image_path, output_path)
        log(f"CAPTURED: {item.title} -> {output_path}")
    # Don't actually upload
    return None
```

## File Structure

```
/jobs/<jobId>/
├── input/                    # Base artwork images (from backend)
│   ├── matrix.jpg
│   ├── dune.jpg
│   ├── breakingbad_series.jpg
│   ├── breakingbad_s01.jpg
│   └── breakingbad_s01e01.jpg
│
├── config/
│   ├── preview.yml          # Generated preview config
│   └── kometa_config.yml    # Generated Kometa config
│
├── output/                   # Captured overlay outputs
│   ├── matrix_after.png
│   ├── dune_after.png
│   ├── breakingbad_series_after.png
│   ├── breakingbad_s01_after.png
│   ├── breakingbad_s01e01_after.png
│   └── summary.json
│
├── logs/                     # Container logs
│
└── meta.json                 # Item metadata
```

## Config Generation

The backend generates a **valid Kometa config** (not a custom format):

```yaml
plex:
  url: "http://your-plex:32400"
  token: "your-token"
  timeout: 60
  clean_bundles: false
  empty_trash: false
  optimize: false

settings:
  cache: false
  run_order: ['overlays']  # Only run overlays
  # ... other settings disabled

libraries:
  Movies:
    overlay_files:
      - pmm: resolution
      - pmm: audio_codec
    operations: null      # Disabled
    collections: null     # Disabled
    metadata: null        # Disabled

preview:
  mode: 'write_blocked'
  targets:
    - id: matrix
      type: movie
      title: "The Matrix"
    # ... other targets
```

## Kometa Execution

The renderer runs Kometa as a subprocess:

```bash
python /kometa.py -r --config /jobs/<id>/config/kometa_config.yml
```

Flags:
- `-r` or `--run`: Run once (not scheduled mode)
- `--config`: Path to config file

Output is streamed to stdout for SSE logging.

## Fallback Rendering

If Kometa execution fails (e.g., can't find kometa.py), the renderer
falls back to basic PIL overlay application:

1. Load input image
2. Apply type-appropriate badge (resolution, rating, season, episode)
3. Save to output directory

This ensures previews are always generated, even if degraded.

## Summary Output

`/jobs/<id>/output/summary.json`:

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "success": true,
  "kometa_exit_code": 0,
  "kometa_ran": true,
  "blocked_write_attempts": [
    {
      "method": "PUT",
      "url": "http://plex:32400/library/metadata/12345/posters",
      "timestamp": "2024-01-15T10:30:15Z"
    }
  ],
  "captured_outputs": [
    {
      "ratingKey": "12345",
      "title": "The Matrix",
      "source": "/config/overlays/temp.png",
      "destination": "/jobs/.../output/matrix_after.png",
      "timestamp": "2024-01-15T10:30:15Z"
    }
  ],
  "output_files": [
    "matrix_after.png",
    "dune_after.png",
    "breakingbad_series_after.png",
    "breakingbad_s01_after.png",
    "breakingbad_s01e01_after.png"
  ]
}
```

## Safety Guarantees

1. **No Plex Writes**: All non-GET requests to Plex are blocked at the HTTP layer
2. **Logged Attempts**: Every blocked write is logged for verification
3. **Network Isolation**: Container runs with `NetworkMode: 'none'` for extra safety
4. **Read-Only Mounts**: User assets and config are mounted read-only
5. **Local Output Only**: Results saved to local filesystem, never uploaded

## Pixel Identity

Because we run Kometa's actual overlay pipeline:
- Same overlay parsing and template resolution
- Same font loading and text rendering
- Same image composition and positioning
- Same color handling and alpha blending

The only difference is the final "upload to Plex" step is replaced with
"copy to output directory".

## Debugging

Check the summary.json for:
- `kometa_ran`: Did Kometa execute?
- `kometa_exit_code`: Did it succeed?
- `blocked_write_attempts`: What writes were blocked?
- `captured_outputs`: What files were captured?
- `output_files`: What outputs were generated?

Enable verbose logging:
```bash
PYTHONUNBUFFERED=1 python3 preview_entrypoint.py --job /jobs/<id>
```

## Deprecated Files

The following files are deprecated and not used in Path A:
- `renderer/kometa_bridge.py` - Was for custom overlay rendering, now bypassed
