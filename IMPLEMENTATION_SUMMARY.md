# Custom Fonts Implementation Summary

## What Was Implemented

Custom font support has been fully implemented for Kometa Preview Studio's fast/instant preview mode. The instant compositor can now use your custom fonts (Adlib.ttf, Impact.ttf, Avenir_95_Black.ttf, etc.) exactly as configured in your Kometa config.

## Technical Changes

### 1. Font Loading Infrastructure
**File:** `renderer/instant_compositor.py` (lines 104-164)

- Modified `_get_cached_font()` to accept optional `custom_font_path` parameter
- Searches for fonts in this order:
  1. `/user_config/{custom_font_path}` (mounted Kometa config)
  2. `/{custom_font_path}` (absolute path)
  3. `{custom_font_path}` (relative path)
  4. Default system fonts
- Font cache now uses `(path, size)` tuple as key for efficient caching

### 2. Font Configuration Parser
**File:** `renderer/instant_compositor.py` (lines 901-950)

Created `_extract_rating_fonts_from_config()` which:
- Parses Kometa config `libraries.{library}.overlay_files` entries
- Extracts `rating1_font`, `rating2_font`, `rating3_font` paths
- Extracts `rating1_font_size`, `rating2_font_size`, `rating3_font_size`
- Returns dict: `{'rating1': (63, 'config/fonts/Adlib.ttf'), ...}`

### 3. Badge Rendering with Custom Fonts
**File:** `renderer/instant_compositor.py` (lines 756-821)

Updated `_create_single_rating_badge()` to:
- Accept optional `custom_font_path` parameter
- Pass custom font to `_get_cached_font()`
- Log successful custom font loading

### 4. Ratings Overlay Integration
**File:** `renderer/instant_compositor.py` (lines 1107-1126)

Modified ratings rendering to:
- Extract font config for each rating (rating1, rating2, rating3)
- Build rating data with 4-tuples: `(source, value, font_size, font_path)`
- Pass font path through to badge creation

### 5. Pipeline Integration
**Files:**
- `renderer/instant_compositor.py` (lines 1228-1257, 1394-1476)
- `renderer/instant_compositor.py` (lines 1533-1571, 1336-1382)

Updated all entry points:
- `_composite_target()` - accepts and passes `rating_fonts` parameter
- `_composite_manual_target()` - accepts and passes `rating_fonts` parameter
- `run_instant_preview()` - extracts and distributes font configs
- `run_manual_preview()` - extracts and distributes font configs
- `composite_overlays()` - accepts `rating_fonts` parameter

### 6. Docker Configuration
**File:** `docker-compose.yml` (lines 30-44)

- Added `USER_KOMETA_CONFIG_PATH` environment variable
- Added documentation comments for volume mount
- Volume mount ready at `/user_config:ro`

### 7. Infrastructure Already in Place
**File:** `backend/src/kometa/runner.ts` (lines 266-268)

The backend runner already had support for mounting user Kometa configs:
```typescript
if (this.config.userKometaConfigPath) {
  binds.push(`${this.config.userKometaConfigPath}:/user_config:ro`);
}
```

## Setup Files Created

### CUSTOM_FONTS.md
Complete user documentation including:
- How the feature works
- Two setup methods (environment variable or direct path)
- Finding your Kometa config directory
- Verification steps
- Troubleshooting guide

### setup-custom-fonts.sh
Interactive setup script that:
- Prompts for Kometa config directory path
- Validates the path
- Creates/updates `.env` file
- Updates `docker-compose.yml`
- Provides next-step instructions

## How It Works

1. User mounts their Kometa config directory to `/user_config` via docker-compose
2. When a preview job runs, the instant compositor:
   - Loads the generated config YAML
   - Extracts font paths from `template_variables` in the ratings overlay config
   - Maps rating1/2/3 to their respective fonts
3. When rendering rating badges:
   - Looks up the font for that rating number
   - Tries to load from `/user_config/config/fonts/{font_name}.ttf`
   - Falls back to system fonts if not found
4. The badge is rendered with the custom font at the specified size

## Example Output

When working correctly, you'll see:
```
Loaded positioning config for library: Movies
  Positioned overlays: ['ratings']
Loaded custom rating fonts:
  rating1: config/fonts/Adlib.ttf @ 63pt
  rating2: config/fonts/Impact.ttf @ 70pt
  rating3: config/fonts/Avenir_95_Black.ttf @ 70pt
Processing 5 targets in parallel (max 4 workers)...
  Using rating logo PNG asset for: rt_critics
Loaded custom font: /user_config/config/fonts/Adlib.ttf at size 63
  Using rating logo PNG asset for: imdb
Loaded custom font: /user_config/config/fonts/Impact.ttf at size 70
  Using rating logo PNG asset for: tmdb
Loaded custom font: /user_config/config/fonts/Avenir_95_Black.ttf at size 70
  Ratings positioned at (840, 693) using config (center badge)
```

## User Action Required

To enable this feature, you need to:

1. **Find your Kometa config directory** (contains `config.yml` and `config/fonts/`)

2. **Run the setup script:**
   ```bash
   ./setup-custom-fonts.sh
   ```
   OR manually configure:

3. **Create `.env` file:**
   ```bash
   echo "KOMETA_CONFIG_PATH=/path/to/your/kometa" > .env
   ```

4. **Add volume mount to docker-compose.yml:**
   ```yaml
   volumes:
     - ${KOMETA_CONFIG_PATH}:/user_config:ro
   ```

5. **Restart containers:**
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

## Benefits

- ✅ Fast preview mode now matches full Kometa output exactly
- ✅ No need to wait for full Kometa run to see correct fonts
- ✅ Graceful fallback to system fonts if not configured
- ✅ Read-only mount - your Kometa config is never modified
- ✅ Works with all custom fonts in your config

## Compatibility

- Works with all rating fonts: `rating1_font`, `rating2_font`, `rating3_font`
- Respects custom font sizes: `rating1_font_size`, etc.
- Compatible with all Kometa font paths: relative, absolute, or config-relative
- No changes required to your existing Kometa config
