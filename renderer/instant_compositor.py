#!/usr/bin/env python3
"""
Instant Overlay Compositor - DRAFT PREVIEW ONLY

Creates draft preview images in ~0.5 seconds using hardcoded metadata.
These are shown immediately while Kometa runs in the background for accurate results.

This compositor now uses actual PNG overlay assets from Kometa's Default-Images
repository for production-quality previews. Text badges are used as fallbacks
when PNG assets are not available.

Supported overlay types using Kometa assets:
  - Resolution (4K, 1080p, etc.)
  - Audio Codec (Dolby Atmos, DTS-HD, etc.)
  - HDR / Dolby Vision
  - Streaming services (Netflix, Max, Disney+, etc.)
  - TV Networks (AMC, HBO, etc.)
  - Studios (Warner Bros., Legendary, etc.)
  - Ratings (IMDb, TMDb, RT)
  - Ribbons (IMDb Top 250, etc.)
  - Status (TV show status)

Uses Pillow to composite overlay badge images onto posters based on metadata.

Performance optimizations:
- Asset caching: PNG overlays are downloaded once and cached
- Font caching: Fonts are loaded once and reused across all badge creations
- Parallel processing: Multiple targets are composited simultaneously
- Pre-sized images: Input images can be pre-processed to standard size
"""

import sys
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import json

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("ERROR: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

try:
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    yaml_parser.preserve_quotes = True
except ImportError:
    import yaml as yaml_parser

# Import overlay asset manager
try:
    from overlay_assets import (
        get_streaming_asset,
        get_network_asset,
        get_studio_asset,
        get_resolution_asset,
        get_audio_codec_asset,
        get_hdr_asset,
        get_ribbon_asset,
        get_rating_source_asset,
        preload_common_assets,
    )
    HAS_OVERLAY_ASSETS = True
except ImportError:
    print("Warning: overlay_assets module not available, using text fallbacks")
    HAS_OVERLAY_ASSETS = False

from io import BytesIO


# Standard poster dimensions (Plex uses 1000x1500 for posters)
POSTER_WIDTH = 1000
POSTER_HEIGHT = 1500

# Overlay positioning constants
BADGE_PADDING = 15
BADGE_HEIGHT = 105
BADGE_WIDTH = 305

# Parallelization settings
MAX_COMPOSITE_WORKERS = 4

# ============================================================================
# Font Caching - Avoid repeated font loading (saves ~150-250ms)
# ============================================================================
_font_cache: Dict[int, ImageFont.FreeTypeFont] = {}
_font_paths = [
    '/fonts/Inter-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans.ttf',
]


def _get_cached_font(font_size: int = 40) -> ImageFont.FreeTypeFont:
    """
    Get a cached font instance for the given size.

    Fonts are expensive to load from disk. This function caches fonts
    by size to avoid repeated loading across badge creations.
    """
    if font_size in _font_cache:
        return _font_cache[font_size]

    font = None
    try:
        for fp in _font_paths:
            if Path(fp).exists():
                font = ImageFont.truetype(fp, font_size)
                break
    except Exception:
        pass

    if font is None:
        font = ImageFont.load_default()

    _font_cache[font_size] = font
    return font


# ============================================================================
# Image Pre-processing - Pre-resize images to standard size (saves ~200-400ms)
# ============================================================================
def preprocess_input_images(job_path: Path) -> int:
    """
    Pre-process all input images to standard poster size.

    This avoids repeated LANCZOS resizing during compositing, which is
    expensive. Pre-processed images are cached in input_cached/ directory.

    Args:
        job_path: Path to job directory

    Returns:
        Number of images processed
    """
    input_dir = job_path / 'input'
    cached_dir = job_path / 'input_cached'
    cached_dir.mkdir(parents=True, exist_ok=True)

    processed = 0
    for img_file in input_dir.glob('*.jpg'):
        cached_file = cached_dir / img_file.name

        # Skip if already cached
        if cached_file.exists():
            # Check if source is newer than cache
            if img_file.stat().st_mtime <= cached_file.stat().st_mtime:
                continue

        try:
            img = Image.open(img_file)
            if img.size != (POSTER_WIDTH, POSTER_HEIGHT):
                img = img.resize(
                    (POSTER_WIDTH, POSTER_HEIGHT),
                    Image.Resampling.LANCZOS
                )
            # Save as PNG for better quality in compositing
            img.save(cached_file.with_suffix('.png'), 'PNG')
            processed += 1
        except Exception as e:
            print(f"Warning: Failed to preprocess {img_file.name}: {e}")

    return processed


def get_input_image_path(job_path: Path, target_id: str) -> Path:
    """
    Get the best input image path for a target.

    Prefers pre-processed cached images over raw input.
    """
    cached_dir = job_path / 'input_cached'
    cached_path = cached_dir / f"{target_id}.png"

    if cached_path.exists():
        return cached_path

    # Fall back to original input
    return job_path / 'input' / f"{target_id}.jpg"


def load_preview_config(job_path: Path) -> Dict[str, Any]:
    """Load preview.yml from job directory."""
    config_path = job_path / 'config' / 'preview.yml'
    if not config_path.exists():
        raise FileNotFoundError(f"Preview config not found: {config_path}")

    with open(config_path, 'r') as f:
        if hasattr(yaml_parser, 'load'):
            return dict(yaml_parser.load(f) or {})
        else:
            return yaml_parser.safe_load(f) or {}


def create_badge(
    text: str,
    width: int = BADGE_WIDTH,
    height: int = BADGE_HEIGHT,
    bg_color: str = "#000000",
    bg_alpha: int = 153,  # 60% opacity
    text_color: str = "#FFFFFF",
    font_size: int = 40
) -> Image.Image:
    """
    Create a simple text badge overlay.

    Returns an RGBA image that can be composited onto posters.
    """
    # Create badge with alpha channel
    badge = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge)

    # Draw semi-transparent background
    r, g, b = int(bg_color[1:3], 16), int(bg_color[3:5], 16), int(bg_color[5:7], 16)
    draw.rectangle([(0, 0), (width, height)], fill=(r, g, b, bg_alpha))

    # Get cached font (avoids repeated disk I/O)
    font = _get_cached_font(font_size)

    # Center text in badge
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    x = (width - text_width) // 2
    y = (height - text_height) // 2

    draw.text((x, y), text, fill=text_color, font=font)

    return badge


def create_resolution_badge(resolution: str) -> Image.Image:
    """Create a resolution badge (4K, 1080p, etc.)."""
    resolution_colors = {
        '4K': '#FFD700',      # Gold for 4K
        '4k': '#FFD700',
        '1080p': '#4CAF50',   # Green for 1080p
        '1080': '#4CAF50',
        '720p': '#2196F3',    # Blue for 720p
        '720': '#2196F3',
        '480p': '#9E9E9E',    # Gray for SD
        '480': '#9E9E9E',
    }

    text_color = resolution_colors.get(resolution, '#FFFFFF')
    display_text = resolution.upper() if resolution.lower() in ['4k'] else resolution

    return create_badge(display_text, text_color=text_color, font_size=50)


def create_audio_badge(audio_codec: str) -> Image.Image:
    """Create an audio codec badge."""
    # Map codec names to display text
    codec_display = {
        'Dolby Atmos': 'ATMOS',
        'TrueHD': 'TrueHD',
        'DTS-HD MA': 'DTS-HD',
        'DTS-HD': 'DTS-HD',
        'DTS': 'DTS',
        'AAC': 'AAC',
        'AC3': 'AC3',
        'EAC3': 'EAC3',
        'FLAC': 'FLAC',
    }

    display_text = codec_display.get(audio_codec, audio_codec.upper())
    return create_badge(display_text, font_size=40)


def create_hdr_badge(hdr: bool = False, dolby_vision: bool = False) -> Optional[Image.Image]:
    """Create HDR/Dolby Vision badge."""
    if dolby_vision:
        return create_badge('DV HDR', bg_color='#000000', text_color='#00D4AA', font_size=45)
    elif hdr:
        return create_badge('HDR', bg_color='#000000', text_color='#FFD700', font_size=50)
    return None


def create_status_badge(status: str) -> Image.Image:
    """Create show status badge."""
    status_colors = {
        'returning': '#81007F',  # Purple
        'ended': '#000847',      # Dark blue
        'canceled': '#B52222',   # Red
        'airing': '#016920',     # Green
    }

    status_text = {
        'returning': 'RETURNING',
        'ended': 'ENDED',
        'canceled': 'CANCELED',
        'airing': 'AIRING',
    }

    bg_color = status_colors.get(status, '#000000')
    text = status_text.get(status, status.upper())

    # Status badges are wider and centered at top
    return create_badge(text, width=400, height=85, bg_color=bg_color, bg_alpha=255, font_size=45)


def create_ribbon(ribbon_type: str) -> Optional[Image.Image]:
    """
    Create a corner ribbon overlay for bottom-right positioning.

    Kometa's default ribbon position is bottom-right corner.
    The ribbon diagonal goes from top-left of the ribbon image
    toward bottom-right, creating a "fold" effect in the corner.
    """
    # Try to load PNG asset first
    if HAS_OVERLAY_ASSETS:
        asset_data = get_ribbon_asset(ribbon_type)
        if asset_data:
            return load_png_overlay(asset_data, max_width=300, max_height=300)

    # Ribbon configurations for different types
    ribbon_configs = {
        'imdb_top_250': {
            'color': (245, 197, 24, 240),  # IMDb gold
            'text': 'IMDb\nTOP 250',
            'text_color': '#000000',
        },
        'imdb_lowest': {
            'color': (139, 0, 0, 240),  # Dark red
            'text': 'IMDb\nLOWEST',
            'text_color': '#FFFFFF',
        },
        'rt_certified_fresh': {
            'color': (250, 50, 10, 240),  # RT red
            'text': 'CERTIFIED\nFRESH',
            'text_color': '#FFFFFF',
        },
        'common_sense': {
            'color': (0, 166, 81, 240),  # Green
            'text': 'COMMON\nSENSE',
            'text_color': '#FFFFFF',
        },
    }

    config = ribbon_configs.get(ribbon_type)
    if not config:
        return None

    # Create ribbon image (designed for bottom-right corner placement)
    size = 200
    ribbon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(ribbon)

    # Draw diagonal ribbon band - goes from top-left corner to bottom-right
    # This creates a triangular ribbon that "wraps" around the bottom-right corner
    band_width = 50
    # Points for a diagonal band from top-left to bottom-right of the square
    points = [
        (0, size - band_width * 2),  # Left edge, upper point
        (band_width * 2, size),       # Bottom edge, left point
        (size, size),                 # Bottom-right corner
        (size, size - band_width * 2), # Right edge
        (size - band_width * 2, 0),   # Top edge, right point
        (0, 0),                       # Top-left corner (optional for full triangle)
    ]
    # Simplified diagonal band
    band_points = [
        (0, size - band_width * 2.5),
        (0, size),
        (size, size),
        (size, 0),
        (size - band_width * 2.5, 0),
    ]
    draw.polygon(band_points, fill=config['color'])

    # Add text along the diagonal
    try:
        font = _get_cached_font(18)
        text_lines = config['text'].split('\n')

        # Position text along the diagonal (rotated -45 degrees conceptually)
        # Since we can't easily rotate text, position it to fit the diagonal
        if len(text_lines) == 2:
            # First line - upper part of diagonal
            draw.text((size - 85, 25), text_lines[0], fill=config['text_color'], font=font)
            # Second line - lower part
            draw.text((size - 65, 45), text_lines[1], fill=config['text_color'], font=font)
        else:
            draw.text((size - 80, 35), config['text'], fill=config['text_color'], font=font)
    except Exception:
        pass

    return ribbon


# ============================================================================
# PNG Overlay Loading and Compositing
# ============================================================================

def load_png_overlay(
    png_data: bytes,
    max_width: int = 300,
    max_height: int = 150,
    scale: float = 1.0
) -> Optional[Image.Image]:
    """
    Load a PNG overlay from bytes and resize it for compositing.

    Args:
        png_data: Raw PNG image data
        max_width: Maximum width for the overlay
        max_height: Maximum height for the overlay
        scale: Additional scaling factor

    Returns:
        RGBA Image ready for compositing, or None if loading fails
    """
    try:
        img = Image.open(BytesIO(png_data))
        img = img.convert('RGBA')

        # Scale down if needed while maintaining aspect ratio
        orig_width, orig_height = img.size
        target_width = int(max_width * scale)
        target_height = int(max_height * scale)

        # Calculate scaling to fit within bounds
        width_ratio = target_width / orig_width
        height_ratio = target_height / orig_height
        ratio = min(width_ratio, height_ratio, 1.0)  # Don't scale up

        if ratio < 1.0:
            new_width = int(orig_width * ratio)
            new_height = int(orig_height * ratio)
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

        return img

    except Exception as e:
        print(f"Error loading PNG overlay: {e}")
        return None


def create_streaming_overlay(services: List[str]) -> Optional[Image.Image]:
    """
    Create a streaming services overlay with service logos.

    Args:
        services: List of streaming service names

    Returns:
        Composite image with streaming service logos or text badges
    """
    if not services:
        return None

    # Try PNG assets first if available
    if HAS_OVERLAY_ASSETS:
        logos = []
        for service in services[:3]:  # Limit to 3 services
            asset_data = get_streaming_asset(service)
            if asset_data:
                logo = load_png_overlay(asset_data, max_width=100, max_height=50)
                if logo:
                    logos.append(logo)

        if logos:
            # Stack logos horizontally
            total_width = sum(logo.width for logo in logos) + (len(logos) - 1) * 5
            max_height_val = max(logo.height for logo in logos)

            result = Image.new('RGBA', (total_width, max_height_val), (0, 0, 0, 0))

            x = 0
            for logo in logos:
                y = (max_height_val - logo.height) // 2
                result.paste(logo, (x, y), logo)
                x += logo.width + 5

            return result

    # Fallback to text badges when PNG assets not available
    badges = []
    for service in services[:3]:
        display_name = service.upper().replace('_', ' ')[:12]  # Truncate long names
        badge = create_badge(display_name, width=120, height=40, font_size=24)
        badges.append(badge)

    if not badges:
        return None

    # Stack text badges horizontally
    total_width = sum(b.width for b in badges) + (len(badges) - 1) * 5
    max_height_val = max(b.height for b in badges)

    result = Image.new('RGBA', (total_width, max_height_val), (0, 0, 0, 0))

    x = 0
    for badge in badges:
        y = (max_height_val - badge.height) // 2
        result.paste(badge, (x, y), badge)
        x += badge.width + 5

    return result


def create_network_overlay(network: str) -> Optional[Image.Image]:
    """
    Create a network overlay with the network logo.

    Args:
        network: Network name

    Returns:
        Network logo image or text fallback
    """
    if not network:
        return None

    if HAS_OVERLAY_ASSETS:
        asset_data = get_network_asset(network)
        if asset_data:
            return load_png_overlay(asset_data, max_width=200, max_height=80)

    # Fallback to text badge
    return create_badge(network.upper(), width=200, height=60, font_size=35)


def create_studio_overlay(studio: str) -> Optional[Image.Image]:
    """
    Create a studio overlay with the studio logo.

    Args:
        studio: Studio name

    Returns:
        Studio logo image or text fallback
    """
    if not studio:
        return None

    if HAS_OVERLAY_ASSETS:
        asset_data = get_studio_asset(studio)
        if asset_data:
            return load_png_overlay(asset_data, max_width=250, max_height=100)

    # Fallback to text badge
    return create_badge(studio[:20], width=250, height=60, font_size=30)


def create_ratings_overlay(
    imdb_rating: Optional[float] = None,
    tmdb_rating: Optional[float] = None,
    rt_rating: Optional[int] = None
) -> Optional[Image.Image]:
    """
    Create a ratings overlay showing rating sources and values.

    Creates a horizontal bar with rating source logos and their values.

    Args:
        imdb_rating: IMDb rating (0-10)
        tmdb_rating: TMDb rating (0-10)
        rt_rating: Rotten Tomatoes score (0-100)

    Returns:
        Composite ratings image
    """
    ratings = []
    if imdb_rating is not None:
        ratings.append(('imdb', f"{imdb_rating:.1f}"))
    if tmdb_rating is not None:
        ratings.append(('tmdb', f"{tmdb_rating:.1f}"))
    if rt_rating is not None:
        ratings.append(('rt_critics', f"{rt_rating}%"))

    if not ratings:
        return None

    # Create individual rating badges
    badges = []
    for source, value in ratings[:3]:  # Limit to 3 ratings
        badge = _create_single_rating_badge(source, value)
        if badge:
            badges.append(badge)

    if not badges:
        return None

    # Stack badges horizontally
    total_width = sum(b.width for b in badges) + (len(badges) - 1) * 10
    max_height = max(b.height for b in badges)

    result = Image.new('RGBA', (total_width, max_height), (0, 0, 0, 0))

    x = 0
    for badge in badges:
        y = (max_height - badge.height) // 2
        result.paste(badge, (x, y), badge)
        x += badge.width + 10

    return result


def _create_single_rating_badge(source: str, value: str) -> Optional[Image.Image]:
    """Create a single rating badge with logo and value."""
    # Try to get the source logo
    logo = None
    if HAS_OVERLAY_ASSETS:
        asset_data = get_rating_source_asset(source)
        if asset_data:
            logo = load_png_overlay(asset_data, max_width=40, max_height=40)

    # Create badge background
    badge_width = 100 if logo else 80
    badge_height = 50
    badge = Image.new('RGBA', (badge_width, badge_height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge)

    # Draw semi-transparent background
    draw.rectangle([(0, 0), (badge_width, badge_height)], fill=(0, 0, 0, 153))

    # Add logo if available
    x_offset = 5
    if logo:
        logo_y = (badge_height - logo.height) // 2
        badge.paste(logo, (5, logo_y), logo)
        x_offset = logo.width + 10

    # Add rating value text
    font = _get_cached_font(24)
    text_bbox = draw.textbbox((0, 0), value, font=font)
    text_height = text_bbox[3] - text_bbox[1]
    text_y = (badge_height - text_height) // 2
    draw.text((x_offset, text_y), value, fill='#FFFFFF', font=font)

    return badge


def create_resolution_overlay_png(resolution: str) -> Optional[Image.Image]:
    """
    Create a resolution overlay using PNG asset.

    Args:
        resolution: Resolution string (4K, 1080p, etc.)

    Returns:
        Resolution overlay image
    """
    if not resolution:
        return None

    if HAS_OVERLAY_ASSETS:
        asset_data = get_resolution_asset(resolution)
        if asset_data:
            return load_png_overlay(asset_data, max_width=200, max_height=80)

    # Fallback to existing text badge
    return create_resolution_badge(resolution)


def create_audio_overlay_png(audio_codec: str) -> Optional[Image.Image]:
    """
    Create an audio codec overlay using PNG asset.

    Args:
        audio_codec: Audio codec name

    Returns:
        Audio codec overlay image
    """
    if not audio_codec:
        return None

    if HAS_OVERLAY_ASSETS:
        asset_data = get_audio_codec_asset(audio_codec)
        if asset_data:
            return load_png_overlay(asset_data, max_width=200, max_height=80)

    # Fallback to existing text badge
    return create_audio_badge(audio_codec)


def create_hdr_overlay_png(hdr: bool = False, dolby_vision: bool = False) -> Optional[Image.Image]:
    """
    Create an HDR/Dolby Vision overlay using PNG asset.

    Args:
        hdr: Whether content is HDR
        dolby_vision: Whether content is Dolby Vision

    Returns:
        HDR overlay image
    """
    if not hdr and not dolby_vision:
        return None

    if HAS_OVERLAY_ASSETS:
        if dolby_vision:
            asset_data = get_hdr_asset('dolby_vision')
        else:
            asset_data = get_hdr_asset('hdr')

        if asset_data:
            return load_png_overlay(asset_data, max_width=200, max_height=80)

    # Fallback to existing text badge
    return create_hdr_badge(hdr, dolby_vision)


def composite_overlays(
    input_path: Path,
    output_path: Path,
    metadata: Dict[str, Any],
    target_type: str,
    use_png_assets: bool = True
) -> bool:
    """
    Composite overlay badges onto a poster image.

    Args:
        input_path: Path to input poster image
        output_path: Path for output image
        metadata: Preview metadata dict
        target_type: Type of item (movie, show, season, episode)
        use_png_assets: Whether to use PNG assets from Kometa (default: True)

    Returns:
        True if successful, False otherwise
    """
    try:
        # Load input image
        if not input_path.exists():
            print(f"  Input not found: {input_path}")
            return False

        img = Image.open(input_path).convert('RGBA')

        # Scale to standard poster size if needed
        if img.size != (POSTER_WIDTH, POSTER_HEIGHT):
            img = img.resize((POSTER_WIDTH, POSTER_HEIGHT), Image.Resampling.LANCZOS)

        # Track vertical positions for stacking badges
        top_left_y = BADGE_PADDING
        top_right_y = BADGE_PADDING
        bottom_left_y = POSTER_HEIGHT - BADGE_HEIGHT - BADGE_PADDING
        bottom_right_y = POSTER_HEIGHT - BADGE_HEIGHT - BADGE_PADDING

        # Resolution badge (top-left)
        if metadata.get('resolution'):
            if use_png_assets:
                badge = create_resolution_overlay_png(metadata['resolution'])
            else:
                badge = create_resolution_badge(metadata['resolution'])
            if badge:
                img.paste(badge, (BADGE_PADDING, top_left_y), badge)
                top_left_y += badge.height + 5

        # Audio codec badge (below resolution)
        if metadata.get('audioCodec'):
            if use_png_assets:
                badge = create_audio_overlay_png(metadata['audioCodec'])
            else:
                badge = create_audio_badge(metadata['audioCodec'])
            if badge:
                img.paste(badge, (BADGE_PADDING, top_left_y), badge)
                top_left_y += badge.height + 5

        # HDR/DV badge (below audio)
        if use_png_assets:
            hdr_badge = create_hdr_overlay_png(
                metadata.get('hdr', False),
                metadata.get('dolbyVision', False)
            )
        else:
            hdr_badge = create_hdr_badge(
                metadata.get('hdr', False),
                metadata.get('dolbyVision', False)
            )
        if hdr_badge:
            img.paste(hdr_badge, (BADGE_PADDING, top_left_y), hdr_badge)
            top_left_y += hdr_badge.height + 5

        # Streaming services (top-right)
        if metadata.get('streaming'):
            streaming_overlay = create_streaming_overlay(metadata['streaming'])
            if streaming_overlay:
                x = POSTER_WIDTH - streaming_overlay.width - BADGE_PADDING
                img.paste(streaming_overlay, (x, top_right_y), streaming_overlay)
                top_right_y += streaming_overlay.height + 5

        # Network (below streaming, top-right)
        if metadata.get('network'):
            network_overlay = create_network_overlay(metadata['network'])
            if network_overlay:
                x = POSTER_WIDTH - network_overlay.width - BADGE_PADDING
                img.paste(network_overlay, (x, top_right_y), network_overlay)
                top_right_y += network_overlay.height + 5

        # Studio (below network, top-right)
        if metadata.get('studio'):
            studio_overlay = create_studio_overlay(metadata['studio'])
            if studio_overlay:
                x = POSTER_WIDTH - studio_overlay.width - BADGE_PADDING
                img.paste(studio_overlay, (x, top_right_y), studio_overlay)
                top_right_y += studio_overlay.height + 5

        # Ratings (bottom-left)
        if any(metadata.get(k) for k in ['imdbRating', 'tmdbRating', 'rtRating']):
            ratings_overlay = create_ratings_overlay(
                imdb_rating=metadata.get('imdbRating'),
                tmdb_rating=metadata.get('tmdbRating'),
                rt_rating=metadata.get('rtRating')
            )
            if ratings_overlay:
                img.paste(ratings_overlay, (BADGE_PADDING, bottom_left_y), ratings_overlay)

        # Status badge for shows (top center)
        if target_type == 'show' and metadata.get('status'):
            badge = create_status_badge(metadata['status'])
            x = (POSTER_WIDTH - badge.width) // 2
            img.paste(badge, (x, 0), badge)

        # Ribbon (bottom-right corner)
        if metadata.get('ribbon'):
            ribbon = create_ribbon(metadata['ribbon'])
            if ribbon:
                # Position at bottom-right
                x = POSTER_WIDTH - ribbon.width
                y = POSTER_HEIGHT - ribbon.height
                img.paste(ribbon, (x, y), ribbon)

        # Convert to RGB for PNG output (or keep RGBA)
        img = img.convert('RGB')

        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Save output
        img.save(output_path, 'PNG', quality=95)
        print(f"  Created draft: {output_path.name}")

        return True

    except Exception as e:
        print(f"  Error compositing {input_path.name}: {e}")
        return False


def _composite_target(
    target: Dict[str, Any],
    job_path: Path,
    draft_dir: Path
) -> Tuple[str, bool]:
    """
    Composite a single target (used for parallel processing).

    Returns:
        Tuple of (target_id, success)
    """
    target_id = target.get('id', 'unknown')
    target_type = target.get('type', 'movie')
    metadata = target.get('metadata', {})

    if not metadata:
        return (target_id, False)

    # Use pre-processed image if available
    input_path = get_input_image_path(job_path, target_id)
    output_path = draft_dir / f"{target_id}_draft.png"

    success = composite_overlays(input_path, output_path, metadata, target_type)
    return (target_id, success)


def run_manual_preview(
    job_path: Path,
    manual_overlays: Dict[str, Any]
) -> int:
    """
    Run manual preview compositor with user-selected overlays.

    This function creates overlays based on explicit user selections,
    not the full metadata. It only applies overlays that the user
    has explicitly enabled in the UI.

    Args:
        job_path: Path to job directory
        manual_overlays: Dict of overlay selections from ManualBuilderConfig
            - resolution: bool
            - audio_codec: bool
            - hdr: bool
            - ratings: bool
            - streaming: bool
            - network: bool
            - studio: bool
            - status: bool
            - ribbon: { imdb_top_250: bool, ... }

    Returns:
        Exit code (0 for success)
    """
    print("=" * 60)
    print("Manual Preview Compositor (with PNG assets)")
    print("Creating overlays based on user selections...")
    print("=" * 60)

    try:
        config = load_preview_config(job_path)
    except Exception as e:
        print(f"ERROR: Failed to load config: {e}")
        return 1

    preview = config.get('preview', {})
    targets = preview.get('targets', [])

    if not targets:
        print("No preview targets found")
        return 1

    output_dir = job_path / 'output'
    draft_dir = output_dir / 'draft'
    draft_dir.mkdir(parents=True, exist_ok=True)

    # Pre-warm font cache
    for size in [24, 40, 45, 50]:
        _get_cached_font(size)

    # Preload common PNG assets for faster rendering
    if HAS_OVERLAY_ASSETS:
        print("Preloading overlay assets from Kometa Default-Images...")
        preload_common_assets()

    # Pre-process input images
    preprocessed = preprocess_input_images(job_path)
    if preprocessed > 0:
        print(f"Pre-processed {preprocessed} input images")

    # Filter targets with metadata
    valid_targets = [t for t in targets if t.get('metadata')]
    print(f"Processing {len(valid_targets)} targets with manual overlay selections...")

    # Log enabled overlays
    enabled_overlays = [k for k, v in manual_overlays.items() if v and k != 'ribbon']
    ribbon_config = manual_overlays.get('ribbon', {})
    enabled_ribbons = [k for k, v in ribbon_config.items() if v] if isinstance(ribbon_config, dict) else []
    print(f"Enabled overlays: {enabled_overlays}")
    if enabled_ribbons:
        print(f"Enabled ribbons: {enabled_ribbons}")

    success_count = 0

    # Process targets with filtered metadata
    with ThreadPoolExecutor(max_workers=MAX_COMPOSITE_WORKERS) as executor:
        futures = {
            executor.submit(
                _composite_manual_target,
                target,
                job_path,
                draft_dir,
                manual_overlays
            ): target
            for target in valid_targets
        }

        for future in as_completed(futures):
            target = futures[future]
            target_id = target.get('id', 'unknown')
            title = target.get('title', target_id)

            try:
                tid, success = future.result()
                if success:
                    success_count += 1
                    print(f"  [OK] {title}")
                else:
                    print(f"  [FAIL] {title}")
            except Exception as e:
                print(f"  [ERROR] {title}: {e}")

    print(f"\n{'=' * 60}")
    print(f"Manual preview complete: {success_count}/{len(valid_targets)} images created")
    print("=" * 60)

    return 0 if success_count > 0 else 1


def _composite_manual_target(
    target: Dict[str, Any],
    job_path: Path,
    draft_dir: Path,
    manual_overlays: Dict[str, Any]
) -> Tuple[str, bool]:
    """
    Composite a single target with manual overlay selections.

    Only applies overlays that are explicitly enabled in manual_overlays.
    """
    target_id = target.get('id', 'unknown')
    target_type = target.get('type', 'movie')
    metadata = target.get('metadata', {})

    if not metadata:
        return (target_id, False)

    # Filter metadata based on manual overlay selections
    filtered_metadata: Dict[str, Any] = {}

    # Resolution
    if manual_overlays.get('resolution') and metadata.get('resolution'):
        filtered_metadata['resolution'] = metadata['resolution']

    # Audio codec
    if manual_overlays.get('audio_codec') and metadata.get('audioCodec'):
        filtered_metadata['audioCodec'] = metadata['audioCodec']

    # HDR
    if manual_overlays.get('hdr'):
        if metadata.get('hdr'):
            filtered_metadata['hdr'] = metadata['hdr']
        if metadata.get('dolbyVision'):
            filtered_metadata['dolbyVision'] = metadata['dolbyVision']

    # Streaming services
    if manual_overlays.get('streaming') and metadata.get('streaming'):
        filtered_metadata['streaming'] = metadata['streaming']

    # Network (TV shows)
    if manual_overlays.get('network') and metadata.get('network'):
        filtered_metadata['network'] = metadata['network']

    # Studio
    if manual_overlays.get('studio') and metadata.get('studio'):
        filtered_metadata['studio'] = metadata['studio']

    # Ratings
    if manual_overlays.get('ratings'):
        if metadata.get('imdbRating'):
            filtered_metadata['imdbRating'] = metadata['imdbRating']
        if metadata.get('tmdbRating'):
            filtered_metadata['tmdbRating'] = metadata['tmdbRating']
        if metadata.get('rtRating'):
            filtered_metadata['rtRating'] = metadata['rtRating']

    # Status (TV shows only)
    if manual_overlays.get('status') and metadata.get('status'):
        filtered_metadata['status'] = metadata['status']

    # Ribbons
    ribbon_config = manual_overlays.get('ribbon', {})
    if isinstance(ribbon_config, dict):
        if ribbon_config.get('imdb_top_250') and metadata.get('ribbon') == 'imdb_top_250':
            filtered_metadata['ribbon'] = 'imdb_top_250'
        if ribbon_config.get('imdb_lowest') and metadata.get('ribbon') == 'imdb_lowest':
            filtered_metadata['ribbon'] = 'imdb_lowest'
        if ribbon_config.get('rt_certified_fresh') and metadata.get('ribbon') == 'rt_certified_fresh':
            filtered_metadata['ribbon'] = 'rt_certified_fresh'

    # If no overlays selected, create image without any badges
    input_path = get_input_image_path(job_path, target_id)
    output_path = draft_dir / f"{target_id}_draft.png"

    success = composite_overlays(input_path, output_path, filtered_metadata, target_type)
    return (target_id, success)


def run_instant_preview(job_path: Path) -> int:
    """
    Run instant preview compositor for all targets.

    Uses parallel processing to composite multiple targets simultaneously,
    reducing total time from ~2s to ~0.5s for 5 targets.

    Args:
        job_path: Path to job directory

    Returns:
        Exit code (0 for success)
    """
    print("=" * 60)
    print("Instant Preview Compositor (Parallel)")
    print("Creating draft overlays from hardcoded metadata...")
    print("=" * 60)

    try:
        config = load_preview_config(job_path)
    except Exception as e:
        print(f"ERROR: Failed to load config: {e}")
        return 1

    preview = config.get('preview', {})
    targets = preview.get('targets', [])

    if not targets:
        print("No preview targets found")
        return 1

    output_dir = job_path / 'output'
    draft_dir = output_dir / 'draft'
    draft_dir.mkdir(parents=True, exist_ok=True)

    # Pre-warm font cache with common sizes (avoids lock contention in threads)
    for size in [40, 45, 50]:
        _get_cached_font(size)

    # Pre-process input images to standard size (avoids repeated resizing)
    preprocessed = preprocess_input_images(job_path)
    if preprocessed > 0:
        print(f"Pre-processed {preprocessed} input images")

    # Filter targets with metadata
    valid_targets = [t for t in targets if t.get('metadata')]
    skipped = len(targets) - len(valid_targets)

    if skipped > 0:
        print(f"Skipping {skipped} targets without metadata")

    print(f"Processing {len(valid_targets)} targets in parallel "
          f"(max {MAX_COMPOSITE_WORKERS} workers)...")

    success_count = 0
    results: List[Tuple[str, bool]] = []

    # Process targets in parallel using ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=MAX_COMPOSITE_WORKERS) as executor:
        futures = {
            executor.submit(_composite_target, target, job_path, draft_dir): target
            for target in valid_targets
        }

        for future in as_completed(futures):
            target = futures[future]
            target_id = target.get('id', 'unknown')
            title = target.get('title', target_id)

            try:
                tid, success = future.result()
                results.append((tid, success))
                if success:
                    success_count += 1
                    print(f"  [OK] {title}")
                else:
                    print(f"  [FAIL] {title}")
            except Exception as e:
                print(f"  [ERROR] {title}: {e}")
                results.append((target_id, False))

    print(f"\n{'=' * 60}")
    print(f"Draft preview complete: {success_count}/{len(valid_targets)} images created")
    print("=" * 60)

    return 0 if success_count > 0 else 1


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Instant overlay compositor')
    parser.add_argument('--job', '-j', type=str, required=True,
                       help='Path to job directory')

    args = parser.parse_args()
    job_path = Path(args.job)

    if not job_path.exists():
        print(f"ERROR: Job path does not exist: {job_path}")
        sys.exit(1)

    exit_code = run_instant_preview(job_path)
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
