# Kometa Preview Mode - Technical Documentation

## Overview

The preview renderer is a specialized component that uses Kometa's internal overlay rendering pipeline to generate preview images **without** modifying Plex metadata or artwork.

## Key Differences from Normal Kometa Runs

| Aspect | Normal Kometa Run | Preview Mode |
|--------|-------------------|--------------|
| Plex Connection | Required | Not used |
| Artwork Source | Plex server | Local files |
| Metadata Updates | Yes (labels, artwork) | No |
| Output Destination | Plex server | Local files |
| Network Required | Yes | No (isolated container) |
| Item Resolution | Plex library scan | Pre-resolved targets |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Kometa Docker Container                   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              preview_entrypoint.py                    │   │
│  │                                                       │   │
│  │  1. Load preview.yml config                          │   │
│  │  2. Load item metadata from meta.json                │   │
│  │  3. For each input image:                            │   │
│  │     - Create MockItem with metadata                  │   │
│  │     - Parse overlay definitions                      │   │
│  │     - Apply overlays using Kometa-style rendering    │   │
│  │     - Save to output directory                       │   │
│  │  4. Write summary.json                               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              kometa_bridge.py                         │   │
│  │                                                       │   │
│  │  - Wraps Kometa's Overlay class (when available)     │   │
│  │  - Provides compatible fallback rendering            │   │
│  │  - Handles text/image overlay creation               │   │
│  │  - Manages positioning and color parsing             │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
/jobs/<jobId>/
├── input/                    # Base artwork images
│   ├── matrix.jpg           # Movie poster
│   ├── dune.jpg             # Movie poster
│   ├── breakingbad_series.jpg
│   ├── breakingbad_s01.jpg
│   └── breakingbad_s01e01.jpg
│
├── config/
│   └── preview.yml          # Generated preview config
│
├── output/                   # Rendered images with overlays
│   ├── matrix_after.png
│   ├── dune_after.png
│   ├── breakingbad_series_after.png
│   ├── breakingbad_s01_after.png
│   ├── breakingbad_s01e01_after.png
│   └── summary.json         # Rendering results
│
├── logs/                     # Container logs
│
└── meta.json                 # Item metadata for rendering
```

## Overlay Rendering Pipeline

### 1. Configuration Loading

The renderer loads `preview.yml` which contains:
- Overlay definitions extracted from the user's Kometa config
- Preview targets with input/output paths
- Settings for the rendering session

### 2. Item Creation

For each input image, a `MockItem` is created that simulates a Plex item with:
- Item type (movie, show, season, episode)
- Title and year
- Rating and content rating
- Media info (resolution, audio codec, HDR status)
- Season/episode numbers

### 3. Overlay Application

Overlays are applied in order using Kometa-compatible rendering:

1. **Text Overlays**
   - Parse text template with variables (e.g., `<<resolution>>`)
   - Resolve variables using item metadata
   - Load font (Kometa's Roboto-Medium.ttf default)
   - Create background rectangle (with optional rounded corners)
   - Draw text with specified colors and styling

2. **Image Overlays**
   - Load overlay image from file
   - Apply scaling if specified
   - Position according to alignment settings

3. **Positioning**
   - `horizontal_align`: left, center, right
   - `vertical_align`: top, center, bottom
   - `horizontal_offset` / `vertical_offset`: pixels or percentage

### 4. Output Generation

- Images are composited using PIL's `alpha_composite`
- Final images are saved as PNG for quality preservation
- A summary.json is written with success/failure status

## Supported Overlay Features

### Text Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `<<resolution>>` | Video resolution | 4K, 1080p |
| `<<audio_codec>>` | Audio codec | Atmos, DTS-HD |
| `<<rating>>` | Audience rating | 9.5 |
| `<<status>>` | Show status | COMPLETED |
| `<<season>>` | Season number | S01 |
| `<<episode>>` | Episode number | E01 |
| `<<runtime>>` | Duration | 58 min |
| `<<year>>` | Release year | 1999 |
| `<<title>>` | Item title | The Matrix |

### Styling Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `font` | string | Roboto-Medium.ttf | Font file name |
| `font_size` | int | 55 | Font size in pixels |
| `font_color` | hex | #FFFFFF | Text color |
| `back_color` | hex | #1E1E1EDC | Background color (with alpha) |
| `back_radius` | int | 0 | Corner radius for background |
| `back_padding` | int | 10 | Padding around text |
| `stroke_width` | int | 0 | Text stroke width |
| `stroke_color` | hex | #000000 | Text stroke color |

### Position Options

| Option | Values | Default | Description |
|--------|--------|---------|-------------|
| `horizontal_align` | left, center, right | left | Horizontal alignment |
| `vertical_align` | top, center, bottom | top | Vertical alignment |
| `horizontal_offset` | int or "50%" | 30 | Horizontal offset |
| `vertical_offset` | int or "50%" | 30 | Vertical offset |

## Canvas Sizes

Kometa uses standardized canvas dimensions:

| Type | Dimensions | Aspect Ratio |
|------|------------|--------------|
| Poster (portrait) | 1000 × 1500 | 2:3 |
| Background (landscape) | 1920 × 1080 | 16:9 |
| Album art (square) | 1000 × 1000 | 1:1 |

Input images are automatically resized to match these dimensions.

## Font Resolution

Fonts are resolved in this order:

1. User fonts directory (`/fonts`)
2. Kometa's bundled fonts (`/modules/fonts`)
3. System fonts (`/usr/share/fonts`)
4. Fallback: Roboto-Medium.ttf

## Safety Guarantees

1. **No Plex Writes**: The renderer never connects to Plex or modifies any server data
2. **Network Isolation**: Docker container runs with `NetworkMode: 'none'`
3. **Read-Only Mounts**: User assets and config are mounted read-only
4. **Local Only**: All I/O is through local filesystem

## Error Handling

The renderer:
- Logs all operations to stdout/stderr
- Continues processing on individual overlay failures
- Generates summary.json with success/failure details
- Preserves stack traces for debugging
- Returns non-zero exit code on fatal errors

## Extending the Renderer

To add new overlay types or variables:

1. Add variable resolution in `_resolve_text_variables()`
2. Add default overlay definition in `_get_default_overlay_def()`
3. Update MockItem to include required metadata fields

## Debugging

Enable verbose logging:
```bash
PYTHONUNBUFFERED=1 python3 preview_entrypoint.py --job /jobs/<id>
```

Check summary.json for per-item results:
```json
{
  "success": true,
  "total": 5,
  "succeeded": 5,
  "failed": 0,
  "results": [...],
  "warnings": [],
  "kometa_modules_used": true
}
```
