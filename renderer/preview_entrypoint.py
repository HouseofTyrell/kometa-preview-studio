#!/usr/bin/env python3
"""
Kometa Preview Studio - Preview Renderer (Path A with Proxy + Upload Capture)

This script runs REAL Kometa inside the container with a local HTTP proxy
that blocks all write operations to Plex while CAPTURING the uploaded images.

SAFETY MECHANISM:
- A local proxy server intercepts all Plex requests
- GET/HEAD requests are forwarded to the real Plex server
- PUT/POST/PATCH/DELETE requests are BLOCKED but their payloads are CAPTURED
- Captured images are saved to disk keyed by Plex ratingKey
- This works across process boundaries (subprocess-safe)

OUTPUT MAPPING:
- When Kometa uploads a poster (blocked), the image bytes are extracted
- The ratingKey is parsed from the request path
- Images are saved to: output/previews/<ratingKey>__<kind>.<ext>
- After Kometa finishes, targets are mapped by ratingKey to get correct outputs

Usage:
    python3 preview_entrypoint.py --job /jobs/<jobId>
"""

import argparse
import cgi
import hashlib
import io
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import traceback
import xml.etree.ElementTree as ET
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse, parse_qs, urlsplit
import http.client
import ssl

# Configure logging before any other imports
logging.basicConfig(
    level=logging.INFO,
    format='| %(levelname)-8s | %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('KometaPreview')

# Proxy configuration
PROXY_PORT = 32500
PROXY_HOST = '127.0.0.1'

# Output caching - skip rendering if config unchanged
OUTPUT_CACHE_ENABLED = os.environ.get('PREVIEW_OUTPUT_CACHE', '1') == '1'

# ============================================================================
# Preview Accuracy Mode Configuration
# ============================================================================
# PREVIEW_ACCURACY: 'fast' (default) or 'accurate'
# - fast: Caps external API results (TMDb, Trakt, etc.) to prevent slow expansions
# - accurate: Full Kometa behavior with all external API expansions
PREVIEW_ACCURACY = os.environ.get('PREVIEW_ACCURACY', 'fast').lower()

# Fast mode caps - limits for external ID expansions
PREVIEW_EXTERNAL_ID_LIMIT = int(os.environ.get('PREVIEW_EXTERNAL_ID_LIMIT', '25'))
PREVIEW_EXTERNAL_PAGES_LIMIT = int(os.environ.get('PREVIEW_EXTERNAL_PAGES_LIMIT', '1'))

# TMDb Proxy configuration (for intercepting TMDb API calls in fast mode)
TMDB_PROXY_ENABLED = os.environ.get('PREVIEW_TMDB_PROXY', '1') == '1' and PREVIEW_ACCURACY == 'fast'
TMDB_PROXY_PORT = 8191  # Port for TMDb proxy


# ============================================================================
# Font Configuration (P1)
# ============================================================================
# PREVIEW_STRICT_FONTS: If true, fail if required fonts are missing
# Default: false (log warnings but continue)
PREVIEW_STRICT_FONTS = os.environ.get('PREVIEW_STRICT_FONTS', '0') == '1'

# Default fallback font path (prefer /fonts if available)
DEFAULT_FALLBACK_FONT = os.environ.get('PREVIEW_FALLBACK_FONT', '/fonts/Inter-Regular.ttf')

# Common font paths to validate
COMMON_FONT_PATHS = [
    '/config/fonts',
    '/fonts',
    '/usr/share/fonts',
]

FALLBACK_FONT_CANDIDATES = [
    DEFAULT_FALLBACK_FONT,
    '/fonts/Inter-Regular.ttf',
    '/config/fonts/Inter-Regular.ttf',
]

# FAST mode guardrails
FAST_MODE = PREVIEW_ACCURACY == 'fast'


def validate_fonts_at_startup() -> List[str]:
    """
    Validate font availability at startup.

    P1 Fix: Check common font directories and log warnings for missing fonts.
    Returns a list of available font directories.
    """
    available_dirs = []
    missing_dirs = []

    for font_path in COMMON_FONT_PATHS:
        if Path(font_path).exists():
            available_dirs.append(font_path)
            # List available fonts
            fonts = list(Path(font_path).glob('*.ttf')) + list(Path(font_path).glob('*.otf'))
            if fonts:
                logger.info(f"FONT_DIR_FOUND: {font_path} ({len(fonts)} fonts)")
                for font in fonts[:5]:  # Log first 5
                    logger.debug(f"  - {font.name}")
                if len(fonts) > 5:
                    logger.debug(f"  - ... and {len(fonts) - 5} more")
            else:
                logger.warning(f"FONT_DIR_EMPTY: {font_path} exists but contains no fonts")
        else:
            missing_dirs.append(font_path)

    if not available_dirs:
        logger.warning("FONT_WARNING: No font directories found!")
        logger.warning(f"  Checked: {', '.join(COMMON_FONT_PATHS)}")
        logger.warning("  Overlay rendering may fail if custom fonts are referenced.")
        logger.warning("  To fix: Mount font files to /config/fonts or set PREVIEW_FALLBACK_FONT")

    fallback_font = get_fallback_font_path()
    if Path(fallback_font).exists():
        logger.info(f"FALLBACK_FONT_OK: {fallback_font}")
    else:
        logger.warning(f"FALLBACK_FONT_MISSING: {fallback_font}")
        if PREVIEW_STRICT_FONTS:
            raise FileNotFoundError(
                f"Fallback font not found: {fallback_font}. "
                f"Set PREVIEW_STRICT_FONTS=0 to continue without fallback font."
            )

    return available_dirs


def normalize_font_path(requested_path: str) -> Path:
    requested = Path(requested_path)
    if requested.is_absolute():
        return requested
    return Path('/') / requested


def get_fallback_font_path() -> str:
    for candidate in FALLBACK_FONT_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    return DEFAULT_FALLBACK_FONT


def resolve_font_fallback(requested_path: str) -> Optional[str]:
    """
    Ensure a requested font path exists, falling back to DEFAULT_FALLBACK_FONT if missing.

    Returns the resolved font path if available, or None if missing and strict mode is disabled.
    """
    requested = normalize_font_path(requested_path)
    if requested.exists():
        return str(requested)

    fallback_source: Optional[Path] = None
    for root in ('/fonts', '/config/fonts'):
        candidate = Path(root) / requested.name
        if candidate.exists():
            fallback_source = candidate
            break

    if fallback_source is None:
        fallback_source = Path(get_fallback_font_path())

    if not fallback_source.exists():
        message = f"Fallback font missing: {fallback_source}"
        if PREVIEW_STRICT_FONTS:
            raise FileNotFoundError(message)
        logger.warning(f"FONT_FALLBACK_SKIPPED requested={requested_path} reason=fallback_missing")
        return None

    requested.parent.mkdir(parents=True, exist_ok=True)
    try:
        if requested.exists():
            return str(requested)
        shutil.copy2(fallback_source, requested)
        logger.info(f"FONT_FALLBACK requested={requested_path} fallback={fallback_source}")
        return str(requested)
    except Exception as e:
        if PREVIEW_STRICT_FONTS:
            raise
        logger.warning(f"FONT_FALLBACK_FAILED requested={requested_path} error={e}")
        return None


def collect_font_paths(data: Any) -> List[str]:
    """Collect font paths from nested config data."""
    font_paths: List[str] = []

    def _walk(value: Any):
        if isinstance(value, dict):
            for v in value.values():
                _walk(v)
        elif isinstance(value, list):
            for v in value:
                _walk(v)
        elif isinstance(value, str):
            lower = value.lower()
            if lower.endswith(('.ttf', '.otf', '.ttc')):
                font_paths.append(value)

    _walk(data)
    return font_paths


def ensure_font_fallbacks(data: Any) -> int:
    """Ensure all referenced fonts exist by applying fallbacks when missing."""
    fallback_count = 0
    for font_path in set(collect_font_paths(data)):
        resolved = resolve_font_fallback(font_path)
        if resolved and resolved != font_path:
            fallback_count += 1
    return fallback_count


def _contains_letterboxd(data: Any) -> bool:
    if isinstance(data, dict):
        for key, value in data.items():
            if 'letterboxd' in str(key).lower():
                return True
            if _contains_letterboxd(value):
                return True
    elif isinstance(data, list):
        return any(_contains_letterboxd(item) for item in data)
    elif isinstance(data, str):
        return 'letterboxd' in data.lower()
    return False


def _strip_imdb_awards_category_filter(data: Any) -> int:
    stripped = 0
    if isinstance(data, dict):
        for key, value in list(data.items()):
            if str(key).lower() == 'imdb_awards' and isinstance(value, dict):
                for filter_key in ('category_filter', 'category_filters'):
                    if filter_key in value:
                        value.pop(filter_key, None)
                        stripped += 1
            else:
                stripped += _strip_imdb_awards_category_filter(value)
    elif isinstance(data, list):
        for item in data:
            stripped += _strip_imdb_awards_category_filter(item)
    return stripped


def sanitize_overlay_data_for_fast_mode(data: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """
    Remove Letterboxd builders and skip IMDb awards category_filter validation in FAST mode.
    """
    removed_letterboxd = 0
    stripped_imdb = 0

    if not isinstance(data, dict):
        return data, {'letterboxd_removed': 0, 'imdb_category_filters_stripped': 0}

    for section_key in ('overlays', 'collections', 'metadata', 'templates'):
        section = data.get(section_key)
        if isinstance(section, dict):
            for item_key in list(section.keys()):
                item_value = section[item_key]
                if _contains_letterboxd(item_value):
                    section.pop(item_key, None)
                    removed_letterboxd += 1
                else:
                    stripped_imdb += _strip_imdb_awards_category_filter(item_value)

    return data, {
        'letterboxd_removed': removed_letterboxd,
        'imdb_category_filters_stripped': stripped_imdb,
    }


# ============================================================================
# Output Caching Functions
# ============================================================================

def compute_config_hash(preview_config: Dict[str, Any]) -> str:
    """
    Compute a hash of the configuration that affects overlay output.

    This includes:
    - Preview targets (id, type, metadata)
    - Overlay file references
    - Library configurations

    Does NOT include:
    - Plex URL/token (doesn't affect output)
    - TMDb credentials (doesn't affect output)

    Returns:
        A hex hash string that uniquely identifies this configuration.
    """
    hash_input = {}

    # Include preview targets
    preview_data = preview_config.get('preview', {})
    targets = safe_preview_targets(preview_config)

    # Sort targets by id for consistent hashing
    sorted_targets = sorted(targets, key=lambda t: t.get('id', ''))
    hash_input['targets'] = [
        {
            'id': t.get('id'),
            'type': t.get('type'),
            'ratingKey': t.get('ratingKey'),
            'metadata': t.get('metadata'),
        }
        for t in sorted_targets
    ]

    # Include library overlay configurations
    if 'libraries' in preview_config:
        hash_input['libraries'] = {}
        for lib_name, lib_config in preview_config['libraries'].items():
            if isinstance(lib_config, dict):
                hash_input['libraries'][lib_name] = {
                    'overlay_files': lib_config.get('overlay_files'),
                }

    # Serialize and hash
    hash_str = json.dumps(hash_input, sort_keys=True, default=str)
    return hashlib.sha256(hash_str.encode()).hexdigest()[:16]


def check_cached_outputs(job_path: Path, config_hash: str) -> bool:
    """
    Check if cached outputs exist and are valid for this config hash.

    Returns True if:
    1. Cache hash file exists and matches current config
    2. All expected output files exist
    """
    output_dir = job_path / 'output'
    cache_hash_path = output_dir / '.cache_hash'

    # Check if hash file exists
    if not cache_hash_path.exists():
        return False

    # Check if hash matches
    try:
        stored_hash = cache_hash_path.read_text().strip()
        if stored_hash != config_hash:
            logger.info(f"Config changed (hash {stored_hash[:8]}... -> {config_hash[:8]}...)")
            return False
    except Exception as e:
        logger.warning(f"Failed to read cache hash: {e}")
        return False

    # Check if output files exist
    output_files = list(output_dir.glob('*_after.*'))
    if not output_files:
        logger.info("No cached output files found")
        return False

    logger.info(f"Found {len(output_files)} cached output files")
    return True


def save_cache_hash(job_path: Path, config_hash: str):
    """Save the config hash after successful rendering."""
    output_dir = job_path / 'output'
    cache_hash_path = output_dir / '.cache_hash'

    try:
        cache_hash_path.write_text(config_hash)
        logger.info(f"Saved cache hash: {config_hash[:8]}...")
    except Exception as e:
        logger.warning(f"Failed to save cache hash: {e}")


def use_cached_outputs(job_path: Path) -> Tuple[bool, Dict[str, str]]:
    """
    Use cached outputs without re-rendering.

    Returns:
        (success, exported_files dict)
    """
    output_dir = job_path / 'output'
    exported = {}

    # Find all output files
    for output_file in output_dir.glob('*_after.*'):
        # Extract target_id from filename (e.g., "matrix_after.png" -> "matrix")
        target_id = output_file.stem.replace('_after', '')
        exported[target_id] = str(output_file)

    return len(exported) > 0, exported

# Mock library mode - prevents forwarding listing endpoints to real Plex
# Set PREVIEW_MOCK_LIBRARY=0 to disable and fall back to filter mode
MOCK_LIBRARY_ENABLED = os.environ.get('PREVIEW_MOCK_LIBRARY', '1') == '1'
DEBUG_MOCK_XML = os.environ.get('PREVIEW_DEBUG_MOCK_XML', '0') == '1'

# Plex upload endpoint patterns
# Matches: /library/metadata/<ratingKey>/posters, /library/metadata/<ratingKey>/arts, etc.
PLEX_UPLOAD_PATTERN = re.compile(
    r'^/library/metadata/(\d+)/(posters?|arts?|thumbs?)(?:\?.*)?$'
)

# Additional upload patterns to capture more aggressively
# Kometa may use various upload mechanisms
PLEX_UPLOAD_PATTERNS_EXTENDED = [
    # Standard metadata upload paths
    re.compile(r'^/library/metadata/(\d+)/(posters?|arts?|thumbs?)(?:\?.*)?$'),
    # Photo transcode (used for image uploads/processing)
    re.compile(r'^/photo/:/transcode'),
    # Library metadata upload (alternative path)
    re.compile(r'^/library/metadata/(\d+)/uploads?(?:\?.*)?$'),
    # Direct upload paths
    re.compile(r'^/:/upload'),
]

# Pattern to extract ratingKey from various upload paths
RATING_KEY_EXTRACT_PATTERNS = [
    re.compile(r'/library/metadata/(\d+)/'),
    re.compile(r'[?&]ratingKey=(\d+)'),
    re.compile(r'[?&]key=/library/metadata/(\d+)'),
]

# Library listing endpoint patterns (endpoints that return lists of items)
# These are filtered to only include allowed ratingKeys
# Note: Using simpler patterns that match the path prefix, query string handled separately
LIBRARY_LISTING_PATTERNS = [
    # Primary listing endpoints (most important for Kometa)
    re.compile(r'^/library/sections/\d+/all\b'),           # All items in section
    re.compile(r'^/library/sections/\d+/search\b'),        # Search in section
    re.compile(r'^/library/search\b'),                      # Global library search
    re.compile(r'^/hubs/search\b'),                         # Hub search
    # Browse/filter endpoints
    re.compile(r'^/library/sections/\d+/firstCharacter\b'),
    re.compile(r'^/library/sections/\d+/genre\b'),
    re.compile(r'^/library/sections/\d+/year\b'),
    re.compile(r'^/library/sections/\d+/decade\b'),
    re.compile(r'^/library/sections/\d+/rating\b'),
    re.compile(r'^/library/sections/\d+/collection\b'),
    re.compile(r'^/library/sections/\d+/recentlyAdded\b'),
    re.compile(r'^/library/sections/\d+/newest\b'),
    re.compile(r'^/library/sections/\d+/onDeck\b'),
    re.compile(r'^/library/sections/\d+/unwatched\b'),
    # Additional endpoints Kometa might use
    re.compile(r'^/library/sections/\d+/folder\b'),        # Folder browse
    re.compile(r'^/library/sections/\d+/filters\b'),       # Filter results
    re.compile(r'^/library/all\b'),                         # All library items
    re.compile(r'^/library/recentlyAdded\b'),              # Global recently added
]

# Metadata endpoint pattern - to block access to non-allowed items
METADATA_PATTERN = re.compile(r'^/library/metadata/(\d+)(?:/.*)?(?:\?.*)?$')

# Artwork/photo endpoint patterns
ARTWORK_PATTERNS = [
    re.compile(r'^/library/metadata/(\d+)/(thumb|art|poster|banner|background)(?:/.*)?(?:\?.*)?$'),
    re.compile(r'^/photo/:/transcode\?.*url=.*metadata%2F(\d+)'),  # Transcoded photos
]

# Library sections endpoint - used to get list of library sections
LIBRARY_SECTIONS_PATTERN = re.compile(r'^/library/sections(?:\?.*)?$')
# Pattern to match specific section requests: /library/sections/{id}
# This is used when Kometa queries section details
LIBRARY_SECTION_DETAIL_PATTERN = re.compile(r'^/library/sections/(\d+)(?:\?.*)?$')

# Section ID extraction pattern
SECTION_ID_PATTERN = re.compile(r'^/library/sections/(\d+)/')

# Children endpoint pattern (for getting seasons of a show, episodes of a season)
CHILDREN_PATTERN = re.compile(r'^/library/metadata/(\d+)/children(?:\?.*)?$')


# ============================================================================
# XML Filtering Helpers (Unit-Testable)
# ============================================================================

def filter_media_container_xml(xml_bytes: bytes, allowed_rating_keys: Set[str]) -> bytes:
    """
    Filter a Plex MediaContainer XML response to only include items with allowed ratingKeys.

    This is the core filtering function that:
    1. Parses the XML response
    2. Removes child elements (Video, Directory, etc.) not in allowed_rating_keys
    3. Updates the MediaContainer's size/totalSize attributes
    4. Returns the filtered XML

    Args:
        xml_bytes: Raw XML response from Plex
        allowed_rating_keys: Set of ratingKey strings that are allowed through

    Returns:
        Filtered XML bytes with same structure but only allowed items
    """
    try:
        # Parse XML
        root = ET.fromstring(xml_bytes)

        # Track counts for logging
        original_count = 0
        filtered_count = 0

        # Find all child elements that have ratingKey attribute
        # Common element types: Video, Directory, Track, Photo, Episode, Season, Show
        children_to_remove = []

        for child in root:
            # Check if this element has a ratingKey
            rating_key = child.get('ratingKey')
            if rating_key is not None:
                original_count += 1
                if rating_key not in allowed_rating_keys:
                    children_to_remove.append(child)
                else:
                    filtered_count += 1

        # Remove non-allowed children
        for child in children_to_remove:
            root.remove(child)

        # Update MediaContainer attributes
        if root.tag == 'MediaContainer':
            # Update size to reflect filtered count
            root.set('size', str(filtered_count))

            # If totalSize exists, update it too (for paginated responses)
            if 'totalSize' in root.attrib:
                root.set('totalSize', str(filtered_count))

            # Reset offset if present (we're returning all filtered items)
            if 'offset' in root.attrib:
                root.set('offset', '0')

        # Log the filtering
        removed_count = original_count - filtered_count
        if removed_count > 0:
            logger.info(
                f"FILTER_XML items: before={original_count} after={filtered_count} "
                f"removed={removed_count} allowed={len(allowed_rating_keys)}"
            )

        # Return as bytes with XML declaration
        return ET.tostring(root, encoding='unicode').encode('utf-8')

    except ET.ParseError as e:
        logger.warning(f"XML_PARSE_ERROR: {e} - passing through unchanged")
        return xml_bytes
    except Exception as e:
        logger.warning(f"FILTER_ERROR: {e} - passing through unchanged")
        return xml_bytes


def create_empty_media_container_xml() -> bytes:
    """
    Create an empty MediaContainer XML response.

    Used when blocking access to metadata for non-allowed items.
    """
    return b'<?xml version="1.0" encoding="UTF-8"?>\n<MediaContainer size="0"></MediaContainer>'


def is_listing_endpoint(path: str) -> bool:
    """
    Check if a path is a library listing endpoint that should be filtered.

    Args:
        path: Request path (may include query string)

    Returns:
        True if this endpoint returns a list of items that should be filtered
    """
    # Strip query string for cleaner matching
    path_base = path.split('?')[0]

    # Check against all listing patterns
    for pattern in LIBRARY_LISTING_PATTERNS:
        if pattern.search(path_base):
            return True
    return False


def extract_rating_key_from_path(path: str) -> Optional[str]:
    """
    Extract ratingKey from a metadata or artwork path.

    Args:
        path: Request path

    Returns:
        ratingKey string or None if not found
    """
    # Try metadata pattern first
    match = METADATA_PATTERN.match(path)
    if match:
        return match.group(1)

    # Try artwork patterns
    for pattern in ARTWORK_PATTERNS:
        match = pattern.search(path)
        if match:
            return match.group(1)

    return None


def is_metadata_endpoint(path: str) -> bool:
    """Check if path is a metadata endpoint (not upload)."""
    # Must match metadata pattern but NOT upload pattern
    if PLEX_UPLOAD_PATTERN.match(path.split('?')[0]):
        return False
    return METADATA_PATTERN.match(path) is not None


def extract_allowed_rating_keys(preview_config: Dict[str, Any]) -> Set[str]:
    """
    Extract the set of allowed ratingKeys from preview configuration.

    Args:
        preview_config: Loaded preview.yml configuration

    Returns:
        Set of ratingKey strings that are allowed through the proxy
    """
    allowed = set()

    preview_data = preview_config.get('preview', {})
    targets = safe_preview_targets(preview_config)

    for target in targets:
        # Support multiple key names for ratingKey
        rating_key = (
            target.get('ratingKey') or
            target.get('rating_key') or
            target.get('plex_id')
        )
        if rating_key:
            allowed.add(str(rating_key))

    return allowed


def extract_preview_targets(preview_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract the list of preview targets with all their metadata.

    Args:
        preview_config: Loaded preview.yml configuration

    Returns:
        List of target dicts with ratingKey, type, title, etc.
    """
    preview_data = preview_config.get('preview', {})
    return preview_data.get('targets', [])


def safe_preview_targets(preview_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return preview targets list safely without raising."""
    if not isinstance(preview_config, dict):
        return []
    preview_data = preview_config.get('preview', {})
    if not isinstance(preview_data, dict):
        return []
    targets = preview_data.get('targets', [])
    return targets if isinstance(targets, list) else []


# ============================================================================
# Mock Library Mode - Synthetic XML Generation
# ============================================================================

def build_synthetic_section_detail_xml(section_id: str, targets: List[Dict[str, Any]]) -> bytes:
    """
    Build synthetic /library/sections/{id} XML response for a specific section.

    This fixes P0 libtype mismatch by ensuring the section returns the correct type
    (movie/show) instead of forwarding to real Plex which might return a different library.

    Args:
        section_id: The requested section ID
        targets: List of preview targets to determine the library type

    Returns:
        XML bytes for MediaContainer with the section's Directory element
    """
    # Determine section type based on targets
    has_movies = any(t.get('type') in ('movie', 'movies') for t in targets)
    has_shows = any(t.get('type') in ('show', 'shows', 'series', 'season', 'episode') for t in targets)

    # Section 1 is Movies, Section 2 is TV Shows (our convention)
    if section_id == '1' or (has_movies and not has_shows):
        section_type = 'movie'
        section_title = 'Movies'
        agent = 'tv.plex.agents.movie'
        scanner = 'Plex Movie'
    elif section_id == '2' or (has_shows and not has_movies):
        section_type = 'show'
        section_title = 'TV Shows'
        agent = 'tv.plex.agents.series'
        scanner = 'Plex TV Series'
    else:
        # Default to movie for section 1, show for other sections
        if section_id == '1':
            section_type = 'movie'
            section_title = 'Movies'
            agent = 'tv.plex.agents.movie'
            scanner = 'Plex Movie'
        else:
            section_type = 'show'
            section_title = 'TV Shows'
            agent = 'tv.plex.agents.series'
            scanner = 'Plex TV Series'

    root = ET.Element('MediaContainer', {
        'size': '1',
        'allowSync': '0',
        'identifier': 'com.plexapp.plugins.library',
        'mediaTagPrefix': '/system/bundle/media/flags/',
        'mediaTagVersion': '1',
    })

    ET.SubElement(root, 'Directory', {
        'allowSync': '1',
        'art': f'/:/resources/{section_type}-fanart.jpg',
        'composite': f'/library/sections/{section_id}/composite/1234',
        'filters': '1',
        'refreshing': '0',
        'thumb': f'/:/resources/{section_type}.png',
        'key': section_id,
        'type': section_type,
        'title': section_title,
        'agent': agent,
        'scanner': scanner,
        'language': 'en-US',
        'uuid': f'mock-uuid-{section_id}',
        # Additional attributes Kometa may check
        'scannedAt': '1700000000',
        'createdAt': '1600000000',
        'content': '1',
        'directory': '1',
        'hidden': '0',
        'location': f'id={section_id}',
    })

    return ET.tostring(root, encoding='unicode').encode('utf-8')


def build_synthetic_library_sections_xml(targets: List[Dict[str, Any]]) -> bytes:
    """
    Build synthetic /library/sections XML response.

    Creates minimal library sections based on target types.

    Args:
        targets: List of preview targets

    Returns:
        XML bytes for MediaContainer with Directory elements for sections
    """
    # Determine which section types we need based on targets
    has_movies = any(t.get('type') in ('movie', 'movies') for t in targets)
    has_shows = any(t.get('type') in ('show', 'shows', 'series', 'season', 'episode') for t in targets)

    sections = []

    if has_movies:
        sections.append({
            'key': '1',
            'type': 'movie',
            'title': 'Movies',
            'agent': 'tv.plex.agents.movie',
            'scanner': 'Plex Movie',
        })

    if has_shows:
        sections.append({
            'key': '2',
            'type': 'show',
            'title': 'TV Shows',
            'agent': 'tv.plex.agents.series',
            'scanner': 'Plex TV Series',
        })

    # If no types detected, create both sections as fallback
    if not sections:
        sections = [
            {'key': '1', 'type': 'movie', 'title': 'Movies', 'agent': 'tv.plex.agents.movie', 'scanner': 'Plex Movie'},
            {'key': '2', 'type': 'show', 'title': 'TV Shows', 'agent': 'tv.plex.agents.series', 'scanner': 'Plex TV Series'},
        ]

    root = ET.Element('MediaContainer', {
        'size': str(len(sections)),
        'allowSync': '0',
        'title1': 'Plex Library',
    })

    for section in sections:
        ET.SubElement(root, 'Directory', {
            'allowSync': '1',
            'art': f'/:/resources/movie-fanart.jpg',
            'composite': f'/library/sections/{section["key"]}/composite/1234',
            'filters': '1',
            'refreshing': '0',
            'thumb': f'/:/resources/movie.png',
            'key': section['key'],
            'type': section['type'],
            'title': section['title'],
            'agent': section['agent'],
            'scanner': section['scanner'],
            'language': 'en-US',
            'uuid': f'mock-uuid-{section["key"]}',
        })

    return ET.tostring(root, encoding='unicode').encode('utf-8')


def _build_media_element(metadata: Dict[str, Any]) -> ET.Element:
    """
    Build a Media XML element from preview metadata.

    This allows overlays like resolution, audio_codec, etc. to match
    without querying Plex for actual mediainfo.

    Args:
        metadata: Preview metadata dict with resolution, audioCodec, etc.

    Returns:
        Media XML element with Part child
    """
    # Map user-friendly resolution to Plex format
    resolution_map = {
        '4K': '4k',
        '4k': '4k',
        '2160p': '4k',
        '1080p': '1080',
        '1080': '1080',
        '720p': '720',
        '720': '720',
        '480p': '480',
        '480': '480',
        'SD': 'sd',
    }

    # Map user-friendly audio codec to Plex format
    audio_codec_map = {
        'Dolby Atmos': 'truehd',
        'TrueHD': 'truehd',
        'truehd': 'truehd',
        'DTS-HD MA': 'dca-ma',
        'DTS-HD': 'dca-ma',
        'dts-hd': 'dca-ma',
        'DTS': 'dca',
        'dts': 'dca',
        'AAC': 'aac',
        'aac': 'aac',
        'AC3': 'ac3',
        'ac3': 'ac3',
        'EAC3': 'eac3',
        'eac3': 'eac3',
        'FLAC': 'flac',
        'flac': 'flac',
    }

    media_attrs = {}

    # Set video resolution
    if metadata.get('resolution'):
        res = metadata['resolution']
        media_attrs['videoResolution'] = resolution_map.get(res, res.lower())

    # Set audio codec
    if metadata.get('audioCodec'):
        codec = metadata['audioCodec']
        media_attrs['audioCodec'] = audio_codec_map.get(codec, codec.lower())

    # Set HDR/DV attributes
    if metadata.get('hdr'):
        media_attrs['videoProfile'] = 'hdr'
    if metadata.get('dolbyVision'):
        media_attrs['DOVIPresent'] = '1'

    # Create Media element
    media_elem = ET.Element('Media', media_attrs)

    # Add Part child (required for some overlay matchers)
    part_attrs = {}
    if metadata.get('audioCodec'):
        codec = metadata['audioCodec']
        part_attrs['audioProfile'] = audio_codec_map.get(codec, codec.lower())
    part_elem = ET.SubElement(media_elem, 'Part', part_attrs)

    return media_elem


def build_synthetic_listing_xml(
    targets: List[Dict[str, Any]],
    section_id: Optional[str] = None,
    query: Optional[str] = None,
    metadata_cache: Optional[Dict[str, ET.Element]] = None
) -> bytes:
    """
    Build synthetic XML for library listing endpoints.

    Creates a MediaContainer with only the preview target items.

    Args:
        targets: List of preview targets
        section_id: Optional library section ID to filter by
        query: Optional search query to filter by
        metadata_cache: Optional cache of metadata XML elements keyed by ratingKey

    Returns:
        XML bytes for MediaContainer with Video/Directory elements
    """
    items = []

    for target in targets:
        rating_key = str(
            target.get('ratingKey') or
            target.get('rating_key') or
            target.get('plex_id') or
            ''
        )

        if not rating_key:
            continue

        target_type = target.get('type', 'movie').lower()
        title = target.get('title', f'Item {rating_key}')
        year = target.get('year', '')

        # Get parent keys from target or cache
        parent_rating_key = target.get('parentRatingKey') or target.get('parent_rating_key', '')
        grandparent_rating_key = target.get('grandparentRatingKey') or target.get('grandparent_rating_key', '')

        # Try to get from cache if not in target
        if metadata_cache and rating_key in metadata_cache:
            cached = metadata_cache[rating_key]
            if not parent_rating_key:
                parent_rating_key = cached.get('parentRatingKey', '')
            if not grandparent_rating_key:
                grandparent_rating_key = cached.get('grandparentRatingKey', '')
            # Also get title/year if missing
            if title == f'Item {rating_key}':
                title = cached.get('title', title)
            if not year:
                year = cached.get('year', '')

        # Get preview metadata for instant overlay application (skips TMDb queries)
        metadata = target.get('metadata', {})

        # Build the item element based on type
        if target_type in ('movie', 'movies'):
            elem = ET.Element('Video', {
                'ratingKey': rating_key,
                'key': f'/library/metadata/{rating_key}',
                'type': 'movie',
                'title': title,
            })
            if year:
                elem.set('year', str(year))
            elem.set('thumb', f'/library/metadata/{rating_key}/thumb')
            elem.set('art', f'/library/metadata/{rating_key}/art')

            # Add Media element with resolution/audio metadata for overlay matching
            if metadata:
                media_elem = _build_media_element(metadata)
                elem.append(media_elem)

            items.append(elem)

        elif target_type in ('show', 'shows', 'series'):
            elem = ET.Element('Directory', {
                'ratingKey': rating_key,
                'key': f'/library/metadata/{rating_key}/children',
                'type': 'show',
                'title': title,
            })
            if year:
                elem.set('year', str(year))
            elem.set('thumb', f'/library/metadata/{rating_key}/thumb')
            elem.set('art', f'/library/metadata/{rating_key}/art')

            # Add status attribute for status overlay
            if metadata and metadata.get('status'):
                status_map = {
                    'returning': 'Returning Series',
                    'ended': 'Ended',
                    'canceled': 'Canceled',
                    'airing': 'Continuing',
                }
                elem.set('status', status_map.get(metadata['status'], metadata['status']))

            items.append(elem)

        elif target_type == 'season':
            elem = ET.Element('Directory', {
                'ratingKey': rating_key,
                'key': f'/library/metadata/{rating_key}/children',
                'type': 'season',
                'title': title,
                'index': str(target.get('index', target.get('seasonNumber', 1))),
            })
            if parent_rating_key:
                elem.set('parentRatingKey', str(parent_rating_key))
            elem.set('thumb', f'/library/metadata/{rating_key}/thumb')

            # Add Media element for resolution metadata
            if metadata:
                media_elem = _build_media_element(metadata)
                elem.append(media_elem)

            items.append(elem)

        elif target_type == 'episode':
            elem = ET.Element('Video', {
                'ratingKey': rating_key,
                'key': f'/library/metadata/{rating_key}',
                'type': 'episode',
                'title': title,
                'index': str(target.get('index', target.get('episodeNumber', 1))),
                'parentIndex': str(target.get('parentIndex', target.get('seasonNumber', 1))),
            })
            if parent_rating_key:
                elem.set('parentRatingKey', str(parent_rating_key))
            if grandparent_rating_key:
                elem.set('grandparentRatingKey', str(grandparent_rating_key))
            elem.set('thumb', f'/library/metadata/{rating_key}/thumb')

            # Add Media element for resolution/audio metadata
            if metadata:
                media_elem = _build_media_element(metadata)
                elem.append(media_elem)

            items.append(elem)

        else:
            # Unknown type - default to Video
            elem = ET.Element('Video', {
                'ratingKey': rating_key,
                'key': f'/library/metadata/{rating_key}',
                'type': target_type,
                'title': title,
            })
            items.append(elem)

    # Apply search filter if query provided
    if query:
        query_lower = query.lower()
        items = [
            item for item in items
            if query_lower in item.get('title', '').lower()
        ]

    # Build MediaContainer
    root = ET.Element('MediaContainer', {
        'size': str(len(items)),
        'totalSize': str(len(items)),
        'offset': '0',
        'allowSync': '1',
    })

    for item in items:
        root.append(item)

    return ET.tostring(root, encoding='unicode').encode('utf-8')


def build_synthetic_children_xml(
    parent_rating_key: str,
    targets: List[Dict[str, Any]],
    metadata_cache: Optional[Dict[str, ET.Element]] = None
) -> bytes:
    """
    Build synthetic XML for /library/metadata/{id}/children endpoint.

    Returns children (seasons or episodes) that are in our preview targets.

    Args:
        parent_rating_key: The ratingKey of the parent item
        targets: List of preview targets
        metadata_cache: Optional cache of metadata XML elements

    Returns:
        XML bytes for MediaContainer with child elements
    """
    children = []

    for target in targets:
        rating_key = str(
            target.get('ratingKey') or
            target.get('rating_key') or
            target.get('plex_id') or
            ''
        )

        if not rating_key:
            continue

        # Check if this target's parent matches
        target_parent = str(
            target.get('parentRatingKey') or
            target.get('parent_rating_key') or
            ''
        )
        target_grandparent = str(
            target.get('grandparentRatingKey') or
            target.get('grandparent_rating_key') or
            ''
        )

        # Also check metadata cache for parent relationships
        if metadata_cache and rating_key in metadata_cache:
            cached = metadata_cache[rating_key]
            if not target_parent:
                target_parent = cached.get('parentRatingKey', '')
            if not target_grandparent:
                target_grandparent = cached.get('grandparentRatingKey', '')

        # This item is a child if its parent or grandparent matches
        if target_parent == parent_rating_key or target_grandparent == parent_rating_key:
            target_type = target.get('type', '').lower()
            title = target.get('title', f'Item {rating_key}')

            if target_type == 'season':
                elem = ET.Element('Directory', {
                    'ratingKey': rating_key,
                    'key': f'/library/metadata/{rating_key}/children',
                    'type': 'season',
                    'title': title,
                    'index': str(target.get('index', target.get('seasonNumber', 1))),
                    'parentRatingKey': parent_rating_key,
                })
                children.append(elem)

            elif target_type == 'episode':
                elem = ET.Element('Video', {
                    'ratingKey': rating_key,
                    'key': f'/library/metadata/{rating_key}',
                    'type': 'episode',
                    'title': title,
                    'index': str(target.get('index', target.get('episodeNumber', 1))),
                    'parentIndex': str(target.get('parentIndex', target.get('seasonNumber', 1))),
                    'parentRatingKey': target_parent,
                })
                if target_grandparent:
                    elem.set('grandparentRatingKey', target_grandparent)
                children.append(elem)

    root = ET.Element('MediaContainer', {
        'size': str(len(children)),
        'totalSize': str(len(children)),
    })

    for child in children:
        root.append(child)

    return ET.tostring(root, encoding='unicode').encode('utf-8')


def is_library_sections_endpoint(path: str) -> bool:
    """Check if path is /library/sections (not a sub-path)."""
    path_base = path.split('?')[0]
    return LIBRARY_SECTIONS_PATTERN.match(path_base) is not None


def is_library_section_detail_endpoint(path: str) -> Optional[str]:
    """
    Check if path is /library/sections/{id} (section detail, not /all or other).

    Returns the section ID if matched, None otherwise.
    """
    path_base = path.split('?')[0]
    match = LIBRARY_SECTION_DETAIL_PATTERN.match(path_base)
    return match.group(1) if match else None


def is_children_endpoint(path: str) -> Optional[str]:
    """
    Check if path is /library/metadata/{id}/children.

    Returns the parent ratingKey if it matches, None otherwise.
    """
    path_base = path.split('?')[0]
    match = CHILDREN_PATTERN.match(path_base)
    return match.group(1) if match else None


def extract_section_id(path: str) -> Optional[str]:
    """Extract library section ID from path."""
    match = SECTION_ID_PATTERN.match(path)
    return match.group(1) if match else None


def extract_search_query(path: str) -> Optional[str]:
    """Extract search query from path query string."""
    parsed = urlsplit(path)
    params = parse_qs(parsed.query)
    # Check common query parameter names
    for key in ('query', 'title', 'search'):
        if key in params:
            return params[key][0]
    return None


def is_image_data(data: bytes) -> bool:
    """Check if bytes represent an image by magic bytes."""
    if len(data) < 8:
        return False
    # JPEG
    if data[:2] == b'\xff\xd8':
        return True
    # PNG
    if data[:8] == b'\x89PNG\r\n\x1a\n':
        return True
    # WebP
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return True
    return False


def detect_image_type(data: bytes) -> str:
    """Detect image type from magic bytes."""
    if len(data) >= 2 and data[:2] == b'\xff\xd8':
        return 'jpg'
    if len(data) >= 8 and data[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'webp'
    return 'jpg'


def parse_multipart_image(body: bytes, content_type: str) -> Tuple[Optional[bytes], str]:
    """Parse multipart/form-data and extract first image part."""
    try:
        boundary = None
        for part in content_type.split(';'):
            part = part.strip()
            if part.startswith('boundary='):
                boundary = part[9:].strip('"\'')
                break

        if not boundary:
            logger.warning("No boundary found in multipart content-type")
            return None, 'bin'

        full_msg = (
            f'Content-Type: {content_type}\r\n'
            f'MIME-Version: 1.0\r\n\r\n'
        ).encode() + body

        parser = BytesParser(policy=email_policy)
        msg = parser.parsebytes(full_msg)

        if msg.is_multipart():
            for part in msg.iter_parts():
                part_ct = part.get_content_type()
                filename = part.get_filename()

                is_image = (
                    part_ct.startswith('image/') or
                    (filename and any(
                        filename.lower().endswith(ext)
                        for ext in ['.jpg', '.jpeg', '.png', '.webp']
                    ))
                )

                if is_image:
                    image_bytes = part.get_payload(decode=True)
                    if image_bytes:
                        ext = detect_image_type(image_bytes)
                        return image_bytes, ext
    except Exception as e:
        logger.warning(f"Multipart parsing error: {e}")
        if is_image_data(body):
            return body, detect_image_type(body)

    return None, 'bin'


def extract_image_from_body(body: bytes, content_type: str) -> Tuple[Optional[bytes], str]:
    """
    Extract image bytes from a request body given its content type.
    """
    if content_type.startswith('multipart/form-data'):
        return parse_multipart_image(body, content_type)

    if is_image_data(body):
        return body, detect_image_type(body)

    if len(body) > 0 and is_image_data(body):
        return body, detect_image_type(body)

    return None, 'bin'


# ============================================================================
# Plex Write-Blocking Proxy Server with Upload Capture
# ============================================================================

class PlexProxyHandler(BaseHTTPRequestHandler):
    """
    HTTP proxy handler that forwards GET/HEAD to real Plex and blocks writes
    while CAPTURING the uploaded image data.

    This provides process-boundary-safe write blocking because Kometa
    (running as subprocess) connects to this proxy instead of real Plex.

    Mock Library Mode:
    When enabled (default when allowlist is present), listing endpoints
    return synthetic XML with only preview targets, without forwarding to
    real Plex. This prevents giant library enumeration.
    """

    # Class-level configuration (set before server starts)
    real_plex_url: str = ''
    real_plex_host: str = ''
    real_plex_port: int = 32400
    real_plex_scheme: str = 'http'
    plex_token: str = ''
    job_path: str = ''

    # Filtering configuration (set from preview config)
    allowed_rating_keys: Set[str] = set()
    filtering_enabled: bool = False

    # Mock library mode configuration
    mock_mode_enabled: bool = False
    preview_targets: List[Dict[str, Any]] = []

    # Metadata cache for learning parent relationships
    # Key: ratingKey, Value: dict of attributes from metadata response
    metadata_cache: Dict[str, Dict[str, str]] = {}
    # Dynamically learned parent ratingKeys (parents of allowed items)
    parent_rating_keys: Set[str] = set()

    # Captured data
    blocked_requests: List[Dict[str, str]] = []
    captured_uploads: List[Dict[str, Any]] = []
    filtered_requests: List[Dict[str, Any]] = []  # Track filtered listing requests
    mock_list_requests: List[Dict[str, Any]] = []  # Track mock mode requests
    request_log: List[Dict[str, Any]] = []  # Track all incoming requests
    data_lock = threading.Lock()

    # Counters for summary
    forward_request_count: int = 0
    blocked_metadata_count: int = 0
    sections_get_count: int = 0
    metadata_get_count: int = 0

    # H3/H4: Diagnostic tracking
    zero_match_searches: int = 0  # H4: Count of searches returning 0 items
    type_mismatches: List[Dict[str, Any]] = []  # H4: Track type mismatch detections

    def log_message(self, format, *args):
        """Override to use our logger"""
        logger.debug(f"PROXY: {args[0]}")

    def _record_request(self, method: str):
        """Record all incoming requests for diagnostics and traffic sanity checks."""
        path_base = self.path.split('?')[0]
        is_validation = self.headers.get('X-Preview-Validation', '') == '1'

        entry = {
            'method': method,
            'path': self.path,
            'path_base': path_base,
            'timestamp': datetime.now().isoformat(),
            'validation': is_validation,
        }

        with self.data_lock:
            self.request_log.append(entry)

            if not is_validation and method == 'GET':
                if path_base == '/library/sections':
                    self.sections_get_count += 1
                if path_base.startswith('/library/metadata/'):
                    self.metadata_get_count += 1

        logger.info(f"PROXY_REQUEST method={method} path={path_base}")

    def do_GET(self):
        """Forward GET requests to real Plex (or return synthetic XML in mock mode)"""
        self._record_request('GET')
        path = self.path
        path_base = path.split('?')[0]
        is_listing = is_listing_endpoint(path)
        is_meta = is_metadata_endpoint(path)
        is_sections = is_library_sections_endpoint(path)
        section_detail_id = is_library_section_detail_endpoint(path)
        children_parent = is_children_endpoint(path)

        logger.info(
            f"PROXY_GET path={path_base} is_listing={is_listing} "
            f"is_metadata={is_meta} is_sections={is_sections} "
            f"section_detail={section_detail_id is not None}"
        )

        # Mock library mode: return synthetic XML for listing endpoints
        if self.mock_mode_enabled and self.allowed_rating_keys:
            # Handle /library/sections endpoint
            if is_sections:
                self._handle_mock_sections()
                return

            # Handle /library/sections/{id} (specific section detail) - P0 libtype fix
            # This ensures Kometa sees the correct type (movie/show) instead of
            # whatever library happens to be at that ID on the real Plex server
            if section_detail_id:
                self._handle_mock_section_detail(section_detail_id)
                return

            # Handle listing endpoints (all, search, browse)
            if is_listing:
                self._handle_mock_listing(path)
                return

            # Handle /library/metadata/{id}/children endpoint
            if children_parent:
                # Check if parent is in our allowlist or is a parent of allowed items
                if children_parent in self.allowed_rating_keys or children_parent in self.parent_rating_keys:
                    self._handle_mock_children(children_parent)
                    return
                else:
                    # Block children requests for non-allowed parents
                    logger.info(f"BLOCK_CHILDREN parentRatingKey={children_parent} not allowed")
                    self._send_empty_container()
                    with self.data_lock:
                        self.blocked_metadata_count += 1
                    return

        # Not in mock mode or not a listing endpoint - use standard forwarding
        self._forward_request('GET')

    def do_HEAD(self):
        """Forward HEAD requests to real Plex"""
        self._record_request('HEAD')
        self._forward_request('HEAD')

    def do_POST(self):
        """Block POST requests and capture upload data"""
        self._record_request('POST')
        self._block_and_capture('POST')

    def do_PUT(self):
        """Block PUT requests and capture upload data"""
        self._record_request('PUT')
        self._block_and_capture('PUT')

    def do_PATCH(self):
        """Block PATCH requests"""
        self._record_request('PATCH')
        self._block_request('PATCH')

    def do_DELETE(self):
        """Block DELETE requests"""
        self._record_request('DELETE')
        self._block_request('DELETE')

    def _forward_request(self, method: str):
        """Forward a read request to the real Plex server, with optional filtering and caching"""
        try:
            path = self.path

            # Check if filtering is enabled and this is a filtered endpoint type
            should_filter_listing = (
                self.filtering_enabled and
                self.allowed_rating_keys and
                not self.mock_mode_enabled and  # Don't filter in mock mode (we don't forward)
                is_listing_endpoint(path)
            )

            should_block_metadata = (
                self.filtering_enabled and
                self.allowed_rating_keys and
                is_metadata_endpoint(path)
            )

            # Check if this is a metadata request that we should cache
            should_cache_metadata = (
                self.mock_mode_enabled and
                self.allowed_rating_keys and
                is_metadata_endpoint(path)
            )

            # If this is a metadata endpoint, check if it's allowed
            if should_block_metadata or should_cache_metadata:
                rating_key = extract_rating_key_from_path(path)

                # Allow if: in allowlist, or is a parent of allowed items
                is_allowed = (
                    rating_key in self.allowed_rating_keys or
                    rating_key in self.parent_rating_keys
                )

                if rating_key and not is_allowed:
                    logger.info(f"BLOCK_METADATA ratingKey={rating_key} not in allowlist")
                    self._send_empty_container()
                    with self.data_lock:
                        self.blocked_metadata_count += 1
                    return
                elif rating_key and is_allowed:
                    logger.info(f"ALLOW_FORWARD ratingKey={rating_key} endpoint={path.split('?')[0]}")

            # Create connection to real Plex
            if self.real_plex_scheme == 'https':
                context = ssl.create_default_context()
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE
                conn = http.client.HTTPSConnection(
                    self.real_plex_host,
                    self.real_plex_port,
                    context=context,
                    timeout=60
                )
            else:
                conn = http.client.HTTPConnection(
                    self.real_plex_host,
                    self.real_plex_port,
                    timeout=60
                )

            # Copy headers, preserving auth
            headers = {}
            for key, value in self.headers.items():
                if key.lower() not in ('host', 'connection', 'accept-encoding'):
                    headers[key] = value

            # Request uncompressed content to avoid decompression issues
            # This ensures we get plain XML that we can parse and cache safely
            headers['Accept-Encoding'] = 'identity'

            # Ensure X-Plex-Token is present
            if self.plex_token and 'x-plex-token' not in [k.lower() for k in headers.keys()]:
                headers['X-Plex-Token'] = self.plex_token

            conn.request(method, path, headers=headers)
            response = conn.getresponse()

            # Read full response body
            response_body = response.read()

            # Handle compressed responses (in case server ignores Accept-Encoding: identity)
            # Track if we decompressed so we can remove Content-Encoding header
            was_decompressed = False
            content_encoding = response.getheader('Content-Encoding', '').lower()
            if content_encoding == 'gzip':
                try:
                    import gzip
                    response_body = gzip.decompress(response_body)
                    was_decompressed = True
                    logger.debug(f"Decompressed gzip response for {path}")
                except Exception as e:
                    logger.warning(f"Failed to decompress gzip response: {e}")
            elif content_encoding == 'deflate':
                try:
                    import zlib
                    response_body = zlib.decompress(response_body)
                    was_decompressed = True
                    logger.debug(f"Decompressed deflate response for {path}")
                except Exception as e:
                    logger.warning(f"Failed to decompress deflate response: {e}")

            # Track forward count
            with self.data_lock:
                self.forward_request_count += 1

            logger.info(
                f"FORWARDED method={method} path={path.split('?')[0]} status={response.status}"
            )

            # Cache metadata response for parent relationship learning
            if should_cache_metadata and response.status == 200 and rating_key:
                self._cache_metadata_response(rating_key, response_body)

            # Filter listing responses if enabled (non-mock mode only)
            if should_filter_listing and response.status == 200:
                content_type = response.getheader('Content-Type', '')

                # Only filter XML responses
                if 'xml' in content_type.lower() or response_body.strip().startswith(b'<'):
                    original_size = len(response_body)

                    # Count items before filtering for accurate logging
                    try:
                        import xml.etree.ElementTree as ET
                        root = ET.fromstring(response_body)
                        original_item_count = sum(
                            1 for child in root if child.get('ratingKey') is not None
                        )
                    except Exception:
                        original_item_count = -1

                    filtered_body = filter_media_container_xml(
                        response_body, self.allowed_rating_keys
                    )

                    # Count items after filtering
                    try:
                        filtered_root = ET.fromstring(filtered_body)
                        filtered_item_count = sum(
                            1 for child in filtered_root if child.get('ratingKey') is not None
                        )
                    except Exception:
                        filtered_item_count = -1

                    # Log the filtering with item counts
                    logger.info(
                        f"FILTER_LIST endpoint={path.split('?')[0]} "
                        f"items_before={original_item_count} items_after={filtered_item_count} "
                        f"allowed_keys={len(self.allowed_rating_keys)}"
                    )

                    # Track filtered request
                    with self.data_lock:
                        self.filtered_requests.append({
                            'path': path,
                            'method': method,
                            'original_bytes': original_size,
                            'filtered_bytes': len(filtered_body),
                            'original_items': original_item_count,
                            'filtered_items': filtered_item_count,
                            'timestamp': datetime.now().isoformat()
                        })

                    response_body = filtered_body
                else:
                    logger.warning(
                        f"FILTER_SKIP_NON_XML endpoint={path.split('?')[0]} "
                        f"content_type={content_type}"
                    )
            elif should_filter_listing:
                logger.warning(
                    f"FILTER_SKIP_STATUS endpoint={path.split('?')[0]} "
                    f"status={response.status}"
                )

            # Send response
            self.send_response(response.status)

            # Copy headers but update Content-Length for filtered responses
            # Exclude Content-Encoding if we decompressed the response
            excluded_headers = {'transfer-encoding', 'connection'}
            if was_decompressed:
                excluded_headers.add('content-encoding')

            for key, value in response.getheaders():
                if key.lower() == 'content-length':
                    self.send_header('Content-Length', str(len(response_body)))
                elif key.lower() not in excluded_headers:
                    self.send_header(key, value)

            self.end_headers()
            self.wfile.write(response_body)

            conn.close()

        except Exception as e:
            logger.error(f"PROXY ERROR forwarding {method} {self.path}: {e}")
            self.send_error(502, f"Proxy error: {e}")

    def _send_empty_container(self):
        """Send an empty MediaContainer response (used for blocked metadata)"""
        response_body = create_empty_media_container_xml()
        self.send_response(200)
        self.send_header('Content-Type', 'text/xml; charset=utf-8')
        self.send_header('Content-Length', str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _send_xml_response(self, xml_bytes: bytes):
        """Send an XML response."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/xml; charset=utf-8')
        self.send_header('Content-Length', str(len(xml_bytes)))
        self.end_headers()
        self.wfile.write(xml_bytes)

    def _handle_mock_sections(self):
        """Handle /library/sections in mock mode - return synthetic sections."""
        xml_bytes = build_synthetic_library_sections_xml(self.preview_targets)

        # Debug logging
        if DEBUG_MOCK_XML:
            logger.debug(f"MOCK_SECTIONS_XML: {xml_bytes[:500].decode('utf-8', errors='replace')}")

        # Parse to count sections
        try:
            root = ET.fromstring(xml_bytes)
            section_count = len(list(root))
        except Exception:
            section_count = -1

        logger.info(f"MOCK_SECTIONS returned_sections={section_count}")

        with self.data_lock:
            self.mock_list_requests.append({
                'path': '/library/sections',
                'type': 'sections',
                'returned_items': section_count,
                'timestamp': datetime.now().isoformat()
            })

        self._send_xml_response(xml_bytes)

    def _handle_mock_section_detail(self, section_id: str):
        """
        Handle /library/sections/{id} in mock mode - return synthetic section detail.

        P0 Fix: This ensures Kometa sees the correct library type (movie/show)
        instead of whatever library is at that ID on the real Plex server.
        Fixes "Unknown libtype 'movie' ... Available libtypes: ['collection']" error.
        """
        xml_bytes = build_synthetic_section_detail_xml(section_id, self.preview_targets)

        # Debug logging
        if DEBUG_MOCK_XML:
            logger.debug(f"MOCK_SECTION_DETAIL_XML: {xml_bytes[:500].decode('utf-8', errors='replace')}")

        # Parse to get section type
        section_type = 'unknown'
        try:
            root = ET.fromstring(xml_bytes)
            directory = root.find('Directory')
            if directory is not None:
                section_type = directory.get('type', 'unknown')
        except Exception:
            pass

        logger.info(f"MOCK_SECTION_DETAIL section_id={section_id} type={section_type}")

        with self.data_lock:
            self.mock_list_requests.append({
                'path': f'/library/sections/{section_id}',
                'type': 'section_detail',
                'section_id': section_id,
                'section_type': section_type,
                'timestamp': datetime.now().isoformat()
            })

        self._send_xml_response(xml_bytes)

    def _handle_mock_listing(self, path: str):
        """Handle listing endpoints in mock mode - return synthetic item list."""
        section_id = extract_section_id(path)
        query = extract_search_query(path)

        xml_bytes = build_synthetic_listing_xml(
            self.preview_targets,
            section_id=section_id,
            query=query,
            metadata_cache=self.metadata_cache
        )

        # Debug logging
        if DEBUG_MOCK_XML:
            logger.debug(f"MOCK_LIST_XML: {xml_bytes[:500].decode('utf-8', errors='replace')}")

        # Parse to count items
        try:
            root = ET.fromstring(xml_bytes)
            item_count = int(root.get('size', '0'))
        except Exception:
            item_count = -1

        path_base = path.split('?')[0]
        logger.info(f"MOCK_LIST endpoint={path_base} returned_items={item_count}")

        # H3/H4: Track zero-match searches for diagnostic summary
        if item_count == 0 and query:
            with self.data_lock:
                self.zero_match_searches += 1
            logger.warning(f"ZERO_MATCH_SEARCH query={query} endpoint={path_base}")

        with self.data_lock:
            self.mock_list_requests.append({
                'path': path,
                'type': 'listing',
                'section_id': section_id,
                'query': query,
                'returned_items': item_count,
                'timestamp': datetime.now().isoformat()
            })

        self._send_xml_response(xml_bytes)

    def _handle_mock_children(self, parent_rating_key: str):
        """Handle /library/metadata/{id}/children in mock mode."""
        xml_bytes = build_synthetic_children_xml(
            parent_rating_key,
            self.preview_targets,
            metadata_cache=self.metadata_cache
        )

        # Debug logging
        if DEBUG_MOCK_XML:
            logger.debug(f"MOCK_CHILDREN_XML: {xml_bytes[:500].decode('utf-8', errors='replace')}")

        # Parse to count children
        try:
            root = ET.fromstring(xml_bytes)
            child_count = int(root.get('size', '0'))
        except Exception:
            child_count = -1

        logger.info(f"MOCK_CHILDREN parentRatingKey={parent_rating_key} returned_items={child_count}")

        with self.data_lock:
            self.mock_list_requests.append({
                'path': f'/library/metadata/{parent_rating_key}/children',
                'type': 'children',
                'parent_rating_key': parent_rating_key,
                'returned_items': child_count,
                'timestamp': datetime.now().isoformat()
            })

        self._send_xml_response(xml_bytes)

    def _cache_metadata_response(self, rating_key: str, response_body: bytes):
        """
        Cache metadata response and learn parent relationships.

        When we forward a metadata request for an allowed item, we cache the
        response to learn parent/grandparent ratingKey relationships.

        Validation rules:
        1. Response must be non-empty
        2. Response must start with '<' (XML)
        3. Response must parse as valid XML
        4. Response should contain MediaContainer element
        """
        # Validation: Check for empty response
        if not response_body or len(response_body) == 0:
            logger.warning(f"CACHE_METADATA_SKIP ratingKey={rating_key}: empty response")
            return

        # Validation: Check response starts with XML
        response_stripped = response_body.strip()
        if not response_stripped.startswith(b'<'):
            # Log first bytes for debugging (safely)
            first_bytes = response_body[:120].decode('utf-8', errors='replace')
            logger.warning(
                f"CACHE_METADATA_SKIP ratingKey={rating_key}: "
                f"not XML (starts with: {repr(first_bytes[:60])})"
            )
            return

        # Validation: Quick check for MediaContainer
        if b'MediaContainer' not in response_body and b'mediacontainer' not in response_body.lower():
            first_bytes = response_body[:120].decode('utf-8', errors='replace')
            logger.warning(
                f"CACHE_METADATA_SKIP ratingKey={rating_key}: "
                f"no MediaContainer (content: {repr(first_bytes[:60])})"
            )
            return

        try:
            root = ET.fromstring(response_body)

            # Validation: Verify root is MediaContainer
            if root.tag != 'MediaContainer':
                logger.warning(
                    f"CACHE_METADATA_SKIP ratingKey={rating_key}: "
                    f"root element is {root.tag}, expected MediaContainer"
                )
                return

            # Find the main item element (Video, Directory, etc.)
            item = None
            for child in root:
                if child.get('ratingKey') == rating_key:
                    item = child
                    break

            if item is None and len(list(root)) > 0:
                # Sometimes the item is the root's first child
                item = list(root)[0]

            if item is not None:
                # Cache the attributes
                cached_attrs = dict(item.attrib)

                with self.data_lock:
                    self.metadata_cache[rating_key] = cached_attrs

                    # Learn parent relationships
                    parent_key = cached_attrs.get('parentRatingKey')
                    grandparent_key = cached_attrs.get('grandparentRatingKey')

                    if parent_key and parent_key not in self.allowed_rating_keys:
                        self.parent_rating_keys.add(parent_key)
                        logger.info(f"LEARNED_PARENT ratingKey={rating_key} parentRatingKey={parent_key}")

                    if grandparent_key and grandparent_key not in self.allowed_rating_keys:
                        self.parent_rating_keys.add(grandparent_key)
                        logger.info(f"LEARNED_GRANDPARENT ratingKey={rating_key} grandparentRatingKey={grandparent_key}")

                logger.debug(f"CACHED_METADATA ratingKey={rating_key} type={cached_attrs.get('type')}")
            else:
                logger.debug(f"CACHE_METADATA_NO_ITEM ratingKey={rating_key}: no matching item found")

        except ET.ParseError as e:
            # Log detailed debug info for parse errors
            first_bytes = response_body[:120].decode('utf-8', errors='replace')
            logger.warning(
                f"CACHE_METADATA_PARSE_ERROR ratingKey={rating_key}: {e} "
                f"(content_length={len(response_body)}, starts_with={repr(first_bytes[:60])})"
            )
        except Exception as e:
            logger.warning(f"CACHE_METADATA_ERROR ratingKey={rating_key}: {e}")

    def _block_request(self, method: str):
        """Block a write request without capturing (for DELETE/PATCH)"""
        blocked_entry = {
            'method': method,
            'path': self.path,
            'timestamp': datetime.now().isoformat()
        }

        with self.data_lock:
            self.blocked_requests.append(blocked_entry)

        logger.warning(f"BLOCKED_WRITE: {method} {self.path}")

        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'{}')

    def _block_and_capture(self, method: str):
        """
        Block a write request and capture any uploaded image data.

        Enhanced capture logic (P0 fix):
        - Captures any PUT/POST with image content
        - Handles various upload paths including /photo/:/transcode
        - Logs all write requests for debugging
        - Saves image payloads with deterministic filenames
        """
        timestamp = datetime.now().isoformat()
        timestamp_safe = datetime.now().strftime('%Y%m%d_%H%M%S_%f')

        # Read request body
        content_length = int(self.headers.get('Content-Length', '0'))
        content_type = self.headers.get('Content-Type', '')
        body = self.rfile.read(content_length) if content_length > 0 else b''

        # Parse ratingKey and kind from path
        rating_key, kind = self._parse_upload_path(self.path)

        # Log detailed request info for debugging
        logger.debug(
            f"WRITE_REQUEST: {method} {self.path} "
            f"content_length={content_length} content_type={content_type} "
            f"parsed_ratingKey={rating_key} parsed_kind={kind}"
        )

        # Log the blocked request
        blocked_entry = {
            'method': method,
            'path': self.path,
            'timestamp': timestamp,
            'rating_key': rating_key,
            'kind': kind,
            'content_length': content_length,
            'content_type': content_type,
        }

        capture_record: Dict[str, Any] = {
            'rating_key': rating_key,
            'method': method,
            'path': self.path,
            'kind': kind,
            'timestamp': timestamp,
            'size_bytes': content_length,
            'content_type': content_type,
            'saved_path': None,
            'parse_error': None
        }

        # Try to extract and save the image
        if content_length > 0:
            try:
                image_bytes, ext = self._extract_image_from_body(body)
                if image_bytes:
                    # Use rating_key if found, otherwise save with 'unknown' prefix
                    save_key = rating_key or 'unknown'
                    saved_path = self._save_captured_image(
                        save_key, kind, image_bytes, ext, timestamp_safe
                    )
                    capture_record['saved_path'] = saved_path
                    capture_record['size_bytes'] = len(image_bytes)
                    logger.info(
                        f"UPLOAD_CAPTURED ratingKey={save_key} path={self.path.split('?')[0]} "
                        f"content_type={content_type} bytes={len(image_bytes)} saved={saved_path}"
                    )
                else:
                    capture_record['parse_error'] = 'No image data found in body'
                    logger.warning(
                        f"UPLOAD_IGNORED: {method} {self.path.split('?')[0]} "
                        f"reason=no_image_data content_type={content_type} "
                        f"content_length={content_length}"
                    )
                    # Save raw body for debugging
                    self._save_debug_body(rating_key or 'unknown', kind, body, timestamp_safe)
            except Exception as e:
                capture_record['parse_error'] = str(e)
                logger.error(
                    f"UPLOAD_CAPTURE_ERROR: {method} {self.path.split('?')[0]} "
                    f"ratingKey={rating_key} error={e}"
                )
                # Save raw body for debugging
                self._save_debug_body(rating_key or 'unknown', kind, body, timestamp_safe)
        elif not rating_key:
            # No body and no ratingKey
            logger.debug(f"BLOCKED_WRITE (no body, unknown path): {method} {self.path}")
        else:
            # Has ratingKey but no body (could be a delete or metadata update)
            logger.debug(f"BLOCKED_WRITE (no body): {method} {self.path}")

        with self.data_lock:
            self.blocked_requests.append(blocked_entry)
            self.captured_uploads.append(capture_record)

        # Return success to keep Kometa happy
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'{}')

    def _parse_upload_path(self, path: str) -> Tuple[Optional[str], str]:
        """
        Parse ratingKey and upload kind from Plex API path.

        Enhanced to handle various upload paths Kometa may use:
        - /library/metadata/<ratingKey>/posters
        - /library/metadata/<ratingKey>/poster
        - /library/metadata/<ratingKey>/arts
        - /library/metadata/<ratingKey>/thumbs
        - /photo/:/transcode with ratingKey in query
        - /:/upload with key parameter

        Returns: (ratingKey or None, kind)
        """
        path_base = path.split('?')[0]

        # Try standard upload pattern first
        match = PLEX_UPLOAD_PATTERN.match(path_base)
        if match:
            rating_key = match.group(1)
            kind_raw = match.group(2)
            # Normalize: posters->poster, arts->art, thumbs->thumb
            kind = kind_raw.rstrip('s')
            return rating_key, kind

        # Extract kind from path if possible
        kind = 'poster'  # Default
        if '/art' in path_base:
            kind = 'art'
        elif '/thumb' in path_base:
            kind = 'thumb'

        # Try to extract ratingKey from various patterns
        for pattern in RATING_KEY_EXTRACT_PATTERNS:
            match = pattern.search(path)
            if match:
                return match.group(1), kind

        # Fallback: try to find any numeric ID in path
        fallback_match = re.search(r'/(\d+)/', path)
        if fallback_match:
            return fallback_match.group(1), kind

        # Log that we couldn't parse the path
        logger.debug(f"UPLOAD_PATH_PARSE_FAILED: {path}")
        return None, 'unknown'

    def _extract_image_from_body(self, body: bytes) -> Tuple[Optional[bytes], str]:
        """
        Extract image bytes from request body.

        Handles:
        - multipart/form-data (most common for Plex uploads)
        - Raw image data (direct upload)

        Returns: (image_bytes or None, extension)
        """
        content_type = self.headers.get('Content-Type', '')
        return extract_image_from_body(body, content_type)

    def _parse_multipart(self, body: bytes, content_type: str) -> Tuple[Optional[bytes], str]:
        """Parse multipart/form-data and extract first image part."""
        return parse_multipart_image(body, content_type)

    def _is_image_data(self, data: bytes) -> bool:
        """Check if bytes represent an image by magic bytes."""
        return is_image_data(data)

    def _detect_image_type(self, data: bytes) -> str:
        """Detect image type from magic bytes."""
        return detect_image_type(data)

    def _save_captured_image(
        self,
        rating_key: str,
        kind: str,
        image_bytes: bytes,
        ext: str,
        timestamp: str
    ) -> str:
        """Save captured image to the previews directory."""
        if not self.job_path:
            logger.error("job_path not set on handler!")
            return ''

        output_dir = Path(self.job_path) / 'output' / 'previews'
        output_dir.mkdir(parents=True, exist_ok=True)

        # Filename: <ratingKey>__<kind>.<ext> (deterministic)
        safe_kind = kind or 'poster'
        filename = f"{rating_key}__{safe_kind}.{ext}"
        output_path = output_dir / filename

        with open(output_path, 'wb') as f:
            f.write(image_bytes)

        return str(output_path)

    def _save_debug_body(
        self,
        rating_key: str,
        kind: str,
        body: bytes,
        timestamp: str
    ):
        """Save raw request body for debugging."""
        if not self.job_path:
            return

        debug_dir = Path(self.job_path) / 'output' / 'captured_requests'
        debug_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{rating_key}_{kind}_{timestamp}.bin"
        output_path = debug_dir / filename

        with open(output_path, 'wb') as f:
            f.write(body)

        logger.debug(f"Saved debug body to: {output_path}")


# ============================================================================
# TMDb API Proxy for Fast Mode (Caps External ID Expansions)
# ============================================================================

# TMDb endpoints that return paginated results and should be capped
TMDB_PAGINATED_ENDPOINTS = [
    '/discover/movie',
    '/discover/tv',
    '/trending/movie/',
    '/trending/tv/',
    '/trending/all/',
    '/movie/popular',
    '/movie/top_rated',
    '/movie/now_playing',
    '/movie/upcoming',
    '/tv/popular',
    '/tv/top_rated',
    '/tv/on_the_air',
    '/tv/airing_today',
    '/search/movie',
    '/search/tv',
    '/search/multi',
]

# TMDb list-like endpoints that return many IDs
TMDB_LIST_ENDPOINTS = [
    '/list/',
    '/keyword/',
    '/genre/',
    '/network/',
    '/company/',
]


class TMDbProxyHandler(BaseHTTPRequestHandler):
    """
    HTTP proxy handler that intercepts TMDb API calls and caps results in FAST mode.

    In FAST mode:
    - Paginated endpoints are capped to PREVIEW_EXTERNAL_ID_LIMIT results
    - total_pages is set to 1 to prevent pagination
    - total_results reflects actual returned count (not original)
    - Identical requests are deduplicated using fingerprint-based caching
    - Non-overlay discover requests are suppressed (return empty results)

    In ACCURATE mode:
    - All requests are passed through unchanged
    """

    # Class-level configuration
    fast_mode: bool = True
    id_limit: int = 25
    pages_limit: int = 1
    capped_requests: List[Dict[str, Any]] = []
    total_requests: int = 0
    cache_hits: int = 0
    skipped_non_overlay: int = 0
    skipped_tvdb_conversions: int = 0  # H1: Track skipped TMDb → TVDb conversions
    tvdb_skip_logged: bool = False  # H1: Track if we've logged the skip message
    data_lock = threading.Lock()

    # Request deduplication cache: fingerprint -> (response_body, status_code, headers)
    request_cache: Dict[str, Tuple[bytes, int, List[Tuple[str, str]]]] = {}

    def log_message(self, format, *args):
        """Override to use our logger"""
        logger.debug(f"TMDB_PROXY: {args[0]}")

    def do_GET(self):
        """Forward GET requests to TMDb API, capping results in FAST mode"""
        self._handle_request('GET')

    def do_POST(self):
        """Forward POST requests to TMDb API"""
        self._handle_request('POST')

    def do_HEAD(self):
        """Forward HEAD requests to TMDb API"""
        self._handle_request('HEAD')

    def _handle_request(self, method: str):
        """Handle a request to TMDb API"""
        try:
            # Parse the target URL from the request
            path = self.path

            # Increment request counter
            with self.data_lock:
                self.total_requests += 1

            # Check if this is a paginated endpoint that should be capped
            should_cap = self.fast_mode and self._is_paginated_endpoint(path)

            # G2: In FAST mode, skip discover requests for non-overlay contexts
            # (collections, charts, defaults builders)
            if self.fast_mode and self._is_non_overlay_discover(path):
                logger.info(f"FAST_PREVIEW: skipped TMDb discover for non-overlay context: {path.split('?')[0]}")
                with self.data_lock:
                    self.skipped_non_overlay += 1
                # Return empty results
                self._send_empty_tmdb_response()
                return

            # H1: In FAST mode, skip TMDb → TVDb conversion requests (external_ids for TV shows)
            if self.fast_mode and self._is_tvdb_conversion_request(path):
                with self.data_lock:
                    self.skipped_tvdb_conversions += 1
                    # Log once per run (not per item)
                    if not self.tvdb_skip_logged:
                        logger.info("FAST_PREVIEW: skipped TMDb→TVDb conversions (external_ids)")
                        self.tvdb_skip_logged = True
                # Return empty external_ids response
                self._send_empty_external_ids_response()
                return

            # G1: Check deduplication cache
            fingerprint = self._compute_request_fingerprint(method, path)
            with self.data_lock:
                if fingerprint in self.request_cache:
                    response_body, status_code, headers = self.request_cache[fingerprint]
                    self.cache_hits += 1
                    logger.info(f"TMDB_CACHE_HIT: {path.split('?')[0]} (fingerprint={fingerprint[:12]})")

                    # Send cached response
                    self.send_response(status_code)
                    for key, value in headers:
                        if key.lower() == 'content-length':
                            self.send_header('Content-Length', str(len(response_body)))
                        elif key.lower() not in ('transfer-encoding', 'connection'):
                            self.send_header(key, value)
                    self.end_headers()
                    self.wfile.write(response_body)
                    return

            # Forward request to TMDb
            response_body, status_code, headers = self._forward_to_tmdb(method, path)

            # Cap results if in FAST mode and this is a paginated endpoint
            if should_cap and status_code == 200:
                original_body = response_body
                response_body, was_capped = self._cap_tmdb_response(response_body, path)

                if was_capped:
                    # Log the capping
                    try:
                        import json
                        original_data = json.loads(original_body)
                        capped_data = json.loads(response_body)
                        original_total = original_data.get('total_results', len(original_data.get('results', [])))
                        capped_count = len(capped_data.get('results', []))

                        logger.info(
                            f"FAST_PREVIEW: capped TMDb {path.split('?')[0]} results "
                            f"from {original_total} -> {capped_count}"
                        )

                        with self.data_lock:
                            self.capped_requests.append({
                                'path': path.split('?')[0],
                                'original_total': original_total,
                                'capped_to': capped_count,
                                'timestamp': datetime.now().isoformat()
                            })
                    except Exception:
                        pass

            # G1: Store in deduplication cache (use fingerprint computed earlier)
            # Cache both capped and uncapped successful responses
            if status_code == 200:
                # Build headers list without transfer-encoding and connection
                cached_headers = [(k, v) for k, v in headers if k.lower() not in ('transfer-encoding', 'connection')]
                with self.data_lock:
                    self.request_cache[fingerprint] = (response_body, status_code, cached_headers)

            # Send response
            self.send_response(status_code)

            # Copy headers, adjusting Content-Length
            for key, value in headers:
                if key.lower() == 'content-length':
                    self.send_header('Content-Length', str(len(response_body)))
                elif key.lower() not in ('transfer-encoding', 'connection'):
                    self.send_header(key, value)

            self.end_headers()
            self.wfile.write(response_body)

        except Exception as e:
            logger.error(f"TMDB_PROXY ERROR: {method} {self.path}: {e}")
            self.send_error(502, f"TMDb proxy error: {e}")

    def _is_paginated_endpoint(self, path: str) -> bool:
        """Check if this is a paginated TMDb endpoint that should be capped"""
        path_base = path.split('?')[0]

        for endpoint in TMDB_PAGINATED_ENDPOINTS:
            if endpoint in path_base:
                return True

        for endpoint in TMDB_LIST_ENDPOINTS:
            if endpoint in path_base:
                return True

        return False

    def _compute_request_fingerprint(self, method: str, path: str) -> str:
        """
        Compute a stable fingerprint for request deduplication.

        G1: Fingerprint is based on:
        - HTTP method
        - Endpoint path (without query string)
        - Query params (sorted alphabetically)
        """
        import hashlib
        from urllib.parse import urlparse, parse_qs

        # Parse path and query
        parsed = urlparse(path)
        path_base = parsed.path
        query_params = parse_qs(parsed.query)

        # Sort query params for stable fingerprint
        # Convert lists to tuples and sort by key
        sorted_params = sorted(
            ((k, tuple(sorted(v))) for k, v in query_params.items()),
            key=lambda x: x[0]
        )

        # Create fingerprint string
        fingerprint_str = f"{method}:{path_base}:{sorted_params}"

        # Return hash for compact representation
        return hashlib.md5(fingerprint_str.encode()).hexdigest()

    def _is_non_overlay_discover(self, path: str) -> bool:
        """
        G2: Detect if this is a discover request for non-overlay contexts.

        In FAST mode, we suppress discover requests that are triggered by:
        - Collections builders
        - Charts/trending builders (unless used for overlays)
        - Defaults builders

        These are detected by checking for specific query patterns that indicate
        the request is for building collections rather than evaluating overlays.
        """
        path_base = path.split('?')[0]

        # Only check discover endpoints
        if '/discover/' not in path_base:
            return False

        # Check query parameters for non-overlay indicators
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(path)
        query_params = parse_qs(parsed.query)

        # Indicators of collection/chart builders (non-overlay contexts):
        # - with_genres (genre collections)
        # - with_keywords (keyword collections)
        # - certification (certification collections)
        # - with_runtime (runtime collections)
        # - vote_count.gte with high threshold (popularity charts)
        # - primary_release_date (decade/year collections)

        non_overlay_indicators = [
            'with_genres',
            'with_keywords',
            'certification',
            'certification_country',
            'with_runtime',
            'with_companies',
            'with_networks',
            'with_people',
            'with_cast',
            'with_crew',
        ]

        # If any of these query params are present with values,
        # this is likely a collection builder, not an overlay evaluation
        for indicator in non_overlay_indicators:
            if indicator in query_params and query_params[indicator]:
                return True

        # High vote_count threshold suggests a chart/popularity builder
        vote_count_gte = query_params.get('vote_count.gte', ['0'])[0]
        try:
            if int(vote_count_gte) >= 100:
                # This looks like a chart builder (e.g., "popular movies")
                return True
        except ValueError:
            pass

        return False

    def _send_empty_tmdb_response(self):
        """
        G2: Send an empty TMDb response for suppressed discover requests.

        Returns a valid paginated response with empty results, so Kometa
        can continue without error.
        """
        import json

        empty_response = {
            'page': 1,
            'results': [],
            'total_pages': 1,
            'total_results': 0
        }

        response_body = json.dumps(empty_response).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json;charset=utf-8')
        self.send_header('Content-Length', str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _is_tvdb_conversion_request(self, path: str) -> bool:
        """
        H1: Detect if this is a TMDb → TVDb ID conversion request.

        In FAST mode, we skip these because:
        - TV show external_ids lookups are used to get TVDb IDs
        - TVDb ID lookups add significant latency (external API calls)
        - Overlays typically don't require TVDb IDs for preview rendering

        Returns True for:
        - /tv/{id}/external_ids - TV show external IDs (includes tvdb_id)
        - /find/{external_id}?external_source=tvdb_id - TVDb → TMDb lookups
        """
        path_base = path.split('?')[0]

        # Match /tv/{id}/external_ids
        if '/tv/' in path_base and '/external_ids' in path_base:
            return True

        # Match /find/ with tvdb_id source
        if '/find/' in path_base:
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(path)
            query_params = parse_qs(parsed.query)
            external_source = query_params.get('external_source', [''])[0]
            if external_source == 'tvdb_id':
                return True

        return False

    def _send_empty_external_ids_response(self):
        """
        H1: Send an empty external_ids response for suppressed conversion requests.

        Returns a valid external_ids response with null TVDb ID, so Kometa
        can continue without error but won't attempt further TVDb operations.
        """
        import json

        # Empty external_ids response structure
        empty_response = {
            'id': None,
            'imdb_id': None,
            'freebase_mid': None,
            'freebase_id': None,
            'tvdb_id': None,
            'tvrage_id': None,
            'wikidata_id': None,
            'facebook_id': None,
            'instagram_id': None,
            'twitter_id': None
        }

        response_body = json.dumps(empty_response).encode('utf-8')

        self.send_response(200)
        self.send_header('Content-Type', 'application/json;charset=utf-8')
        self.send_header('Content-Length', str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def _forward_to_tmdb(self, method: str, path: str) -> Tuple[bytes, int, List[Tuple[str, str]]]:
        """Forward request to real TMDb API"""
        # TMDb API host
        host = 'api.themoviedb.org'
        port = 443

        # Create HTTPS connection
        context = ssl.create_default_context()
        conn = http.client.HTTPSConnection(host, port, context=context, timeout=30)

        # Copy headers
        headers = {}
        for key, value in self.headers.items():
            if key.lower() not in ('host', 'connection'):
                headers[key] = value
        headers['Host'] = host

        # Read request body for POST
        body = None
        if method == 'POST':
            content_length = int(self.headers.get('Content-Length', '0'))
            if content_length > 0:
                body = self.rfile.read(content_length)

        # Make request
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()

        # Read response
        response_body = response.read()
        status_code = response.status
        response_headers = response.getheaders()

        conn.close()

        return response_body, status_code, response_headers

    def _cap_tmdb_response(self, response_body: bytes, path: str) -> Tuple[bytes, bool]:
        """
        Cap TMDb response results to the configured limit.

        Returns: (capped_body, was_capped)
        """
        try:
            import json
            data = json.loads(response_body)

            # Check if this is a paginated response
            if 'results' not in data:
                return response_body, False

            results = data.get('results', [])
            original_count = len(results)

            # Only cap if we have more results than the limit
            if original_count <= self.id_limit:
                return response_body, False

            # Cap results
            data['results'] = results[:self.id_limit]

            # Update pagination info
            data['total_results'] = len(data['results'])
            data['total_pages'] = self.pages_limit
            if 'page' in data:
                data['page'] = 1

            return json.dumps(data).encode('utf-8'), True

        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.warning(f"TMDB_CAP_ERROR: Could not parse response for capping: {e}")
            return response_body, False


class TMDbProxy:
    """
    Manages the TMDb API proxy for capping external ID expansions in FAST mode.
    """

    def __init__(self, fast_mode: bool = True, id_limit: int = 25, pages_limit: int = 1):
        self.fast_mode = fast_mode
        self.id_limit = id_limit
        self.pages_limit = pages_limit
        self.server: Optional[HTTPServer] = None
        self.server_thread: Optional[threading.Thread] = None

        # Configure the handler class
        TMDbProxyHandler.fast_mode = fast_mode
        TMDbProxyHandler.id_limit = id_limit
        TMDbProxyHandler.pages_limit = pages_limit
        TMDbProxyHandler.capped_requests = []
        TMDbProxyHandler.total_requests = 0
        # G1/G2: Initialize deduplication cache and counters
        TMDbProxyHandler.cache_hits = 0
        TMDbProxyHandler.skipped_non_overlay = 0
        TMDbProxyHandler.request_cache = {}
        TMDbProxyHandler.skipped_tvdb_conversions = 0
        TMDbProxyHandler.tvdb_skip_logged = False

    @property
    def proxy_url(self) -> str:
        """URL for the TMDb proxy"""
        return f"http://{PROXY_HOST}:{TMDB_PROXY_PORT}"

    def start(self):
        """Start the TMDb proxy server in a background thread"""
        self.server = HTTPServer((PROXY_HOST, TMDB_PROXY_PORT), TMDbProxyHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()

        mode_str = "FAST (capping enabled)" if self.fast_mode else "ACCURATE (pass-through)"
        logger.info(f"TMDb proxy started at {self.proxy_url}")
        logger.info(f"  Mode: {mode_str}")
        if self.fast_mode:
            logger.info(f"  ID limit: {self.id_limit}")
            logger.info(f"  Pages limit: {self.pages_limit}")

    def stop(self):
        """Stop the TMDb proxy server"""
        if self.server:
            self.server.shutdown()
            logger.info("TMDb proxy stopped")

    def get_capped_requests(self) -> List[Dict[str, Any]]:
        """Return list of capped requests"""
        with TMDbProxyHandler.data_lock:
            return TMDbProxyHandler.capped_requests.copy()

    def get_total_requests(self) -> int:
        """Return total number of requests"""
        with TMDbProxyHandler.data_lock:
            return TMDbProxyHandler.total_requests

    def get_cache_hits(self) -> int:
        """G1: Return number of deduplicated (cached) requests"""
        with TMDbProxyHandler.data_lock:
            return TMDbProxyHandler.cache_hits

    def get_skipped_non_overlay(self) -> int:
        """G2: Return number of skipped non-overlay discover requests"""
        with TMDbProxyHandler.data_lock:
            return TMDbProxyHandler.skipped_non_overlay

    def get_stats(self) -> Dict[str, Any]:
        """Return comprehensive statistics for the TMDb proxy"""
        with TMDbProxyHandler.data_lock:
            return {
                'fast_mode': self.fast_mode,
                'id_limit': self.id_limit,
                'pages_limit': self.pages_limit,
                'total_requests': TMDbProxyHandler.total_requests,
                'capped_requests_count': len(TMDbProxyHandler.capped_requests),
                'capped_requests': TMDbProxyHandler.capped_requests.copy(),
                'cache_hits': TMDbProxyHandler.cache_hits,
                'skipped_non_overlay': TMDbProxyHandler.skipped_non_overlay,
                'skipped_tvdb_conversions': TMDbProxyHandler.skipped_tvdb_conversions,  # H1
                'cache_size': len(TMDbProxyHandler.request_cache),
            }


class PlexProxy:
    """
    Manages the Plex write-blocking proxy server with upload capture and optional filtering.

    Mock Library Mode (default when allowlist is present):
    - Listing endpoints return synthetic XML with only preview targets
    - Does NOT forward listing requests to real Plex (avoids giant responses)
    - Metadata requests are only forwarded for allowed ratingKeys and their parents
    - Parent relationships are learned dynamically from forwarded metadata

    Filtering Mode (legacy, when PREVIEW_MOCK_LIBRARY=0):
    - When allowed_rating_keys is provided, the proxy filters library listing endpoints
      to only include items with those ratingKeys
    - Metadata endpoints for non-allowed ratingKeys return empty containers
    - This dramatically reduces Kometa's processing scope (e.g., 5 items vs 2000+)
    """

    def __init__(
        self,
        real_plex_url: str,
        plex_token: str,
        job_path: Path,
        allowed_rating_keys: Optional[Set[str]] = None,
        preview_targets: Optional[List[Dict[str, Any]]] = None
    ):
        self.real_plex_url = real_plex_url.rstrip('/')
        self.plex_token = plex_token
        self.job_path = job_path
        self.allowed_rating_keys = allowed_rating_keys or set()
        self.preview_targets = preview_targets or []

        # Parse the real Plex URL
        parsed = urlparse(real_plex_url)
        self.real_host = parsed.hostname or 'localhost'
        self.real_port = parsed.port or 32400
        self.real_scheme = parsed.scheme or 'http'

        self.server: Optional[HTTPServer] = None
        self.server_thread: Optional[threading.Thread] = None

        # Determine if mock mode should be enabled
        # Enabled by default when we have allowlist and MOCK_LIBRARY_ENABLED env is not '0'
        self._mock_mode_enabled = (
            MOCK_LIBRARY_ENABLED and
            len(self.allowed_rating_keys) > 0 and
            len(self.preview_targets) > 0
        )

        # Configure the handler class
        PlexProxyHandler.real_plex_url = self.real_plex_url
        PlexProxyHandler.real_plex_host = self.real_host
        PlexProxyHandler.real_plex_port = self.real_port
        PlexProxyHandler.real_plex_scheme = self.real_scheme
        PlexProxyHandler.plex_token = plex_token
        PlexProxyHandler.job_path = str(job_path)
        PlexProxyHandler.blocked_requests = []
        PlexProxyHandler.captured_uploads = []
        PlexProxyHandler.filtered_requests = []
        PlexProxyHandler.mock_list_requests = []
        PlexProxyHandler.request_log = []

        # Configure filtering
        PlexProxyHandler.allowed_rating_keys = self.allowed_rating_keys
        PlexProxyHandler.filtering_enabled = len(self.allowed_rating_keys) > 0

        # Configure mock mode
        PlexProxyHandler.mock_mode_enabled = self._mock_mode_enabled
        PlexProxyHandler.preview_targets = self.preview_targets
        PlexProxyHandler.metadata_cache = {}
        PlexProxyHandler.parent_rating_keys = set()
        PlexProxyHandler.forward_request_count = 0
        PlexProxyHandler.blocked_metadata_count = 0
        PlexProxyHandler.sections_get_count = 0
        PlexProxyHandler.metadata_get_count = 0
        # H3/H4: Reset diagnostic tracking
        PlexProxyHandler.zero_match_searches = 0
        PlexProxyHandler.type_mismatches = []

    @property
    def proxy_url(self) -> str:
        """URL that Kometa should connect to"""
        return f"http://{PROXY_HOST}:{PROXY_PORT}"

    @property
    def filtering_enabled(self) -> bool:
        """Whether filtering is active"""
        return len(self.allowed_rating_keys) > 0

    @property
    def mock_mode_enabled(self) -> bool:
        """Whether mock library mode is active"""
        return self._mock_mode_enabled

    def start(self):
        """Start the proxy server in a background thread"""
        self.server = HTTPServer((PROXY_HOST, PROXY_PORT), PlexProxyHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        logger.info(f"Plex proxy started at {self.proxy_url}")
        logger.info(f"  Blocking and capturing writes")
        logger.info(f"  Captures saved to: {self.job_path}/output/previews/")

        # Log mock mode vs filtering mode status
        if self.mock_mode_enabled:
            logger.info(f"  MOCK_LIBRARY_MODE ENABLED: Only {len(self.allowed_rating_keys)} items visible")
            logger.info(f"  Listing endpoints will NOT be forwarded to Plex")
            logger.info(f"  Metadata requests forwarded only for allowed ratingKeys")
            logger.info(f"  Allowed ratingKeys: {sorted(self.allowed_rating_keys)}")
        elif self.filtering_enabled:
            logger.info(f"  FILTER_MODE ENABLED: Only {len(self.allowed_rating_keys)} items allowed")
            logger.info(f"  Forwarding reads to: {self.real_plex_url}")
            logger.info(f"  Allowed ratingKeys: {sorted(self.allowed_rating_keys)}")
        else:
            logger.warning(f"  FILTERING DISABLED: All items will be processed")
            logger.info(f"  Forwarding reads to: {self.real_plex_url}")

    def stop(self):
        """Stop the proxy server"""
        if self.server:
            self.server.shutdown()
            logger.info("Plex proxy stopped")

    def get_blocked_requests(self) -> List[Dict[str, str]]:
        """Return list of blocked write attempts"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.blocked_requests.copy()

    def get_captured_uploads(self) -> List[Dict[str, Any]]:
        """Return list of captured upload records"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.captured_uploads.copy()

    def get_filtered_requests(self) -> List[Dict[str, Any]]:
        """Return list of filtered listing requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.filtered_requests.copy()

    def get_mock_list_requests(self) -> List[Dict[str, Any]]:
        """Return list of mock mode listing requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.mock_list_requests.copy()

    def get_request_log(self) -> List[Dict[str, Any]]:
        """Return list of all incoming requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.request_log.copy()

    def get_sections_get_count(self) -> int:
        """Return count of non-validation /library/sections GET requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.sections_get_count

    def get_metadata_get_count(self) -> int:
        """Return count of non-validation /library/metadata GET requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.metadata_get_count

    def get_forward_request_count(self) -> int:
        """Return count of forwarded requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.forward_request_count

    def get_blocked_metadata_count(self) -> int:
        """Return count of blocked metadata requests"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.blocked_metadata_count

    def get_learned_parent_keys(self) -> Set[str]:
        """Return set of dynamically learned parent ratingKeys"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.parent_rating_keys.copy()

    def get_zero_match_searches(self) -> int:
        """H4: Return count of zero-match searches"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.zero_match_searches

    def get_type_mismatches(self) -> List[Dict[str, Any]]:
        """H4: Return list of detected type mismatches"""
        with PlexProxyHandler.data_lock:
            return PlexProxyHandler.type_mismatches.copy()


# ============================================================================
# Config Management
# ============================================================================

def load_preview_config(job_path: Path) -> Dict[str, Any]:
    """Load the preview configuration from the job directory"""
    config_path = job_path / 'config' / 'preview.yml'

    if not config_path.exists():
        raise FileNotFoundError(f"Preview config not found: {config_path}")

    return load_yaml_file(config_path)


def _resolve_overlay_path(job_path: Path, raw_path: str) -> Path:
    raw = Path(raw_path)
    if raw.is_absolute():
        return raw
    return job_path / 'config' / raw


def _collect_overlay_files(preview_config: Dict[str, Any], job_path: Path) -> List[Path]:
    overlay_files: List[Path] = []

    libraries = preview_config.get('libraries', {})
    if isinstance(libraries, dict):
        for lib_config in libraries.values():
            if not isinstance(lib_config, dict):
                continue
            overlay_entries = lib_config.get('overlay_files', [])
            if isinstance(overlay_entries, list):
                for entry in overlay_entries:
                    if isinstance(entry, str):
                        overlay_files.append(_resolve_overlay_path(job_path, entry))
                    elif isinstance(entry, dict) and 'file' in entry:
                        overlay_files.append(_resolve_overlay_path(job_path, str(entry['file'])))

    overlays = preview_config.get('overlays', {})
    if isinstance(overlays, dict):
        for overlay_entry in overlays.values():
            if isinstance(overlay_entry, dict) and 'overlay_files' in overlay_entry:
                overlay_files.extend(
                    _resolve_overlay_path(job_path, str(item))
                    for item in overlay_entry.get('overlay_files', [])
                    if isinstance(item, str)
                )

    return overlay_files


def _write_yaml(path: Path, data: Dict[str, Any]) -> None:
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    yaml_parser.default_flow_style = False
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w') as f:
        yaml_parser.dump(data, f)


def _read_yaml(path: Path) -> Dict[str, Any]:
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    with path.open('r') as f:
        return dict(yaml_parser.load(f) or {})


def sanitize_yaml_text(text: str) -> str:
    lines = text.splitlines()
    last_non_empty = -1
    for idx in range(len(lines) - 1, -1, -1):
        if lines[idx].strip():
            last_non_empty = idx
            break

    sanitized_lines = []
    for idx, line in enumerate(lines):
        if line.strip() == '...' and idx != last_non_empty:
            continue
        sanitized_lines.append(line)

    sanitized = '\n'.join(sanitized_lines)
    if text.endswith('\n'):
        sanitized += '\n'
    return sanitized


def redact_yaml_snippet(lines: List[str]) -> List[str]:
    redacted = []
    for line in lines:
        scrubbed = re.sub(r'(\btoken:\s*)(\S+)', r'\1[REDACTED]', line)
        scrubbed = re.sub(r'(\bapikey:\s*)(\S+)', r'\1[REDACTED]', scrubbed)
        scrubbed = re.sub(r'(\bclient_id:\s*)(\S+)', r'\1[REDACTED]', scrubbed)
        scrubbed = re.sub(r'(\bclient_secret:\s*)(\S+)', r'\1[REDACTED]', scrubbed)
        redacted.append(scrubbed)
    return redacted


def load_yaml_file(path: Path) -> Dict[str, Any]:
    try:
        import yaml
        with path.open('r') as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        try:
            from ruamel.yaml import YAML
            yaml_parser = YAML()
            with path.open('r') as f:
                return dict(yaml_parser.load(f) or {})
        except ImportError:
            return json.loads(path.read_text() or '{}')


def apply_fast_mode_sanitization(job_path: Path, preview_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    In FAST mode, sanitize overlay files and apply font fallbacks.
    """
    overlay_files = _collect_overlay_files(preview_config, job_path)
    if not overlay_files:
        return preview_config

    overlay_dir = job_path / 'config' / 'fast_overlays'
    overlay_dir.mkdir(parents=True, exist_ok=True)

    path_map: Dict[str, str] = {}

    for overlay_path in overlay_files:
        if not overlay_path.exists():
            logger.warning(f"FAST_PREVIEW: overlay file not found: {overlay_path}")
            continue

        overlay_data = _read_yaml(overlay_path)
        ensure_font_fallbacks(overlay_data)
        sanitized, stats = sanitize_overlay_data_for_fast_mode(overlay_data)

        if stats['letterboxd_removed'] > 0:
            logger.info(
                f"FAST_PREVIEW: skipped Letterboxd parsing in {overlay_path.name} "
                f"(removed={stats['letterboxd_removed']})"
            )
        if stats['imdb_category_filters_stripped'] > 0:
            logger.info(
                f"FAST_PREVIEW: stripped IMDb award category_filter in {overlay_path.name} "
                f"(count={stats['imdb_category_filters_stripped']})"
            )

        sanitized_path = overlay_dir / overlay_path.name
        _write_yaml(sanitized_path, sanitized)
        path_map[str(overlay_path)] = str(sanitized_path)

    if not path_map:
        return preview_config

    preview_config_copy = json.loads(json.dumps(preview_config))

    libraries = preview_config_copy.get('libraries', {})
    if isinstance(libraries, dict):
        for lib_config in libraries.values():
            if not isinstance(lib_config, dict):
                continue
            overlay_entries = lib_config.get('overlay_files', [])
            if isinstance(overlay_entries, list):
                updated_entries = []
                for entry in overlay_entries:
                    if isinstance(entry, str):
                        resolved = str(_resolve_overlay_path(job_path, entry))
                        updated_entries.append(path_map.get(resolved, entry))
                    elif isinstance(entry, dict) and 'file' in entry:
                        resolved = str(_resolve_overlay_path(job_path, str(entry['file'])))
                        entry['file'] = path_map.get(resolved, entry['file'])
                        updated_entries.append(entry)
                    else:
                        updated_entries.append(entry)
                lib_config['overlay_files'] = updated_entries

    return preview_config_copy


def apply_font_fallbacks_to_overlays(job_path: Path, preview_config: Dict[str, Any]) -> None:
    """Ensure font fallbacks for all referenced overlay files."""
    overlay_files = _collect_overlay_files(preview_config, job_path)
    for overlay_path in overlay_files:
        if not overlay_path.exists():
            continue
        overlay_data = _read_yaml(overlay_path)
        ensure_font_fallbacks(overlay_data)


def fetch_proxy_sections(proxy_url: str, plex_token: str) -> bytes:
    """Fetch /library/sections from the proxy for validation."""
    parsed = urlparse(proxy_url)
    host = parsed.hostname or 'localhost'
    port = parsed.port or 80
    conn = http.client.HTTPConnection(host, port, timeout=10)
    headers = {'Accept': 'text/xml', 'X-Preview-Validation': '1'}
    if plex_token:
        headers['X-Plex-Token'] = plex_token
    conn.request('GET', '/library/sections', headers=headers)
    response = conn.getresponse()
    body = response.read()
    conn.close()
    return body


def validate_library_sections(
    sections_xml: bytes,
    selected_libraries: List[str],
    expected_type: Optional[str]
) -> None:
    """Validate that selected libraries exist and match expected type."""
    snippet = sections_xml[:800].decode('utf-8', errors='replace')

    try:
        root = ET.fromstring(sections_xml)
    except ET.ParseError as e:
        raise RuntimeError(f"Failed to parse /library/sections response: {e}. Snippet: {snippet}")

    sections = []
    for directory in root.findall('Directory'):
        sections.append({
            'title': directory.get('title', ''),
            'type': directory.get('type', ''),
            'key': directory.get('key', ''),
        })

    if not sections:
        raise RuntimeError(f"/library/sections returned no sections. Snippet: {snippet}")

    for name in selected_libraries:
        match = next((s for s in sections if s['title'] == name), None)
        if not match:
            raise RuntimeError(
                f"Selected library '{name}' not found in /library/sections. Snippet: {snippet}"
            )
        if expected_type and match['type'] != expected_type:
            raise RuntimeError(
                f"Library '{name}' type mismatch: expected {expected_type}, got {match['type']}. "
                f"Snippet: {snippet}"
            )


def generate_proxy_config(job_path: Path, preview_config: Dict[str, Any], proxy_url: str) -> Path:
    """
    Generate a Kometa config that points to the proxy instead of real Plex.
    """
    # Determine which YAML library to use
    yaml_backend = None
    pyyaml = None
    try:
        import yaml as pyyaml  # type: ignore
        yaml_backend = 'pyyaml'
    except ImportError:
        try:
            from ruamel.yaml import YAML
            yaml_backend = 'ruamel'
        except ImportError:
            yaml_backend = None

    config_dir = job_path / 'config'
    config_dir.mkdir(parents=True, exist_ok=True)
    kometa_config_path = config_dir / 'kometa_run.yml'

    kometa_config = {}

    # Copy plex section but replace URL with proxy URL
    if 'plex' in preview_config:
        kometa_config['plex'] = {
            'url': proxy_url,
            'token': preview_config['plex'].get('token', ''),
            'timeout': preview_config['plex'].get('timeout', 60),
            'clean_bundles': False,
            'empty_trash': False,
            'optimize': False,
        }

    # Settings optimized for preview
    # Enable cache to speed up subsequent runs (TMDb Discover data, etc.)
    cache_enabled = Path('/kometa_cache').exists()
    if cache_enabled:
        logger.info("  Cache directory found - enabling Kometa cache")

    kometa_config['settings'] = {
        'cache': cache_enabled,
        'cache_expiration': 43200 if cache_enabled else 0,  # 30 days in minutes
        'asset_folders': False,
        'create_asset_folders': False,
        'prioritize_assets': False,
        'run_order': ['overlays'],
        'show_unmanaged': False,
        'show_unconfigured': False,
        'show_filtered': False,
        'show_options': False,
        'show_missing': False,
        'save_report': False,
    }

    # Copy TMDb section - required for many overlay operations (ratings, etc.)
    if 'tmdb' in preview_config:
        kometa_config['tmdb'] = preview_config['tmdb']
        logger.info("  Copied TMDb configuration")

    # Copy other services that overlays may need
    for service_key in ['tautulli', 'mdblist', 'trakt', 'radarr', 'sonarr', 'omdb', 'notifiarr', 'anidb', 'mal']:
        if service_key in preview_config:
            kometa_config[service_key] = preview_config[service_key]
            logger.info(f"  Copied {service_key} configuration")

    # Copy libraries with overlay definitions
    if 'libraries' in preview_config:
        kometa_config['libraries'] = preview_config['libraries']
    elif 'overlays' in preview_config:
        libraries = {}
        for lib_name, lib_config in preview_config.get('overlays', {}).items():
            if isinstance(lib_config, dict) and 'overlay_files' in lib_config:
                libraries[lib_name] = {
                    'overlay_files': lib_config['overlay_files'],
                    'operations': None,
                    'collections': None,
                    'metadata': None,
                }
        if libraries:
            kometa_config['libraries'] = libraries

    with open(kometa_config_path, 'w') as f:
        if yaml_backend == 'pyyaml' and pyyaml:
            pyyaml.dump(kometa_config, f, default_flow_style=False)
        elif yaml_backend == 'ruamel':
            from ruamel.yaml import YAML
            ruamel_yaml = YAML()
            ruamel_yaml.default_flow_style = False
            ruamel_yaml.dump(kometa_config, f)
        else:
            json.dump(kometa_config, f, indent=2)

    sanitized_text = sanitize_yaml_text(kometa_config_path.read_text())
    kometa_config_path.write_text(sanitized_text)

    parsed_config = load_yaml_file(kometa_config_path)
    missing_keys = [key for key in ('plex', 'tmdb', 'libraries') if key not in parsed_config]
    if missing_keys:
        raise RuntimeError(
            f"Generated Kometa config missing required keys: {', '.join(missing_keys)}"
        )

    logger.info(f"Generated Kometa config: {kometa_config_path}")
    logger.info(f"  Plex URL set to proxy: {proxy_url}")
    if kometa_config.get('plex', {}).get('url') != proxy_url:
        logger.warning(
            f"Kometa Plex URL mismatch: expected {proxy_url}, "
            f"got {kometa_config.get('plex', {}).get('url')}"
        )

    return kometa_config_path


# ============================================================================
# Kometa Execution
# ============================================================================

def find_kometa_script() -> Optional[Path]:
    """Find the Kometa entry point script"""
    kometa_paths = [
        Path('/kometa.py'),
        Path('/app/kometa.py'),
        Path('/Kometa/kometa.py'),
    ]

    for p in kometa_paths:
        if p.exists():
            return p

    return None


def run_kometa(config_path: Path, tmdb_proxy_url: Optional[str] = None) -> int:
    """
    Run Kometa with the given config file.

    Args:
        config_path: Path to the Kometa configuration file
        tmdb_proxy_url: Optional URL for TMDb proxy (for fast mode capping)
    """
    kometa_script = find_kometa_script()

    if kometa_script:
        logger.info(f"Running Kometa from: {kometa_script}")
        cmd = [
            sys.executable, str(kometa_script),
            '-r',
            '--config', str(config_path),
        ]
    else:
        logger.info("Attempting to run Kometa as module...")
        cmd = [
            sys.executable, '-m', 'kometa',
            '-r',
            '--config', str(config_path),
        ]

    logger.info(f"Command: {' '.join(cmd)}")

    env = os.environ.copy()
    env['KOMETA_CONFIG'] = str(config_path)

    # Set up TMDb proxy environment if provided
    # This routes TMDb API calls through our capping proxy
    if tmdb_proxy_url:
        logger.info(f"TMDb proxy configured: {tmdb_proxy_url}")
        # Note: This requires the proxy to handle HTTPS CONNECT tunneling
        # For now, we set it but the actual interception happens via
        # modifying the Kometa config's TMDb URL or using requests hooks

    # Set preview accuracy mode environment variables for any Kometa extensions
    env['PREVIEW_ACCURACY'] = PREVIEW_ACCURACY
    env['PREVIEW_EXTERNAL_ID_LIMIT'] = str(PREVIEW_EXTERNAL_ID_LIMIT)
    env['PREVIEW_EXTERNAL_PAGES_LIMIT'] = str(PREVIEW_EXTERNAL_PAGES_LIMIT)

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
            text=True,
            bufsize=1
        )

        for line in iter(process.stdout.readline, ''):
            if line:
                print(line.rstrip())

        process.wait()
        return process.returncode

    except FileNotFoundError as e:
        logger.error(f"Failed to run Kometa: {e}")
        return 1
    except Exception as e:
        logger.error(f"Kometa execution error: {e}")
        traceback.print_exc()
        return 1


# ============================================================================
# Output Export (Deterministic Mapping by ratingKey)
# ============================================================================

def build_rating_key_to_target_map(preview_config: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Build a mapping from ratingKey to target info.

    Returns: { ratingKey: { target_id, type, title, ... }, ... }
    """
    preview_data = preview_config.get('preview', {})
    targets = safe_preview_targets(preview_config)

    mapping = {}
    for target in targets:
        rating_key = target.get('ratingKey') or target.get('rating_key') or target.get('plex_id')
        if rating_key:
            mapping[str(rating_key)] = target
        else:
            logger.warning(f"Target {target.get('id')} has no ratingKey - cannot map output")

    return mapping


def find_captured_upload_for_rating_key(
    captured_uploads: List[Dict[str, Any]],
    rating_key: str,
    prefer_kind: str = 'poster'
) -> Optional[Dict[str, Any]]:
    """
    Find the most appropriate captured upload for a given ratingKey.

    Prefers 'poster' kind, then most recent upload.
    """
    matches = [
        u for u in captured_uploads
        if u.get('rating_key') == rating_key and u.get('saved_path')
    ]

    if not matches:
        return None

    # Prefer the specified kind
    kind_matches = [u for u in matches if u.get('kind') == prefer_kind]
    if kind_matches:
        matches = kind_matches

    # Return most recent (by timestamp)
    matches.sort(key=lambda u: u.get('timestamp', ''), reverse=True)
    return matches[0]


def export_local_preview_artifacts(
    job_path: Path,
    preview_config: Dict[str, Any]
) -> Dict[str, str]:
    """
    Export locally-rendered preview artifacts (e.g., *_after.png) into previews dir.
    """
    output_dir = job_path / 'output'
    previews_dir = output_dir / 'previews'
    previews_dir.mkdir(parents=True, exist_ok=True)

    exported: Dict[str, str] = {}

    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])

    for target in targets:
        target_id = target.get('id', '')
        rating_key = target.get('ratingKey') or target.get('rating_key') or target.get('plex_id')

        if not target_id or not rating_key:
            continue

        rating_key = str(rating_key)
        candidate = None
        for ext in ('png', 'jpg', 'jpeg', 'webp'):
            path = output_dir / f"{target_id}_after.{ext}"
            if path.exists():
                candidate = path
                break

        if not candidate:
            draft_path = output_dir / 'draft' / f"{target_id}_draft.png"
            if draft_path.exists():
                candidate = draft_path

        if not candidate:
            continue

        ext = candidate.suffix.lstrip('.') or 'png'
        preview_path = previews_dir / f"{rating_key}__poster.{ext}"
        try:
            shutil.copy2(candidate, preview_path)
            exported[target_id] = str(preview_path)
            logger.info(
                f"LOCAL_ARTIFACT_CAPTURED target={target_id} ratingKey={rating_key} "
                f"path={preview_path}"
            )
        except Exception as e:
            logger.warning(f"LOCAL_ARTIFACT_COPY_FAILED target={target_id} error={e}")

    return exported


def export_overlay_outputs(
    job_path: Path,
    preview_config: Dict[str, Any],
    captured_uploads: List[Dict[str, Any]]
) -> Tuple[Dict[str, str], List[str]]:
    """
    Export captured uploads to the output directory, mapping by ratingKey.

    Returns: (exported_files dict, missing_targets list)
    """
    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    exported = {}
    missing = []

    # Build ratingKey -> target mapping
    rk_to_target = build_rating_key_to_target_map(preview_config)

    # Get all targets
    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])

    logger.info(f"Mapping {len(targets)} targets to captured uploads...")
    logger.info(f"  Captured uploads: {len(captured_uploads)}")
    logger.info(f"  ratingKey mappings: {len(rk_to_target)}")

    for target in targets:
        target_id = target.get('id', '')
        rating_key = target.get('ratingKey') or target.get('rating_key') or target.get('plex_id')

        if not target_id:
            continue

        if not rating_key:
            logger.error(f"MISSING_RATINGKEY target={target_id}")
            missing.append(target_id)
            continue

        rating_key = str(rating_key)

        # Find captured upload for this ratingKey
        upload = find_captured_upload_for_rating_key(captured_uploads, rating_key)

        if not upload or not upload.get('saved_path'):
            logger.error(f"MISSING_CAPTURE ratingKey={rating_key} target={target_id}")
            missing.append(target_id)
            continue

        # Determine extension from saved file
        saved_path = Path(upload['saved_path'])
        ext = saved_path.suffix.lstrip('.') or 'png'

        # Copy to output with target_id name
        output_path = output_dir / f"{target_id}_after.{ext}"

        try:
            shutil.copy2(saved_path, output_path)
            exported[target_id] = str(output_path)
            logger.info(f"Exported: {target_id} (ratingKey={rating_key}) -> {output_path}")
        except Exception as e:
            logger.error(f"Failed to export {target_id}: {e}")
            missing.append(target_id)

    return exported, missing


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Main entry point for the Kometa Preview Renderer"""
    parser = argparse.ArgumentParser(
        description='Kometa Preview Renderer - Runs real Kometa with proxy-based write blocking and upload capture'
    )
    parser.add_argument('--job', required=True, help='Path to job directory')
    args = parser.parse_args()

    job_path = Path(args.job)
    preview_targets: List[Dict[str, Any]] = []
    proxy: Optional[PlexProxy] = None
    tmdb_proxy: Optional[TMDbProxy] = None
    final_exit = 1
    summary_written = False
    summary_path: Optional[Path] = None

    if not job_path.exists():
        logger.error(f"Job directory not found: {job_path}")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("Kometa Preview Studio")
    logger.info("Path A: Real Kometa with Proxy Write Blocking + Upload Capture")
    logger.info("=" * 60)
    logger.info(f"Job path: {job_path}")
    logger.info(f"Preview mode: {PREVIEW_ACCURACY}")

    # P1: Validate font availability at startup
    try:
        available_font_dirs = validate_fonts_at_startup()
    except FileNotFoundError as e:
        logger.error(f"Font validation failed: {e}")
        sys.exit(1)

    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create output subdirectories
    (output_dir / 'previews').mkdir(parents=True, exist_ok=True)
    (output_dir / 'by_ratingkey').mkdir(parents=True, exist_ok=True)

    # Load config
    try:
        preview_config = load_preview_config(job_path)
        logger.info("Preview config loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load preview config: {e}")
        sys.exit(1)

    summary_path = output_dir / 'summary.json'

    # Log configured Plex URL
    configured_plex_url = preview_config.get('plex', {}).get('url', '')
    logger.info(f"Configured Plex URL (preview config): {configured_plex_url}")

    # Apply font fallbacks and FAST mode guardrails
    ensure_font_fallbacks(preview_config)
    if FAST_MODE:
        preview_config = apply_fast_mode_sanitization(job_path, preview_config)
    else:
        apply_font_fallbacks_to_overlays(job_path, preview_config)

    # ================================================================
    # Output Caching Check
    # Skip rendering entirely if config unchanged and outputs exist
    # ================================================================
    if OUTPUT_CACHE_ENABLED:
        config_hash = compute_config_hash(preview_config)
        logger.info(f"Config hash: {config_hash}")

        if check_cached_outputs(job_path, config_hash):
            logger.info("=" * 60)
            logger.info("CACHE HIT - Using cached outputs (instant return)")
            logger.info("=" * 60)

            success, cached_files = use_cached_outputs(job_path)

            if success:
                # Write summary for cached run
                summary = {
                    'timestamp': datetime.now().isoformat(),
                    'success': True,
                    'cached': True,
                    'config_hash': config_hash,
                    'exported_files': cached_files,
                    'output_files': [Path(f).name for f in cached_files.values()],
                }
                summary_path = output_dir / 'summary.json'
                with open(summary_path, 'w') as f:
                    json.dump(summary, f, indent=2)

                logger.info(f"Returning {len(cached_files)} cached outputs")
                sys.exit(0)
            else:
                logger.warning("Cache invalid - proceeding with rendering")
    else:
        config_hash = None
        logger.info("Output caching disabled (PREVIEW_OUTPUT_CACHE=0)")

    # Extract Plex connection info
    plex_config = preview_config.get('plex', {})
    real_plex_url = plex_config.get('url', '')
    plex_token = plex_config.get('token', '')

    if not real_plex_url:
        logger.error("No Plex URL found in config")
        sys.exit(1)

    logger.info(f"Real Plex URL: {real_plex_url}")

    # Extract allowed ratingKeys for filtering
    allowed_rating_keys = extract_allowed_rating_keys(preview_config)

    # Log target ratingKeys for debugging
    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])
    preview_targets = targets
    logger.info(f"Preview targets ({len(targets)}):")
    for t in targets:
        rk = t.get('ratingKey') or t.get('rating_key') or 'MISSING'
        logger.info(f"  - {t.get('id')}: ratingKey={rk}")

    if not allowed_rating_keys:
        logger.warning("No ratingKeys found in preview targets - filtering will be DISABLED")
        logger.warning("Kometa will process ALL library items (may be slow)")
    else:
        logger.info(f"Proxy will only expose {len(allowed_rating_keys)} items to Kometa")

    # Start the write-blocking proxy with capture, filtering, and mock mode
    proxy = PlexProxy(
        real_plex_url, plex_token, job_path,
        allowed_rating_keys=allowed_rating_keys,
        preview_targets=targets
    )
    if configured_plex_url and configured_plex_url != proxy.proxy_url:
        logger.warning(
            f"Configured Plex URL is not the proxy: {configured_plex_url} "
            f"(expected {proxy.proxy_url})"
        )

    # Start TMDb proxy for fast mode (caps external ID expansions)
    tmdb_proxy = None
    if TMDB_PROXY_ENABLED:
        logger.info("=" * 60)
        logger.info(f"Preview Accuracy Mode: {PREVIEW_ACCURACY.upper()}")
        logger.info(f"  External ID Limit: {PREVIEW_EXTERNAL_ID_LIMIT}")
        logger.info(f"  External Pages Limit: {PREVIEW_EXTERNAL_PAGES_LIMIT}")
        logger.info("=" * 60)

        tmdb_proxy = TMDbProxy(
            fast_mode=(PREVIEW_ACCURACY == 'fast'),
            id_limit=PREVIEW_EXTERNAL_ID_LIMIT,
            pages_limit=PREVIEW_EXTERNAL_PAGES_LIMIT
        )
    else:
        logger.info("=" * 60)
        logger.info(f"Preview Accuracy Mode: {PREVIEW_ACCURACY.upper()}")
        if PREVIEW_ACCURACY == 'accurate':
            logger.info("  TMDb proxy disabled - full external expansion enabled")
        logger.info("=" * 60)

    summary: Optional[Dict[str, Any]] = None

    try:
        proxy.start()
        if tmdb_proxy:
            tmdb_proxy.start()

        # Validate sections endpoint for selected libraries
        selected_libraries = list(preview_config.get('libraries', {}).keys())
        has_movies = any(t.get('type') in ('movie', 'movies') for t in targets)
        has_shows = any(t.get('type') in ('show', 'shows', 'series', 'season', 'episode') for t in targets)
        expected_type = None
        if has_movies and not has_shows:
            expected_type = 'movie'
        elif has_shows and not has_movies:
            expected_type = 'show'

        if selected_libraries:
            sections_xml = fetch_proxy_sections(proxy.proxy_url, plex_token)
            validate_library_sections(sections_xml, selected_libraries, expected_type)

        # ================================================================
        # PHASE 1: Instant Draft Preview
        # Create draft overlays immediately using hardcoded metadata
        # ================================================================
        logger.info("=" * 60)
        logger.info("Phase 1: Creating instant draft preview...")
        logger.info("=" * 60)

        try:
            from instant_compositor import run_instant_preview
            draft_result = run_instant_preview(job_path)
            if draft_result == 0:
                logger.info("Draft preview created successfully")
            else:
                logger.warning("Draft preview creation had issues (continuing with Kometa)")
        except ImportError:
            logger.warning("Instant compositor not available - skipping draft preview")
        except Exception as e:
            logger.warning(f"Draft preview failed (continuing with Kometa): {e}")

        # ================================================================
        # PHASE 2: Full Kometa Render
        # Run real Kometa for accurate, production-quality overlays
        # ================================================================

        # Generate config that points to our proxy
        kometa_config_path = generate_proxy_config(job_path, preview_config, proxy.proxy_url)

        # Run Kometa
        logger.info("=" * 60)
        logger.info("Phase 2: Starting Kometa for accurate render...")
        logger.info("=" * 60)

        tmdb_proxy_url = tmdb_proxy.proxy_url if tmdb_proxy else None
        logger.info(f"Launching Kometa with config={kometa_config_path} plex_url={proxy.proxy_url}")
        exit_code = run_kometa(kometa_config_path, tmdb_proxy_url=tmdb_proxy_url)

        logger.info("=" * 60)
        logger.info(f"Kometa finished with exit code: {exit_code}")
        logger.info("=" * 60)

        # Get captured data
        blocked_requests = proxy.get_blocked_requests()
        captured_uploads = proxy.get_captured_uploads()
        filtered_requests = proxy.get_filtered_requests()
        mock_list_requests = proxy.get_mock_list_requests()
        forward_count = proxy.get_forward_request_count()
        blocked_metadata_count = proxy.get_blocked_metadata_count()
        learned_parents = proxy.get_learned_parent_keys()
        request_log = proxy.get_request_log()
        sections_get_count = proxy.get_sections_get_count()
        metadata_get_count = proxy.get_metadata_get_count()
        # H3/H4: Get diagnostic data
        zero_match_searches = proxy.get_zero_match_searches()
        type_mismatches = proxy.get_type_mismatches()

        logger.info(f"Blocked {len(blocked_requests)} write attempts")
        logger.info(f"Captured {len(captured_uploads)} uploads")

        sections_all_count = sum(
            1 for req in request_log
            if req.get('method') == 'GET' and re.match(r'^/library/sections/\d+/all$', req.get('path_base', ''))
        )

        # Traffic sanity check: ensure proxy is in the request path
        if sections_get_count == 0 and metadata_get_count == 0 and sections_all_count == 0:
            logger.error("PROXY_TRAFFIC_SANITY_FAILED: missing expected Plex GET traffic")
            logger.error(f"  /library/sections GETs: {sections_get_count}")
            logger.error(f"  /library/metadata/* GETs: {metadata_get_count}")
            logger.error(f"  /library/sections/<id>/all GETs: {sections_all_count}")
            if request_log:
                logger.error("  Last 30 requests:")
                for req in request_log[-30:]:
                    logger.error(f"    {req.get('method')} {req.get('path_base')}")
            if kometa_config_path and kometa_config_path.exists():
                snippet_lines = kometa_config_path.read_text().splitlines()[:20]
                snippet_lines = redact_yaml_snippet(snippet_lines)
                logger.error("Kometa config snippet (first 20 lines, redacted):")
                for line in snippet_lines:
                    logger.error(f"  {line}")
            raise RuntimeError(
                "Kometa did not process libraries — likely invalid config "
                "(missing libraries) or YAML truncated (unexpected '...')."
            )

        # Log mock mode vs filter mode statistics
        if proxy.mock_mode_enabled:
            logger.info(f"Mock list requests: {len(mock_list_requests)}")
            logger.info(f"Forwarded requests: {forward_count}")
            logger.info(f"Blocked metadata requests: {blocked_metadata_count}")
            if learned_parents:
                logger.info(f"Learned parent ratingKeys: {sorted(learned_parents)}")
        else:
            logger.info(f"Filtered {len(filtered_requests)} listing requests")

        # Log capture summary
        successful_captures = [u for u in captured_uploads if u.get('saved_path')]
        failed_captures = [u for u in captured_uploads if not u.get('saved_path')]

        if successful_captures:
            logger.info("Successful captures:")
            for u in successful_captures:
                logger.info(f"  ratingKey={u.get('rating_key')} kind={u.get('kind')} path={u.get('saved_path')}")

        if failed_captures:
            logger.warning("Failed captures:")
            for u in failed_captures:
                logger.warning(f"  ratingKey={u.get('rating_key')} error={u.get('parse_error')}")

        # Export outputs with deterministic mapping
        if successful_captures:
            exported_files, missing_targets = export_overlay_outputs(
                job_path, preview_config, captured_uploads
            )
        else:
            exported_files = {}
            missing_targets = [
                t.get('id') for t in targets if t.get('id')
            ]

        local_artifacts = {}
        if not successful_captures:
            local_artifacts = export_local_preview_artifacts(job_path, preview_config)
            for target_id, preview_path in local_artifacts.items():
                exported_files[target_id] = preview_path
                if target_id in missing_targets:
                    missing_targets.remove(target_id)

        no_capture_error = False
        if not successful_captures and not local_artifacts and targets:
            no_capture_error = True
            logger.error("NO_CAPTURE_OUTPUTS: No uploads captured and no local artifacts found.")
            if request_log:
                logger.error("Last 30 requests seen by proxy:")
                for req in request_log[-30:]:
                    logger.error(f"  {req.get('method')} {req.get('path_base')}")

        # Get TMDb proxy statistics
        tmdb_stats = {}
        if tmdb_proxy:
            tmdb_stats = tmdb_proxy.get_stats()
            tmdb_capped_requests = tmdb_stats.get('capped_requests', [])
            if tmdb_capped_requests:
                logger.info(f"TMDb capped requests: {len(tmdb_capped_requests)}")
                for req in tmdb_capped_requests:
                    logger.info(
                        f"  {req.get('path')}: {req.get('original_total')} -> {req.get('capped_to')}"
                    )
            # G1/G2/H1: Log deduplication and suppression stats
            if tmdb_stats.get('cache_hits', 0) > 0:
                logger.info(f"TMDb requests deduplicated (cache hits): {tmdb_stats['cache_hits']}")
            if tmdb_stats.get('skipped_non_overlay', 0) > 0:
                logger.info(f"TMDb non-overlay discover skipped: {tmdb_stats['skipped_non_overlay']}")
            if tmdb_stats.get('skipped_tvdb_conversions', 0) > 0:
                logger.info(f"TMDb→TVDb conversions skipped: {tmdb_stats['skipped_tvdb_conversions']}")

        # H3/H4: Log diagnostic warnings
        if zero_match_searches > 0:
            logger.warning(f"DIAGNOSTIC: {zero_match_searches} search queries returned 0 results")
        if type_mismatches:
            logger.warning(f"DIAGNOSTIC: {len(type_mismatches)} type mismatches detected")
            for mismatch in type_mismatches[:5]:  # Limit to first 5
                logger.warning(f"  {mismatch.get('description', mismatch)}")

        # Write summary
        render_success = (
            exit_code == 0 and
            len(missing_targets) == 0 and
            len(exported_files) > 0 and
            not no_capture_error
        )
        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': render_success,
            'cached': False,
            'config_hash': config_hash,
            'kometa_exit_code': exit_code,
            'blocked_write_attempts': blocked_requests,
            'captured_uploads': captured_uploads,
            'captured_uploads_count': len(captured_uploads),
            'successful_captures_count': len(successful_captures),
            'local_artifacts': local_artifacts,
            'local_artifacts_count': len(local_artifacts),
            'exported_files': exported_files,
            'missing_targets': missing_targets,
            'output_files': [f.name for f in output_dir.glob('*_after.*')],
            'proxy_request_log_tail': request_log[-30:],
            'proxy_traffic': {
                'sections_get_count': sections_get_count,
                'metadata_get_count': metadata_get_count,
                'total_requests': len(request_log),
            },
            # Preview accuracy mode statistics (G1/G2/G3/H1)
            'preview_accuracy': {
                'mode': PREVIEW_ACCURACY,
                'external_id_limit': PREVIEW_EXTERNAL_ID_LIMIT,
                'external_pages_limit': PREVIEW_EXTERNAL_PAGES_LIMIT,
                'tmdb_proxy_enabled': tmdb_proxy is not None,
                'tmdb_total_requests': tmdb_stats.get('total_requests', 0),
                'tmdb_capped_requests': tmdb_stats.get('capped_requests', []),
                'tmdb_capped_requests_count': tmdb_stats.get('capped_requests_count', 0),
                # G1: Request deduplication statistics
                'tmdb_cache_hits': tmdb_stats.get('cache_hits', 0),
                'tmdb_cache_size': tmdb_stats.get('cache_size', 0),
                # G2: Non-overlay discover suppression
                'tmdb_skipped_non_overlay': tmdb_stats.get('skipped_non_overlay', 0),
                # H1: TVDb conversion suppression
                'tmdb_skipped_tvdb_conversions': tmdb_stats.get('skipped_tvdb_conversions', 0),
            },
            # Mock library mode statistics
            'mock_mode': {
                'enabled': proxy.mock_mode_enabled,
                'mock_list_requests': mock_list_requests,
                'mock_list_requests_count': len(mock_list_requests),
                'forward_requests_count': forward_count,
                'blocked_metadata_count': blocked_metadata_count,
                'learned_parent_keys': sorted(learned_parents) if learned_parents else [],
            },
            # Legacy filtering statistics (when mock mode disabled)
            'filtering': {
                'enabled': proxy.filtering_enabled and not proxy.mock_mode_enabled,
                'allowed_rating_keys': sorted(allowed_rating_keys) if allowed_rating_keys else [],
                'allowed_count': len(allowed_rating_keys),
                'filtered_requests': filtered_requests,
                'filtered_requests_count': len(filtered_requests),
            },
            # H3/H4: Diagnostic information
            'diagnostics': {
                'zero_match_searches': zero_match_searches,
                'type_mismatches': type_mismatches,
                'type_mismatches_count': len(type_mismatches),
                'no_capture_error': no_capture_error,
            },
        }

        summary_path = output_dir / 'summary.json'
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)

        logger.info(f"Summary written to: {summary_path}")
        summary_written = True

        # Save cache hash for successful renders (enables instant subsequent runs)
        if render_success and config_hash:
            save_cache_hash(job_path, config_hash)

        # P0 Safety Check: If we have targets but no captured uploads, provide actionable error
        targets_count = len(preview_targets) if preview_targets else 0
        if targets_count > 0 and len(successful_captures) == 0:
            logger.error("=" * 60)
            logger.error("UPLOAD CAPTURE FAILURE - No images were captured!")
            logger.error("=" * 60)
            logger.error(f"Targets: {targets_count}")
            logger.error(f"Total blocked requests: {len(blocked_requests)}")
            logger.error(f"Total capture attempts: {len(captured_uploads)}")

            # Show last 20 PUT/POST requests for debugging
            write_requests = [r for r in blocked_requests if r.get('method') in ('PUT', 'POST')]
            if write_requests:
                logger.error(f"\nLast {min(20, len(write_requests))} PUT/POST requests:")
                for req in write_requests[-20:]:
                    logger.error(
                        f"  {req.get('method')} {req.get('path', '').split('?')[0]} "
                        f"content_type={req.get('content_type')} "
                        f"content_length={req.get('content_length')} "
                        f"ratingKey={req.get('rating_key')}"
                    )
            else:
                logger.error("No PUT/POST requests were received by the proxy!")
                logger.error("Check if Kometa is actually sending upload requests.")

            # Show failed captures
            if failed_captures:
                logger.error("\nFailed capture attempts:")
                for cap in failed_captures[:10]:
                    logger.error(
                        f"  path={cap.get('path')} error={cap.get('parse_error')}"
                    )

            logger.error("=" * 60)

        # Report results
        output_count = len(list(output_dir.glob('*_after.*')))
        if output_count > 0 and len(missing_targets) == 0 and not no_capture_error:
            logger.info(f"Preview rendering complete: {output_count} images generated")
            final_exit = 0
        elif output_count > 0:
            logger.warning(
                f"Preview rendering partial: {output_count} images generated, "
                f"{len(missing_targets)} targets missing"
            )
            final_exit = 1
        else:
            logger.error("Preview rendering failed: no output images generated")
            # Add extra diagnostic info for P0 failure
            if targets_count > 0:
                logger.error(f"  - {targets_count} targets were expected")
                logger.error(f"  - {len(blocked_requests)} write requests were blocked")
                logger.error(f"  - {len(successful_captures)} images were captured")
                logger.error("  Check logs above for UPLOAD_CAPTURED or UPLOAD_IGNORED messages")
            final_exit = 1

    except Exception as e:
        logger.error("Preview run failed with an unexpected error:")
        logger.error(str(e))
        logger.debug(traceback.format_exc())

        if proxy:
            request_log = proxy.get_request_log()
        else:
            request_log = []

        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': False,
            'cached': False,
            'error': str(e),
            'request_log_tail': request_log[-30:],
        }
        final_exit = 1

    finally:
        if proxy:
            proxy.stop()
        if tmdb_proxy:
            tmdb_proxy.stop()
        if summary_path and summary and not summary_written:
            try:
                with open(summary_path, 'w') as f:
                    json.dump(summary, f, indent=2)
                logger.info(f"Summary written to: {summary_path}")
            except Exception as write_error:
                logger.error(f"Failed to write summary: {write_error}")

    sys.exit(final_exit)


if __name__ == '__main__':
    main()
