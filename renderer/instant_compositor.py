#!/usr/bin/env python3
"""
Instant Overlay Compositor

Creates draft preview images in ~2 seconds using hardcoded metadata.
These are shown immediately while Kometa runs in the background for accurate results.

Uses Pillow to composite overlay badge images onto posters based on metadata.
"""

import sys
import os
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


# Standard poster dimensions (Plex uses 1000x1500 for posters)
POSTER_WIDTH = 1000
POSTER_HEIGHT = 1500

# Overlay positioning constants
BADGE_PADDING = 15
BADGE_HEIGHT = 105
BADGE_WIDTH = 305


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

    # Try to load a font, fall back to default
    try:
        # Try common font paths
        font_paths = [
            '/fonts/Inter-Regular.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/TTF/DejaVuSans.ttf',
        ]
        font = None
        for fp in font_paths:
            if Path(fp).exists():
                font = ImageFont.truetype(fp, font_size)
                break
        if font is None:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

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
    """Create a corner ribbon overlay."""
    # For now, create a simple "IMDB TOP 250" style ribbon
    if ribbon_type == 'imdb_top_250':
        ribbon = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
        draw = ImageDraw.Draw(ribbon)

        # Draw diagonal ribbon
        draw.polygon([(0, 0), (200, 0), (200, 50), (50, 200), (0, 200)], fill=(255, 215, 0, 230))

        # Add text rotated 45 degrees - simplified version
        try:
            font = ImageFont.load_default()
            draw.text((60, 20), "TOP", fill='#000000', font=font)
            draw.text((90, 35), "250", fill='#000000', font=font)
        except Exception:
            pass

        return ribbon

    return None


def composite_overlays(
    input_path: Path,
    output_path: Path,
    metadata: Dict[str, Any],
    target_type: str
) -> bool:
    """
    Composite overlay badges onto a poster image.

    Args:
        input_path: Path to input poster image
        output_path: Path for output image
        metadata: Preview metadata dict
        target_type: Type of item (movie, show, season, episode)

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

        # Resolution badge (top-left)
        if metadata.get('resolution'):
            badge = create_resolution_badge(metadata['resolution'])
            img.paste(badge, (BADGE_PADDING, top_left_y), badge)
            top_left_y += BADGE_HEIGHT + 5

        # Audio codec badge (below resolution)
        if metadata.get('audioCodec'):
            badge = create_audio_badge(metadata['audioCodec'])
            img.paste(badge, (BADGE_PADDING, top_left_y), badge)
            top_left_y += BADGE_HEIGHT + 5

        # HDR/DV badge (below audio)
        hdr_badge = create_hdr_badge(
            metadata.get('hdr', False),
            metadata.get('dolbyVision', False)
        )
        if hdr_badge:
            img.paste(hdr_badge, (BADGE_PADDING, top_left_y), hdr_badge)
            top_left_y += BADGE_HEIGHT + 5

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


def run_instant_preview(job_path: Path) -> int:
    """
    Run instant preview compositor for all targets.

    Args:
        job_path: Path to job directory

    Returns:
        Exit code (0 for success)
    """
    print("=" * 60)
    print("Instant Preview Compositor")
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

    print(f"\nProcessing {len(targets)} targets...")

    input_dir = job_path / 'input'
    output_dir = job_path / 'output'
    draft_dir = output_dir / 'draft'

    success_count = 0

    for target in targets:
        target_id = target.get('id', 'unknown')
        target_type = target.get('type', 'movie')
        title = target.get('title', target_id)
        metadata = target.get('metadata', {})

        print(f"\n[{target_id}] {title}")

        if not metadata:
            print("  No metadata - skipping draft overlay")
            continue

        # Input/output paths
        input_path = input_dir / f"{target_id}.jpg"
        output_path = draft_dir / f"{target_id}_draft.png"

        # NOTE: We no longer copy draft images to main output directory.
        # Only Kometa's actual rendered output should be shown to users to
        # ensure 100% accuracy. Draft images are saved to draft/ for debugging.

        if composite_overlays(input_path, output_path, metadata, target_type):
            success_count += 1

    print(f"\n{'=' * 60}")
    print(f"Draft preview complete: {success_count}/{len(targets)} images created")
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
