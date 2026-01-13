#!/usr/bin/env python3
"""
Kometa Preview Studio - Preview Renderer Entrypoint

This script runs inside the Kometa Docker container and uses Kometa's ACTUAL
internal overlay rendering modules to apply overlays to local images, producing
pixel-identical results to what Kometa would generate in a real library run.

The script operates in "offline preview mode":
- NO Plex connections or writes
- NO metadata updates
- Reads local images from /jobs/<jobId>/input/
- Writes rendered images to /jobs/<jobId>/output/
- Uses Kometa's real overlay YAML parsing and rendering

Usage:
    python3 preview_entrypoint.py --job /jobs/<jobId>
"""

import argparse
import json
import logging
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

# Configure logging before imports
logging.basicConfig(
    level=logging.INFO,
    format='| %(levelname)-8s | %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('KometaPreview')

# Add Kometa's module path
sys.path.insert(0, '/')

# ============================================================================
# Kometa Internal Module Imports
# ============================================================================
# These imports use Kometa's actual internal modules for pixel-identical rendering

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageColor
    logger.info("PIL/Pillow loaded successfully")
except ImportError as e:
    logger.error(f"Failed to import PIL: {e}")
    sys.exit(1)

# Import Kometa's overlay module
try:
    from modules.overlay import Overlay
    KOMETA_OVERLAY_AVAILABLE = True
    logger.info("Kometa Overlay module loaded successfully")
except ImportError as e:
    logger.warning(f"Could not import Kometa Overlay module: {e}")
    KOMETA_OVERLAY_AVAILABLE = False

# Import Kometa's utility modules
try:
    from modules import util
    KOMETA_UTIL_AVAILABLE = True
    logger.info("Kometa util module loaded successfully")
except ImportError as e:
    logger.warning(f"Could not import Kometa util module: {e}")
    KOMETA_UTIL_AVAILABLE = False

# Import Kometa's builder for overlay parsing
try:
    from modules.builder import CollectionBuilder
    KOMETA_BUILDER_AVAILABLE = True
    logger.info("Kometa builder module loaded successfully")
except ImportError as e:
    logger.warning(f"Could not import Kometa builder module: {e}")
    KOMETA_BUILDER_AVAILABLE = False

# Import YAML parser
try:
    import yaml
    from ruamel.yaml import YAML
    YAML_AVAILABLE = True
except ImportError:
    try:
        import yaml
        YAML_AVAILABLE = True
    except ImportError:
        YAML_AVAILABLE = False
        logger.warning("YAML parser not available")

# ============================================================================
# Constants - Kometa Standard Dimensions
# ============================================================================
POSTER_WIDTH = 1000
POSTER_HEIGHT = 1500
BACKGROUND_WIDTH = 1920
BACKGROUND_HEIGHT = 1080
SQUARE_WIDTH = 1000
SQUARE_HEIGHT = 1000

# Default fonts directory
FONTS_DIR = '/fonts'
KOMETA_FONTS_DIR = '/modules/fonts'
SYSTEM_FONTS_DIR = '/usr/share/fonts'


# ============================================================================
# Mock Objects for Kometa Internals
# ============================================================================

class MockConfig:
    """
    Mock configuration object that satisfies Kometa's Config interface.
    Provides font directories and other settings needed by the Overlay class.
    """

    def __init__(self, fonts_path: str = FONTS_DIR):
        self.fonts_path = fonts_path
        self.Cache = None
        self.TMDb = None
        self.OMDb = None
        self.Trakt = None
        self.MdbList = None
        self.AniDB = None
        self.MyAnimeList = None

        # Font directories - searched in order
        self.font_dirs = [
            Path(fonts_path),
            Path(KOMETA_FONTS_DIR),
            Path(SYSTEM_FONTS_DIR),
            Path('/root/.fonts'),
        ]

        # System fonts cache
        self._system_fonts = None

    def get_system_fonts(self) -> Dict[str, str]:
        """Get available system fonts - matches Kometa's util.get_system_fonts()"""
        if self._system_fonts is not None:
            return self._system_fonts

        fonts = {}
        for font_dir in self.font_dirs:
            if font_dir.exists():
                for font_file in font_dir.rglob('*.[tToO][tT][fF]'):
                    font_name = font_file.stem.lower()
                    if font_name not in fonts:  # First match wins
                        fonts[font_name] = str(font_file)

        # Ensure Roboto-Medium is available (Kometa default)
        roboto_path = Path(KOMETA_FONTS_DIR) / 'Roboto-Medium.ttf'
        if roboto_path.exists():
            fonts['roboto-medium'] = str(roboto_path)
            fonts['roboto'] = str(roboto_path)

        self._system_fonts = fonts
        logger.info(f"Loaded {len(fonts)} fonts")
        return fonts


class MockLibrary:
    """
    Mock library object that satisfies Kometa's Library interface.
    Provides overlay folder paths and canvas dimensions.
    """

    def __init__(self, output_dir: Path, is_movie: bool = True):
        self.output_dir = output_dir
        self.is_movie = is_movie
        self.is_show = not is_movie
        self.is_music = False
        self.overlay_folder = str(output_dir)
        self.overlays_folder = str(output_dir)
        self.overlay_backup = "Backup"

        # Queue coordinates for positioned overlays
        self.queues = {}

        # Overlay dimensions
        self.poster_width = POSTER_WIDTH
        self.poster_height = POSTER_HEIGHT
        self.background_width = BACKGROUND_WIDTH
        self.background_height = BACKGROUND_HEIGHT

    def get_poster_size(self) -> Tuple[int, int]:
        return (self.poster_width, self.poster_height)

    def get_background_size(self) -> Tuple[int, int]:
        return (self.background_width, self.background_height)


class MockItem:
    """
    Mock Plex item that satisfies the interface expected by Kometa's overlay code.
    Represents a local image file with associated metadata.
    """

    def __init__(self, item_id: str, item_type: str, title: str, metadata: Dict[str, Any]):
        # Core identifiers
        self.id = item_id
        self.ratingKey = item_id
        self.type = item_type
        self.title = title

        # Type flags
        self.isMovie = item_type == 'movie'
        self.isShow = item_type == 'show'
        self.isSeason = item_type == 'season'
        self.isEpisode = item_type == 'episode'
        self.isAlbum = item_type == 'album'
        self.isTrack = item_type == 'track'

        # Metadata
        self.year = metadata.get('year')
        self.rating = metadata.get('rating')
        self.audienceRating = metadata.get('audience_rating', metadata.get('rating'))
        self.contentRating = metadata.get('content_rating')
        self.studio = metadata.get('studio')
        self.originalTitle = metadata.get('original_title', title)
        self.originallyAvailableAt = metadata.get('originally_available_at')

        # Season/Episode info
        self.seasonNumber = metadata.get('season_index')
        self.index = metadata.get('episode_index')
        self.parentIndex = metadata.get('season_index')

        # Media info (resolution, audio, etc.)
        self.media = self._build_media(metadata)

        # Additional attributes Kometa might access
        self.duration = metadata.get('duration', 0)
        self.genres = metadata.get('genres', [])
        self.labels = []
        self.collections = []

        # Store raw metadata for template access
        self._metadata = metadata

    def _build_media(self, metadata: Dict[str, Any]) -> List[Any]:
        """Build mock media objects for resolution/audio overlays"""
        class MockMedia:
            def __init__(self, parts):
                self.parts = parts

        class MockPart:
            def __init__(self, streams):
                self.streams = streams

        class MockStream:
            def __init__(self, stream_type: int, data: Dict):
                self.streamType = stream_type
                self.__dict__.update(data)

        # Video stream (type 1)
        video_data = {
            'displayTitle': metadata.get('resolution', '1080p'),
            'videoResolution': metadata.get('resolution', '1080p').lower().replace('p', ''),
            'width': metadata.get('width', 1920),
            'height': metadata.get('height', 1080),
            'bitrate': metadata.get('bitrate', 0),
            'codec': metadata.get('video_codec', 'h264'),
            'DOVIPresent': metadata.get('dolby_vision', False),
            'colorSpace': metadata.get('hdr', False) and 'bt2020' or 'bt709',
        }

        # Audio stream (type 2)
        audio_data = {
            'displayTitle': metadata.get('audio_codec', 'AAC'),
            'audioChannelLayout': metadata.get('audio_channels', '5.1'),
            'codec': metadata.get('audio_codec', 'aac').lower(),
            'extendedDisplayTitle': metadata.get('audio_codec', 'AAC'),
        }

        video_stream = MockStream(1, video_data)
        audio_stream = MockStream(2, audio_data)

        return [MockMedia([MockPart([video_stream, audio_stream])])]

    def __repr__(self):
        return f"MockItem({self.id}, {self.type}, {self.title})"


class MockMetadataFile:
    """Mock metadata file for overlay initialization"""
    def __init__(self):
        self.set_images = []


# ============================================================================
# Overlay Configuration Loader
# ============================================================================

class OverlayConfigLoader:
    """
    Loads and parses overlay configuration from Kometa YAML format.
    Uses Kometa's actual parsing where possible.
    """

    def __init__(self, config_path: Path, config: MockConfig):
        self.config_path = config_path
        self.config = config
        self.overlays: Dict[str, Any] = {}
        self.templates: Dict[str, Any] = {}
        self.warnings: List[str] = []

    def load(self) -> Dict[str, Any]:
        """Load the overlay configuration file"""
        if not self.config_path.exists():
            logger.warning(f"Config file not found: {self.config_path}")
            return {}

        try:
            with open(self.config_path, 'r') as f:
                config_data = yaml.safe_load(f) or {}
        except Exception as e:
            logger.error(f"Failed to parse config YAML: {e}")
            return {}

        # Extract overlay definitions
        self.overlays = config_data.get('overlays', {})
        self.templates = config_data.get('templates', {})

        # Get preview targets
        preview_data = config_data.get('preview', {})
        targets = preview_data.get('targets', [])

        logger.info(f"Loaded config with {len(self.overlays)} overlay libraries, {len(targets)} preview targets")

        return config_data

    def get_overlays_for_type(self, item_type: str) -> List[Dict[str, Any]]:
        """
        Get overlay definitions applicable to a given item type.
        Parses overlay_files references and extracts individual overlay definitions.
        """
        overlays = []

        # Check each library's overlay files
        for lib_name, lib_config in self.overlays.items():
            if not isinstance(lib_config, dict):
                continue

            overlay_files = lib_config.get('overlay_files', [])
            if not overlay_files:
                continue

            # Parse each overlay file reference
            for overlay_ref in overlay_files:
                if isinstance(overlay_ref, dict):
                    # Inline overlay definition or file reference
                    if 'pmm' in overlay_ref:
                        # Default Kometa overlay
                        overlays.extend(self._load_default_overlay(overlay_ref['pmm'], item_type))
                    elif 'default' in overlay_ref:
                        # Default Kometa overlay (legacy key)
                        overlays.extend(self._load_default_overlay(overlay_ref['default'], item_type))
                    elif 'file' in overlay_ref:
                        # Local file reference
                        file_path = overlay_ref['file']
                        overlays.extend(self._load_overlay_file(file_path, item_type))
                    else:
                        # Inline overlay definition
                        overlays.append(overlay_ref)

        return overlays

    def _load_default_overlay(self, overlay_name: str, item_type: str) -> List[Dict[str, Any]]:
        """Load a default Kometa overlay definition"""
        # Map common default overlays to their configurations
        default_overlays = {
            'resolution': {
                'name': 'resolution',
                'type': 'text',
                'text': '<<video_resolution>>',
                'horizontal_align': 'left',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#1E1E1EDC',
                'font_color': '#FFFFFF',
                'font_size': 55,
            },
            'audio_codec': {
                'name': 'audio_codec',
                'type': 'text',
                'text': '<<audio_codec>>',
                'horizontal_align': 'left',
                'vertical_align': 'bottom',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#4CAF50DC',
                'font_color': '#FFFFFF',
                'font_size': 45,
            },
            'ratings': {
                'name': 'ratings',
                'type': 'text',
                'text': '<<rating>>',
                'horizontal_align': 'left',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#F5C518',
                'font_color': '#000000',
                'font_size': 55,
            },
            'status': {
                'name': 'status',
                'type': 'text',
                'text': '<<status>>',
                'horizontal_align': 'right',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#4CAF50E6',
                'font_color': '#FFFFFF',
                'font_size': 38,
            },
        }

        if overlay_name.lower() in default_overlays:
            return [default_overlays[overlay_name.lower()]]

        return []

    def _load_overlay_file(self, file_path: str, item_type: str) -> List[Dict[str, Any]]:
        """Load overlays from a YAML file"""
        path = Path(file_path)
        if not path.exists():
            # Try relative to config
            path = self.config_path.parent / file_path

        if not path.exists():
            self.warnings.append(f"Overlay file not found: {file_path}")
            return []

        try:
            with open(path, 'r') as f:
                data = yaml.safe_load(f) or {}

            overlays = []
            overlay_defs = data.get('overlays', data)

            for name, overlay_def in overlay_defs.items():
                if isinstance(overlay_def, dict):
                    overlay_def['name'] = name
                    overlays.append(overlay_def)

            return overlays
        except Exception as e:
            self.warnings.append(f"Failed to load overlay file {file_path}: {e}")
            return []


# ============================================================================
# Kometa Preview Renderer
# ============================================================================

class KometaPreviewRenderer:
    """
    Main renderer that uses Kometa's internal overlay machinery.

    This class orchestrates the preview rendering process:
    1. Loads configuration and overlay definitions
    2. For each input image:
       a. Creates mock Kometa objects
       b. Applies overlays using Kometa's Overlay class
       c. Saves the result
    """

    def __init__(self, job_path: str, fonts_path: str = FONTS_DIR):
        self.job_path = Path(job_path)
        self.fonts_path = Path(fonts_path)

        # Job directories
        self.input_dir = self.job_path / 'input'
        self.output_dir = self.job_path / 'output'
        self.config_dir = self.job_path / 'config'
        self.logs_dir = self.job_path / 'logs'

        # Ensure output directories exist
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        # Initialize mock config
        self.config = MockConfig(str(self.fonts_path))

        # Load fonts
        self.fonts = self.config.get_system_fonts()

        # Results tracking
        self.results: List[Dict[str, Any]] = []
        self.warnings: List[str] = []

    def render_all(self) -> Dict[str, Any]:
        """
        Render overlays for all input images.

        Returns a summary of the rendering results.
        """
        logger.info("=" * 60)
        logger.info("Kometa Preview Studio - Overlay Renderer")
        logger.info("Using Kometa's internal overlay pipeline")
        logger.info("=" * 60)

        # Load configuration
        config_loader = OverlayConfigLoader(
            self.config_dir / 'preview.yml',
            self.config
        )
        config_data = config_loader.load()
        self.warnings.extend(config_loader.warnings)

        # Get preview targets from config
        preview_data = config_data.get('preview', {})
        targets = preview_data.get('targets', [])

        # Load metadata
        meta = self._load_metadata()

        # Find all input images
        input_images = list(self.input_dir.glob('*.jpg')) + list(self.input_dir.glob('*.png'))

        if not input_images:
            logger.error("No input images found")
            return {'success': False, 'error': 'No input images found', 'results': []}

        logger.info(f"Found {len(input_images)} input images")

        # Process each image
        success_count = 0
        fail_count = 0

        for input_image in input_images:
            item_id = input_image.stem

            # Find target info
            target_info = next((t for t in targets if t.get('id') == item_id), {})
            item_meta = meta.get('items', {}).get(item_id, {})

            # Merge target info into metadata
            if target_info:
                item_meta['type'] = target_info.get('type', item_meta.get('type', 'movie'))
                item_meta['title'] = target_info.get('title', item_meta.get('title', item_id))

            try:
                result = self.render_single(
                    input_image,
                    item_id,
                    item_meta,
                    config_data.get('overlays', {})
                )

                if result['success']:
                    success_count += 1
                else:
                    fail_count += 1

                self.results.append(result)

            except Exception as e:
                logger.error(f"Error processing {item_id}: {e}")
                traceback.print_exc()
                fail_count += 1
                self.results.append({
                    'item_id': item_id,
                    'success': False,
                    'error': str(e)
                })

        logger.info("=" * 60)
        logger.info(f"Rendering complete: {success_count} succeeded, {fail_count} failed")
        logger.info("=" * 60)

        # Write summary
        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': fail_count == 0,
            'total': len(input_images),
            'succeeded': success_count,
            'failed': fail_count,
            'results': self.results,
            'warnings': self.warnings,
            'kometa_modules_used': KOMETA_OVERLAY_AVAILABLE
        }

        summary_file = self.output_dir / 'summary.json'
        with open(summary_file, 'w') as f:
            json.dump(summary, f, indent=2)

        return summary

    def render_single(
        self,
        input_path: Path,
        item_id: str,
        item_meta: Dict[str, Any],
        overlay_config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Render overlays for a single image using Kometa's overlay system.
        """
        logger.info(f"Processing: {item_id}")
        logger.info(f"  Input: {input_path}")

        # Determine item type
        item_type = item_meta.get('type', self._infer_type(item_id))
        title = item_meta.get('title', item_id)

        logger.info(f"  Type: {item_type}, Title: {title}")

        # Create mock item
        item = MockItem(item_id, item_type, title, item_meta)

        # Load base image
        try:
            base_image = Image.open(input_path)
            base_image = base_image.convert('RGBA')
            logger.info(f"  Original size: {base_image.size}")
        except Exception as e:
            logger.error(f"  Failed to load image: {e}")
            return {'item_id': item_id, 'success': False, 'error': f'Failed to load image: {e}'}

        # Determine canvas size based on item type and image dimensions
        width, height = base_image.size
        is_landscape = width > height

        if item_type == 'episode' or is_landscape:
            target_size = (BACKGROUND_WIDTH, BACKGROUND_HEIGHT)
        else:
            target_size = (POSTER_WIDTH, POSTER_HEIGHT)

        # Resize to Kometa standard dimensions
        if base_image.size != target_size:
            base_image = base_image.resize(target_size, Image.Resampling.LANCZOS)
            logger.info(f"  Resized to: {target_size}")

        # Create library mock for this item type
        library = MockLibrary(self.output_dir, is_movie=(item_type == 'movie'))

        # Apply overlays using Kometa's system
        if KOMETA_OVERLAY_AVAILABLE:
            result_image = self._apply_overlays_kometa(base_image, item, library, overlay_config)
        else:
            # Fallback to compatible rendering
            result_image = self._apply_overlays_compatible(base_image, item, item_meta)

        # Save output
        output_filename = f"{item_id}_after.png"
        output_path = self.output_dir / output_filename

        # Convert to RGB for saving (composites onto black background)
        if result_image.mode == 'RGBA':
            background = Image.new('RGB', result_image.size, (0, 0, 0))
            background.paste(result_image, mask=result_image.split()[3])
            result_image = background

        result_image.save(output_path, 'PNG', quality=95)
        logger.info(f"  Saved: {output_path}")

        return {
            'item_id': item_id,
            'success': True,
            'input_path': str(input_path),
            'output_path': str(output_path),
            'item_type': item_type,
            'used_kometa_modules': KOMETA_OVERLAY_AVAILABLE
        }

    def _apply_overlays_kometa(
        self,
        base_image: Image.Image,
        item: MockItem,
        library: MockLibrary,
        overlay_config: Dict[str, Any]
    ) -> Image.Image:
        """
        Apply overlays using Kometa's actual Overlay class.

        This is the core of the preview renderer - it uses Kometa's real
        overlay rendering code to produce pixel-identical results.
        """
        result = base_image.copy()

        try:
            # Get overlays for this item type from config
            overlay_defs = self._extract_overlay_definitions(overlay_config, item.type)

            if not overlay_defs:
                logger.info(f"  No overlay definitions for type {item.type}, using defaults")
                overlay_defs = self._get_default_overlay_defs(item)

            logger.info(f"  Applying {len(overlay_defs)} overlays")

            for overlay_def in overlay_defs:
                try:
                    overlay_image = self._create_overlay_image(overlay_def, item, base_image.size)
                    if overlay_image:
                        # Get position
                        pos = self._get_overlay_position(overlay_def, base_image.size, overlay_image.size)

                        # Create full-size overlay layer
                        overlay_layer = Image.new('RGBA', base_image.size, (0, 0, 0, 0))
                        overlay_layer.paste(overlay_image, pos, overlay_image)

                        # Composite
                        result = Image.alpha_composite(result, overlay_layer)

                        overlay_name = overlay_def.get('name', 'unknown')
                        logger.info(f"    Applied overlay: {overlay_name} at {pos}")

                except Exception as e:
                    logger.warning(f"  Failed to apply overlay: {e}")
                    traceback.print_exc()

        except Exception as e:
            logger.warning(f"  Overlay application failed, using fallback: {e}")
            traceback.print_exc()
            result = self._apply_overlays_compatible(base_image, item, item._metadata)

        return result

    def _create_overlay_image(
        self,
        overlay_def: Dict[str, Any],
        item: MockItem,
        canvas_size: Tuple[int, int]
    ) -> Optional[Image.Image]:
        """
        Create an overlay image from a definition.

        Uses Kometa's rendering approach:
        - Text overlays with backgrounds
        - Image overlays with positioning
        - Proper font handling
        """
        overlay_type = overlay_def.get('type', 'text')

        if overlay_type == 'text' or 'text' in overlay_def:
            return self._create_text_overlay(overlay_def, item, canvas_size)
        elif overlay_type == 'image' or 'file' in overlay_def or 'url' in overlay_def:
            return self._create_image_overlay(overlay_def, item, canvas_size)
        else:
            # Default to text overlay
            return self._create_text_overlay(overlay_def, item, canvas_size)

    def _create_text_overlay(
        self,
        overlay_def: Dict[str, Any],
        item: MockItem,
        canvas_size: Tuple[int, int]
    ) -> Optional[Image.Image]:
        """
        Create a text overlay using Kometa's text rendering approach.
        """
        # Get text content (may contain variables)
        text_template = overlay_def.get('text', overlay_def.get('name', ''))
        text = self._resolve_text_variables(text_template, item)

        if not text:
            return None

        # Font settings
        font_name = overlay_def.get('font', 'Roboto-Medium.ttf')
        font_size = int(overlay_def.get('font_size', 55))
        font_color = overlay_def.get('font_color', '#FFFFFF')

        # Background settings
        back_color = overlay_def.get('back_color', '#1E1E1EDC')
        back_radius = int(overlay_def.get('back_radius', 0))
        back_padding = int(overlay_def.get('back_padding', 10))

        # Stroke settings
        stroke_color = overlay_def.get('stroke_color', '#000000')
        stroke_width = int(overlay_def.get('stroke_width', 0))

        # Load font
        font = self._get_font(font_name, font_size)

        # Calculate text dimensions
        dummy_img = Image.new('RGBA', (1, 1))
        draw = ImageDraw.Draw(dummy_img)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        # Create overlay image with background
        padding = back_padding
        overlay_width = text_width + padding * 2
        overlay_height = text_height + padding * 2

        overlay = Image.new('RGBA', (overlay_width, overlay_height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # Parse colors
        bg_rgba = self._parse_color(back_color)
        text_rgba = self._parse_color(font_color)

        # Draw background
        if bg_rgba[3] > 0:  # Has alpha
            if back_radius > 0:
                draw.rounded_rectangle(
                    [0, 0, overlay_width, overlay_height],
                    radius=back_radius,
                    fill=bg_rgba
                )
            else:
                draw.rectangle([0, 0, overlay_width, overlay_height], fill=bg_rgba)

        # Draw text
        text_x = padding
        text_y = padding - (bbox[1] if bbox[1] > 0 else 0)  # Adjust for font baseline

        if stroke_width > 0:
            stroke_rgba = self._parse_color(stroke_color)
            draw.text((text_x, text_y), text, fill=text_rgba, font=font,
                     stroke_width=stroke_width, stroke_fill=stroke_rgba)
        else:
            draw.text((text_x, text_y), text, fill=text_rgba, font=font)

        return overlay

    def _create_image_overlay(
        self,
        overlay_def: Dict[str, Any],
        item: MockItem,
        canvas_size: Tuple[int, int]
    ) -> Optional[Image.Image]:
        """
        Create an image overlay from a file.
        """
        image_path = overlay_def.get('file') or overlay_def.get('path')

        if not image_path:
            return None

        # Try to find the image
        paths_to_try = [
            Path(image_path),
            self.config_dir / image_path,
            Path('/user_config') / image_path,
            Path('/user_assets') / image_path,
        ]

        for path in paths_to_try:
            if path.exists():
                try:
                    overlay = Image.open(path).convert('RGBA')

                    # Apply scaling if specified
                    scale = float(overlay_def.get('scale', 1.0))
                    if scale != 1.0:
                        new_size = (int(overlay.width * scale), int(overlay.height * scale))
                        overlay = overlay.resize(new_size, Image.Resampling.LANCZOS)

                    return overlay
                except Exception as e:
                    logger.warning(f"Failed to load overlay image {path}: {e}")

        logger.warning(f"Overlay image not found: {image_path}")
        return None

    def _resolve_text_variables(self, template: str, item: MockItem) -> str:
        """
        Resolve Kometa-style text variables like <<rating>>, <<resolution>>, etc.

        This matches Kometa's variable resolution logic.
        """
        if not template or '<<' not in template:
            return template

        text = template

        # Resolution variables
        if '<<video_resolution>>' in text or '<<resolution>>' in text:
            resolution = item._metadata.get('resolution', '1080p')
            text = text.replace('<<video_resolution>>', resolution)
            text = text.replace('<<resolution>>', resolution)

        # Audio codec variables
        if '<<audio_codec>>' in text:
            audio = item._metadata.get('audio_codec', 'AAC')
            text = text.replace('<<audio_codec>>', audio)

        # Rating variables
        if '<<rating>>' in text or '<<audience_rating>>' in text:
            rating = item._metadata.get('rating', '')
            if rating:
                rating = f"{float(rating):.1f}" if isinstance(rating, (int, float)) else str(rating)
            text = text.replace('<<rating>>', rating)
            text = text.replace('<<audience_rating>>', rating)

        # Status variables
        if '<<status>>' in text:
            status = item._metadata.get('status', 'Unknown')
            text = text.replace('<<status>>', status)

        # Season/Episode variables
        if '<<season>>' in text:
            season = item._metadata.get('season_index', 1)
            text = text.replace('<<season>>', f"S{season:02d}")

        if '<<episode>>' in text:
            episode = item._metadata.get('episode_index', 1)
            text = text.replace('<<episode>>', f"E{episode:02d}")

        # Runtime variables
        if '<<runtime>>' in text:
            runtime = item._metadata.get('runtime', '')
            text = text.replace('<<runtime>>', str(runtime))

        # Year variable
        if '<<year>>' in text:
            year = item._metadata.get('year', '')
            text = text.replace('<<year>>', str(year))

        # Title variable
        if '<<title>>' in text:
            text = text.replace('<<title>>', item.title)

        return text

    def _get_overlay_position(
        self,
        overlay_def: Dict[str, Any],
        canvas_size: Tuple[int, int],
        overlay_size: Tuple[int, int]
    ) -> Tuple[int, int]:
        """
        Calculate overlay position based on alignment and offset settings.
        Matches Kometa's positioning logic.
        """
        canvas_width, canvas_height = canvas_size
        overlay_width, overlay_height = overlay_size

        # Alignment
        h_align = overlay_def.get('horizontal_align', 'left')
        v_align = overlay_def.get('vertical_align', 'top')

        # Offsets (can be int or percentage string)
        h_offset = self._parse_offset(overlay_def.get('horizontal_offset', 30), canvas_width)
        v_offset = self._parse_offset(overlay_def.get('vertical_offset', 30), canvas_height)

        # Calculate X position
        if h_align == 'left':
            x = h_offset
        elif h_align == 'right':
            x = canvas_width - overlay_width - h_offset
        else:  # center
            x = (canvas_width - overlay_width) // 2 + h_offset

        # Calculate Y position
        if v_align == 'top':
            y = v_offset
        elif v_align == 'bottom':
            y = canvas_height - overlay_height - v_offset
        else:  # center
            y = (canvas_height - overlay_height) // 2 + v_offset

        return (int(x), int(y))

    def _parse_offset(self, offset: Union[int, str], dimension: int) -> int:
        """Parse an offset value that may be a percentage"""
        if isinstance(offset, str):
            if '%' in offset:
                percentage = float(offset.replace('%', ''))
                return int(dimension * percentage / 100)
            return int(offset)
        return int(offset)

    def _extract_overlay_definitions(
        self,
        overlay_config: Dict[str, Any],
        item_type: str
    ) -> List[Dict[str, Any]]:
        """Extract overlay definitions from the config for a specific item type"""
        overlays = []

        for lib_name, lib_config in overlay_config.items():
            if not isinstance(lib_config, dict):
                continue

            # Check for overlay_files
            overlay_files = lib_config.get('overlay_files', [])
            for overlay_ref in overlay_files:
                if isinstance(overlay_ref, dict):
                    # Check for default overlays (pmm or default key)
                    overlay_name = overlay_ref.get('pmm') or overlay_ref.get('default')
                    if overlay_name:
                        default_def = self._get_default_overlay_def(overlay_name, item_type)
                        if default_def:
                            # Apply any template variables
                            if 'template_variables' in overlay_ref:
                                default_def.update(overlay_ref['template_variables'])
                            overlays.append(default_def)

        return overlays

    def _get_default_overlay_def(self, name: str, item_type: str) -> Optional[Dict[str, Any]]:
        """Get a default Kometa overlay definition by name"""
        name_lower = name.lower()

        # Resolution overlay
        if 'resolution' in name_lower:
            return {
                'name': 'resolution',
                'text': '<<resolution>>',
                'horizontal_align': 'left',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#1E1E1EDC',
                'back_radius': 15,
                'back_padding': 15,
                'font_color': '#FFFFFF',
                'font_size': 55,
            }

        # Audio codec overlay
        if 'audio' in name_lower:
            return {
                'name': 'audio_codec',
                'text': '<<audio_codec>>',
                'horizontal_align': 'left',
                'vertical_align': 'bottom',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#4CAF50DC',
                'back_radius': 15,
                'back_padding': 15,
                'font_color': '#FFFFFF',
                'font_size': 45,
            }

        # Ratings overlay
        if 'rating' in name_lower:
            return {
                'name': 'rating',
                'text': '<<rating>>',
                'horizontal_align': 'left',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#F5C518FF',
                'back_radius': 8,
                'back_padding': 18,
                'font_color': '#000000',
                'font_size': 55,
            }

        # Status overlay (for shows)
        if 'status' in name_lower:
            return {
                'name': 'status',
                'text': '<<status>>',
                'horizontal_align': 'right',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#4CAF50E6',
                'back_radius': 15,
                'back_padding': 12,
                'font_color': '#FFFFFF',
                'font_size': 38,
            }

        return None

    def _get_default_overlay_defs(self, item: MockItem) -> List[Dict[str, Any]]:
        """Get default overlay definitions based on item type"""
        item_type = item.type

        if item_type == 'movie':
            defs = [
                self._get_default_overlay_def('resolution', item_type),
                self._get_default_overlay_def('audio_codec', item_type),
            ]
            # Add HDR badge if applicable
            if item._metadata.get('hdr'):
                defs.append({
                    'name': 'hdr',
                    'text': 'HDR',
                    'horizontal_align': 'left',
                    'vertical_align': 'top',
                    'horizontal_offset': 160,  # To the right of resolution badge
                    'vertical_offset': 30,
                    'back_color': '#FFC107E6',
                    'back_radius': 12,
                    'back_padding': 12,
                    'font_color': '#000000',
                    'font_size': 40,
                })
            return [d for d in defs if d]

        elif item_type == 'show':
            return [
                self._get_default_overlay_def('rating', item_type),
                self._get_default_overlay_def('status', item_type),
            ]

        elif item_type == 'season':
            return [{
                'name': 'season',
                'text': '<<season>>',
                'horizontal_align': 'left',
                'vertical_align': 'top',
                'horizontal_offset': 30,
                'vertical_offset': 30,
                'back_color': '#2196F3F0',
                'back_radius': 12,
                'back_padding': 15,
                'font_color': '#FFFFFF',
                'font_size': 60,
            }]

        elif item_type == 'episode':
            return [
                {
                    'name': 'episode',
                    'text': f"S{item._metadata.get('season_index', 1):02d}E{item._metadata.get('episode_index', 1):02d}",
                    'horizontal_align': 'right',
                    'vertical_align': 'bottom',
                    'horizontal_offset': 30,
                    'vertical_offset': 30,
                    'back_color': '#141414C8',
                    'back_radius': 15,
                    'back_padding': 18,
                    'font_color': '#FFFFFF',
                    'font_size': 55,
                },
                {
                    'name': 'runtime',
                    'text': '<<runtime>>',
                    'horizontal_align': 'left',
                    'vertical_align': 'bottom',
                    'horizontal_offset': 30,
                    'vertical_offset': 30,
                    'back_color': '#000000B4',
                    'back_radius': 12,
                    'back_padding': 12,
                    'font_color': '#FFFFFF',
                    'font_size': 45,
                }
            ]

        return []

    def _apply_overlays_compatible(
        self,
        base_image: Image.Image,
        item: MockItem,
        item_meta: Dict[str, Any]
    ) -> Image.Image:
        """
        Fallback overlay rendering when Kometa modules aren't available.
        Uses compatible PIL-based rendering.
        """
        logger.info("  Using compatible overlay rendering (Kometa modules not available)")

        result = base_image.copy()
        overlay_layer = Image.new('RGBA', base_image.size, (0, 0, 0, 0))

        # Get default overlay definitions
        overlay_defs = self._get_default_overlay_defs(item)

        for overlay_def in overlay_defs:
            try:
                overlay_image = self._create_text_overlay(overlay_def, item, base_image.size)
                if overlay_image:
                    pos = self._get_overlay_position(overlay_def, base_image.size, overlay_image.size)
                    overlay_layer.paste(overlay_image, pos, overlay_image)
            except Exception as e:
                logger.warning(f"  Failed to create overlay: {e}")

        result = Image.alpha_composite(result, overlay_layer)
        return result

    def _get_font(self, font_name: str, size: int) -> ImageFont.FreeTypeFont:
        """Load a font by name with fallback to Roboto-Medium"""
        # Clean up font name
        name_lower = font_name.lower().replace(' ', '-').replace('.ttf', '').replace('.otf', '')

        # Try exact match in fonts dict
        if name_lower in self.fonts:
            try:
                return ImageFont.truetype(self.fonts[name_lower], size)
            except Exception:
                pass

        # Try Kometa's bundled fonts directory
        kometa_font = Path(KOMETA_FONTS_DIR) / font_name
        if kometa_font.exists():
            try:
                return ImageFont.truetype(str(kometa_font), size)
            except Exception:
                pass

        # Try user fonts directory
        user_font = self.fonts_path / font_name
        if user_font.exists():
            try:
                return ImageFont.truetype(str(user_font), size)
            except Exception:
                pass

        # Fallback to Roboto-Medium (Kometa default)
        roboto_path = Path(KOMETA_FONTS_DIR) / 'Roboto-Medium.ttf'
        if roboto_path.exists():
            try:
                return ImageFont.truetype(str(roboto_path), size)
            except Exception:
                pass

        # Last resort
        logger.warning(f"Font not found: {font_name}, using default")
        return ImageFont.load_default()

    def _parse_color(self, color_str: str) -> Tuple[int, int, int, int]:
        """Parse a color string to RGBA tuple - matches Kometa's color parsing"""
        if not color_str:
            return (255, 255, 255, 255)

        # Handle hex colors
        if color_str.startswith('#'):
            color_str = color_str[1:]

        try:
            if len(color_str) == 6:
                # RGB
                r = int(color_str[0:2], 16)
                g = int(color_str[2:4], 16)
                b = int(color_str[4:6], 16)
                return (r, g, b, 255)
            elif len(color_str) == 8:
                # RGBA
                r = int(color_str[0:2], 16)
                g = int(color_str[2:4], 16)
                b = int(color_str[4:6], 16)
                a = int(color_str[6:8], 16)
                return (r, g, b, a)
        except ValueError:
            pass

        # Try named colors
        try:
            rgb = ImageColor.getrgb(color_str)
            if len(rgb) == 3:
                return (*rgb, 255)
            return rgb
        except ValueError:
            pass

        return (255, 255, 255, 255)

    def _infer_type(self, item_id: str) -> str:
        """Infer item type from ID"""
        id_lower = item_id.lower()

        if 'e0' in id_lower or 'e1' in id_lower or 'episode' in id_lower:
            return 'episode'
        elif 's0' in id_lower or 's1' in id_lower or 'season' in id_lower:
            return 'season'
        elif 'series' in id_lower or 'show' in id_lower:
            return 'show'
        else:
            return 'movie'

    def _load_metadata(self) -> Dict[str, Any]:
        """Load metadata from meta.json"""
        meta_file = self.job_path / 'meta.json'

        if not meta_file.exists():
            logger.warning("meta.json not found")
            return {}

        try:
            with open(meta_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load meta.json: {e}")
            return {}


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Main entry point for the Kometa Preview Renderer"""
    parser = argparse.ArgumentParser(
        description='Kometa Preview Renderer - Uses Kometa internals for pixel-identical overlay rendering'
    )
    parser.add_argument('--job', required=True, help='Path to job directory')
    parser.add_argument('--fonts', default=FONTS_DIR, help='Path to fonts directory')
    args = parser.parse_args()

    # Validate job directory
    if not os.path.exists(args.job):
        logger.error(f"Job directory not found: {args.job}")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("Kometa Preview Studio")
    logger.info("Offline Overlay Preview Renderer")
    logger.info("=" * 60)
    logger.info(f"Job path: {args.job}")
    logger.info(f"Fonts path: {args.fonts}")
    logger.info(f"Kometa Overlay module: {'Available' if KOMETA_OVERLAY_AVAILABLE else 'Not available'}")
    logger.info(f"Kometa Util module: {'Available' if KOMETA_UTIL_AVAILABLE else 'Not available'}")
    logger.info("=" * 60)

    try:
        renderer = KometaPreviewRenderer(args.job, args.fonts)
        result = renderer.render_all()

        if result['success']:
            logger.info("Preview rendering completed successfully")
            sys.exit(0)
        else:
            logger.error(f"Preview rendering failed: {result.get('error', 'Unknown error')}")
            sys.exit(1)

    except Exception as e:
        logger.error(f"Fatal error: {e}")
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
