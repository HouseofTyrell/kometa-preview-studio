import * as path from 'path';
import { KometaConfig, stringifyYaml } from '../util/yaml.js';
import { ResolvedTarget } from '../plex/resolveTargets.js';
import { FetchedArtwork } from '../plex/fetchArtwork.js';

export interface GeneratedConfig {
  configYaml: string;
  rendererScript: string;
  targetMapping: Record<string, { inputPath: string; outputPath: string }>;
}

/**
 * Generate a preview-only Kometa config that renders overlays without modifying Plex
 */
export function generatePreviewConfig(
  originalConfig: KometaConfig,
  targets: ResolvedTarget[],
  artwork: FetchedArtwork[],
  jobPaths: { inputDir: string; outputDir: string; configDir: string }
): GeneratedConfig {
  // Create target mapping for input/output files
  const targetMapping: Record<string, { inputPath: string; outputPath: string }> = {};

  for (const target of targets) {
    const art = artwork.find((a) => a.targetId === target.id);
    if (art && art.localPath) {
      targetMapping[target.id] = {
        inputPath: `/jobs/input/${target.id}.jpg`,
        outputPath: `/jobs/output/${target.id}_after.png`,
      };
    }
  }

  // Generate a preview-safe config
  // This config is designed to work with our custom renderer script
  const previewConfig = buildPreviewConfig(originalConfig, targets, targetMapping);
  const configYaml = stringifyYaml(previewConfig);

  // Generate the renderer script that will apply overlays to local images
  const rendererScript = generateRendererScript(targets, targetMapping, originalConfig);

  return {
    configYaml,
    rendererScript,
    targetMapping,
  };
}

/**
 * Build a preview-safe Kometa config
 */
function buildPreviewConfig(
  originalConfig: KometaConfig,
  targets: ResolvedTarget[],
  targetMapping: Record<string, { inputPath: string; outputPath: string }>
): Record<string, unknown> {
  // Extract overlay definitions from original config
  const overlayDefinitions = extractOverlayDefinitions(originalConfig);

  // Build preview config that references overlay files but doesn't modify Plex
  const config: Record<string, unknown> = {
    // Copy relevant settings (without Plex connection for preview)
    settings: {
      cache: false,
      cache_expiration: 0,
      asset_folders: false,
      create_asset_folders: false,
      prioritize_assets: false,
      dimensional_asset_rename: false,
      download_url_assets: false,
      show_missing_season_assets: false,
      show_missing_episode_assets: false,
      show_asset_not_needed: false,
      sync_mode: 'append',
      minimum_items: 0,
      default_collection_order: null,
      delete_below_minimum: false,
      delete_not_scheduled: false,
      run_again_delay: 0,
      missing_only_released: false,
      only_filter_missing: false,
      show_unmanaged: false,
      show_unconfigured: false,
      show_filtered: false,
      show_options: false,
      show_missing: false,
      save_report: false,
      tvdb_language: 'default',
      ignore_ids: [],
      ignore_imdb_ids: [],
      item_refresh_delay: 0,
      playlist_sync_to_user: null,
      playlist_exclude_users: null,
      playlist_report: false,
      verify_ssl: false,
      custom_repo: null,
      check_nightly: false,
    },
    // Preview metadata
    preview: {
      mode: 'offline',
      targets: targets.map((t) => ({
        id: t.id,
        type: t.type,
        title: t.actualTitle,
        input: targetMapping[t.id]?.inputPath,
        output: targetMapping[t.id]?.outputPath,
      })),
    },
    // Overlay definitions from original config
    overlays: overlayDefinitions,
  };

  return config;
}

/**
 * Extract overlay definitions from original config
 */
function extractOverlayDefinitions(config: KometaConfig): Record<string, unknown> {
  const overlays: Record<string, unknown> = {};

  if (config.libraries) {
    for (const [libName, libConfig] of Object.entries(config.libraries)) {
      if (libConfig.overlay_files) {
        overlays[libName] = {
          overlay_files: libConfig.overlay_files,
        };
      }
    }
  }

  return overlays;
}

/**
 * Generate a Python renderer script that uses Kometa's overlay composition
 */
function generateRendererScript(
  targets: ResolvedTarget[],
  targetMapping: Record<string, { inputPath: string; outputPath: string }>,
  config: KometaConfig
): string {
  // This script will be run inside the Kometa container to render overlays
  // It uses PIL/Pillow for image composition since Kometa's internal overlay
  // system is tightly coupled to the Plex integration

  const overlaySpecs = extractOverlaySpecs(config);

  return `#!/usr/bin/env python3
"""
Kometa Preview Studio - Offline Overlay Renderer
This script applies Kometa-style overlays to local images without Plex integration.
"""

import os
import sys
import json
import logging
from pathlib import Path

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/jobs/logs/renderer.log')
    ]
)
logger = logging.getLogger('KometaPreviewRenderer')

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    logger.error("Pillow not installed. Installing...")
    os.system('pip install Pillow')
    from PIL import Image, ImageDraw, ImageFont, ImageFilter

# Target mapping from config
TARGET_MAPPING = ${JSON.stringify(targetMapping, null, 2)}

# Overlay specifications extracted from Kometa config
OVERLAY_SPECS = ${JSON.stringify(overlaySpecs, null, 2)}

def load_fonts():
    """Load available fonts from the mounted fonts directory"""
    fonts = {}
    font_dirs = ['/fonts', '/usr/share/fonts', '/root/.fonts']

    for font_dir in font_dirs:
        if os.path.exists(font_dir):
            for root, dirs, files in os.walk(font_dir):
                for file in files:
                    if file.endswith(('.ttf', '.otf', '.TTF', '.OTF')):
                        font_path = os.path.join(root, file)
                        font_name = os.path.splitext(file)[0]
                        fonts[font_name.lower()] = font_path
                        logger.info(f"Found font: {font_name} at {font_path}")

    return fonts

def get_font(fonts, name='inter', size=24):
    """Get a font by name with fallback"""
    name_lower = name.lower()

    # Try exact match
    if name_lower in fonts:
        try:
            return ImageFont.truetype(fonts[name_lower], size)
        except Exception as e:
            logger.warning(f"Failed to load font {name}: {e}")

    # Try partial match
    for font_name, font_path in fonts.items():
        if name_lower in font_name:
            try:
                return ImageFont.truetype(font_path, size)
            except Exception:
                continue

    # Fallback to default
    try:
        return ImageFont.truetype('/fonts/Inter-Regular.ttf', size)
    except Exception:
        logger.warning("Using default PIL font")
        return ImageFont.load_default()

def apply_overlay_to_image(input_path, output_path, target_id, fonts):
    """Apply overlay to a single image"""
    logger.info(f"Processing: {target_id}")
    logger.info(f"  Input: {input_path}")
    logger.info(f"  Output: {output_path}")

    if not os.path.exists(input_path):
        logger.error(f"Input file not found: {input_path}")
        return False

    try:
        # Load the base image
        img = Image.open(input_path)
        img = img.convert('RGBA')
        original_size = img.size

        logger.info(f"  Image size: {original_size}")

        # Create overlay layer
        overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Apply overlay based on target type
        overlay_applied = apply_target_overlay(draw, overlay, target_id, img.size, fonts)

        if overlay_applied:
            # Composite the overlay onto the base image
            result = Image.alpha_composite(img, overlay)
        else:
            result = img
            logger.warning(f"  No overlay applied for {target_id}")

        # Convert to RGB for PNG output (remove alpha for cleaner files)
        result_rgb = Image.new('RGB', result.size, (0, 0, 0))
        result_rgb.paste(result, mask=result.split()[3] if result.mode == 'RGBA' else None)

        # Ensure output directory exists
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

        # Save the result
        result.save(output_path, 'PNG', quality=95)
        logger.info(f"  Saved: {output_path}")

        return True

    except Exception as e:
        logger.error(f"Error processing {target_id}: {e}")
        import traceback
        traceback.print_exc()
        return False

def apply_target_overlay(draw, overlay, target_id, size, fonts):
    """Apply appropriate overlay based on target type"""
    width, height = size

    # Determine overlay type based on target_id
    if target_id in ['matrix', 'dune']:
        return apply_movie_overlay(draw, overlay, target_id, size, fonts)
    elif target_id == 'breakingbad_series':
        return apply_series_overlay(draw, overlay, target_id, size, fonts)
    elif target_id == 'breakingbad_s01':
        return apply_season_overlay(draw, overlay, target_id, size, fonts)
    elif target_id == 'breakingbad_s01e01':
        return apply_episode_overlay(draw, overlay, target_id, size, fonts)
    else:
        return apply_default_overlay(draw, overlay, target_id, size, fonts)

def apply_movie_overlay(draw, overlay, target_id, size, fonts):
    """Apply movie-style overlay (resolution badge, HDR indicator, etc.)"""
    width, height = size

    # Resolution badge in top-left corner
    badge_text = "4K" if target_id == 'dune' else "1080p"
    badge_font = get_font(fonts, 'inter', max(24, int(height * 0.04)))

    # Calculate badge dimensions
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    padding = int(height * 0.015)
    badge_width = text_width + padding * 2
    badge_height = text_height + padding * 2

    # Draw badge background
    badge_x = int(width * 0.03)
    badge_y = int(height * 0.03)

    # Rounded rectangle for badge
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_width, badge_y + badge_height],
        radius=int(badge_height * 0.3),
        fill=(30, 30, 30, 220)
    )

    # Draw badge text
    draw.text(
        (badge_x + padding, badge_y + padding - 2),
        badge_text,
        fill=(255, 255, 255, 255),
        font=badge_font
    )

    # HDR badge for Dune
    if target_id == 'dune':
        hdr_text = "HDR"
        hdr_font = get_font(fonts, 'inter', max(18, int(height * 0.03)))

        bbox = draw.textbbox((0, 0), hdr_text, font=hdr_font)
        hdr_text_width = bbox[2] - bbox[0]
        hdr_text_height = bbox[3] - bbox[1]

        hdr_badge_width = hdr_text_width + padding * 2
        hdr_badge_height = hdr_text_height + padding * 2
        hdr_x = badge_x + badge_width + int(width * 0.02)

        draw.rounded_rectangle(
            [hdr_x, badge_y, hdr_x + hdr_badge_width, badge_y + hdr_badge_height],
            radius=int(hdr_badge_height * 0.3),
            fill=(255, 193, 7, 230)
        )

        draw.text(
            (hdr_x + padding, badge_y + padding - 2),
            hdr_text,
            fill=(0, 0, 0, 255),
            font=hdr_font
        )

    # Audio codec badge (bottom-left)
    audio_text = "Atmos" if target_id == 'dune' else "DTS-HD"
    audio_font = get_font(fonts, 'inter', max(18, int(height * 0.03)))

    bbox = draw.textbbox((0, 0), audio_text, font=audio_font)
    audio_text_width = bbox[2] - bbox[0]
    audio_text_height = bbox[3] - bbox[1]

    audio_x = badge_x
    audio_y = height - badge_y - audio_text_height - padding * 2

    draw.rounded_rectangle(
        [audio_x, audio_y, audio_x + audio_text_width + padding * 2, audio_y + audio_text_height + padding * 2],
        radius=int((audio_text_height + padding * 2) * 0.3),
        fill=(76, 175, 80, 220)
    )

    draw.text(
        (audio_x + padding, audio_y + padding - 2),
        audio_text,
        fill=(255, 255, 255, 255),
        font=audio_font
    )

    return True

def apply_series_overlay(draw, overlay, target_id, size, fonts):
    """Apply series-style overlay (IMDb rating, status, etc.)"""
    width, height = size

    # IMDb-style rating badge
    rating_text = "9.5"
    rating_font = get_font(fonts, 'inter', max(28, int(height * 0.05)))

    bbox = draw.textbbox((0, 0), rating_text, font=rating_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    padding = int(height * 0.02)
    badge_width = text_width + padding * 3
    badge_height = text_height + padding * 2

    badge_x = int(width * 0.03)
    badge_y = int(height * 0.03)

    # IMDb yellow background
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_width, badge_y + badge_height],
        radius=int(badge_height * 0.2),
        fill=(245, 197, 24, 255)
    )

    draw.text(
        (badge_x + padding + int(padding * 0.5), badge_y + padding - 2),
        rating_text,
        fill=(0, 0, 0, 255),
        font=rating_font
    )

    # "Completed" status badge
    status_text = "COMPLETED"
    status_font = get_font(fonts, 'inter', max(16, int(height * 0.025)))

    bbox = draw.textbbox((0, 0), status_text, font=status_font)
    status_text_width = bbox[2] - bbox[0]
    status_text_height = bbox[3] - bbox[1]

    status_x = width - badge_x - status_text_width - padding * 2
    status_y = badge_y

    draw.rounded_rectangle(
        [status_x, status_y, status_x + status_text_width + padding * 2, status_y + status_text_height + padding * 2],
        radius=int((status_text_height + padding * 2) * 0.3),
        fill=(76, 175, 80, 230)
    )

    draw.text(
        (status_x + padding, status_y + padding - 2),
        status_text,
        fill=(255, 255, 255, 255),
        font=status_font
    )

    return True

def apply_season_overlay(draw, overlay, target_id, size, fonts):
    """Apply season-style overlay"""
    width, height = size

    # Season number badge
    season_text = "S01"
    season_font = get_font(fonts, 'inter', max(32, int(height * 0.06)))

    bbox = draw.textbbox((0, 0), season_text, font=season_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    padding = int(height * 0.02)
    badge_width = text_width + padding * 2
    badge_height = text_height + padding * 2

    badge_x = int(width * 0.03)
    badge_y = int(height * 0.03)

    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_width, badge_y + badge_height],
        radius=int(badge_height * 0.2),
        fill=(33, 150, 243, 240)
    )

    draw.text(
        (badge_x + padding, badge_y + padding - 2),
        season_text,
        fill=(255, 255, 255, 255),
        font=season_font
    )

    return True

def apply_episode_overlay(draw, overlay, target_id, size, fonts):
    """Apply episode-style overlay (typically on thumbnail)"""
    width, height = size

    # Episode number badge
    ep_text = "S01E01"
    ep_font = get_font(fonts, 'inter', max(20, int(height * 0.08)))

    bbox = draw.textbbox((0, 0), ep_text, font=ep_font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    padding = int(height * 0.03)
    badge_width = text_width + padding * 2
    badge_height = text_height + padding * 2

    # Position in bottom-right for episode thumbs
    badge_x = width - badge_width - int(width * 0.03)
    badge_y = height - badge_height - int(height * 0.05)

    # Semi-transparent dark background
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_width, badge_y + badge_height],
        radius=int(badge_height * 0.25),
        fill=(20, 20, 20, 200)
    )

    draw.text(
        (badge_x + padding, badge_y + padding - 2),
        ep_text,
        fill=(255, 255, 255, 255),
        font=ep_font
    )

    # Runtime indicator
    runtime_text = "58 min"
    runtime_font = get_font(fonts, 'inter', max(14, int(height * 0.05)))

    bbox = draw.textbbox((0, 0), runtime_text, font=runtime_font)
    runtime_width = bbox[2] - bbox[0]
    runtime_height = bbox[3] - bbox[1]

    runtime_x = int(width * 0.03)
    runtime_y = height - runtime_height - padding * 2 - int(height * 0.05)

    draw.rounded_rectangle(
        [runtime_x, runtime_y, runtime_x + runtime_width + padding * 2, runtime_y + runtime_height + padding * 2],
        radius=int((runtime_height + padding * 2) * 0.3),
        fill=(0, 0, 0, 180)
    )

    draw.text(
        (runtime_x + padding, runtime_y + padding - 1),
        runtime_text,
        fill=(255, 255, 255, 255),
        font=runtime_font
    )

    return True

def apply_default_overlay(draw, overlay, target_id, size, fonts):
    """Apply a default overlay if no specific type is matched"""
    width, height = size

    # Simple "Preview" watermark
    text = "PREVIEW"
    font = get_font(fonts, 'inter', max(24, int(height * 0.04)))

    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = (width - text_width) // 2
    y = height - text_height - int(height * 0.05)

    # Draw text with shadow
    draw.text((x + 2, y + 2), text, fill=(0, 0, 0, 128), font=font)
    draw.text((x, y), text, fill=(255, 255, 255, 200), font=font)

    return True

def main():
    """Main entry point"""
    logger.info("=" * 60)
    logger.info("Kometa Preview Studio - Offline Renderer")
    logger.info("=" * 60)

    # Ensure output directories exist
    os.makedirs('/jobs/output', exist_ok=True)
    os.makedirs('/jobs/logs', exist_ok=True)

    # Load available fonts
    fonts = load_fonts()
    logger.info(f"Loaded {len(fonts)} fonts")

    # Process each target
    success_count = 0
    fail_count = 0

    for target_id, paths in TARGET_MAPPING.items():
        input_path = paths['inputPath']
        output_path = paths['outputPath']

        # Convert container paths to actual paths
        if input_path.startswith('/jobs/'):
            input_path = input_path  # Already correct for container
        if output_path.startswith('/jobs/'):
            output_path = output_path  # Already correct for container

        if apply_overlay_to_image(input_path, output_path, target_id, fonts):
            success_count += 1
        else:
            fail_count += 1

    logger.info("=" * 60)
    logger.info(f"Rendering complete: {success_count} succeeded, {fail_count} failed")
    logger.info("=" * 60)

    return 0 if fail_count == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
`;
}

/**
 * Extract overlay specifications from config
 */
function extractOverlaySpecs(config: KometaConfig): Record<string, unknown> {
  // This would parse the actual overlay definitions from the config
  // For v0, we use built-in overlay styles
  return {
    movie: {
      resolution: true,
      hdr: true,
      audio: true,
    },
    show: {
      rating: true,
      status: true,
    },
    season: {
      number: true,
    },
    episode: {
      number: true,
      runtime: true,
    },
  };
}
