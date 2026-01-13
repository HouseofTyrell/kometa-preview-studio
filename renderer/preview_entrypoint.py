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
- Images are saved to: output/by_ratingkey/<ratingKey>_<kind>.<ext>
- After Kometa finishes, targets are mapped by ratingKey to get correct outputs

Usage:
    python3 preview_entrypoint.py --job /jobs/<jobId>
"""

import argparse
import cgi
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

# Mock library mode - prevents forwarding listing endpoints to real Plex
# Set PREVIEW_MOCK_LIBRARY=0 to disable and fall back to filter mode
MOCK_LIBRARY_ENABLED = os.environ.get('PREVIEW_MOCK_LIBRARY', '1') == '1'
DEBUG_MOCK_XML = os.environ.get('PREVIEW_DEBUG_MOCK_XML', '0') == '1'

# Plex upload endpoint patterns
# Matches: /library/metadata/<ratingKey>/posters, /library/metadata/<ratingKey>/arts, etc.
PLEX_UPLOAD_PATTERN = re.compile(
    r'^/library/metadata/(\d+)/(posters?|arts?|thumbs?)(?:\?.*)?$'
)

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
    targets = preview_data.get('targets', [])

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


# ============================================================================
# Mock Library Mode - Synthetic XML Generation
# ============================================================================

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
    data_lock = threading.Lock()

    # Counters for summary
    forward_request_count: int = 0
    blocked_metadata_count: int = 0

    def log_message(self, format, *args):
        """Override to use our logger"""
        logger.debug(f"PROXY: {args[0]}")

    def do_GET(self):
        """Forward GET requests to real Plex (or return synthetic XML in mock mode)"""
        path = self.path
        path_base = path.split('?')[0]
        is_listing = is_listing_endpoint(path)
        is_meta = is_metadata_endpoint(path)
        is_sections = is_library_sections_endpoint(path)
        children_parent = is_children_endpoint(path)

        logger.info(
            f"PROXY_GET path={path_base} is_listing={is_listing} "
            f"is_metadata={is_meta} is_sections={is_sections}"
        )

        # Mock library mode: return synthetic XML for listing endpoints
        if self.mock_mode_enabled and self.allowed_rating_keys:
            # Handle /library/sections endpoint
            if is_sections:
                self._handle_mock_sections()
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
        self._forward_request('HEAD')

    def do_POST(self):
        """Block POST requests and capture upload data"""
        self._block_and_capture('POST')

    def do_PUT(self):
        """Block PUT requests and capture upload data"""
        self._block_and_capture('PUT')

    def do_PATCH(self):
        """Block PATCH requests"""
        self._block_request('PATCH')

    def do_DELETE(self):
        """Block DELETE requests"""
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
                if key.lower() not in ('host', 'connection'):
                    headers[key] = value

            # Ensure X-Plex-Token is present
            if self.plex_token and 'x-plex-token' not in [k.lower() for k in headers.keys()]:
                headers['X-Plex-Token'] = self.plex_token

            conn.request(method, path, headers=headers)
            response = conn.getresponse()

            # Read full response body for potential filtering
            response_body = response.read()

            # Track forward count
            with self.data_lock:
                self.forward_request_count += 1

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
            for key, value in response.getheaders():
                if key.lower() == 'content-length':
                    self.send_header('Content-Length', str(len(response_body)))
                elif key.lower() not in ('transfer-encoding', 'connection'):
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
        """
        try:
            root = ET.fromstring(response_body)

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

        except ET.ParseError as e:
            logger.warning(f"CACHE_METADATA_PARSE_ERROR ratingKey={rating_key}: {e}")
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
        """Block a write request and capture any uploaded image data"""
        timestamp = datetime.now().isoformat()
        timestamp_safe = datetime.now().strftime('%Y%m%d_%H%M%S_%f')

        # Read request body
        content_length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        # Parse ratingKey and kind from path
        rating_key, kind = self._parse_upload_path(self.path)

        # Log the blocked request
        blocked_entry = {
            'method': method,
            'path': self.path,
            'timestamp': timestamp,
            'rating_key': rating_key,
            'kind': kind,
            'content_length': content_length
        }

        capture_record: Dict[str, Any] = {
            'rating_key': rating_key,
            'method': method,
            'path': self.path,
            'kind': kind,
            'timestamp': timestamp,
            'size_bytes': content_length,
            'saved_path': None,
            'parse_error': None
        }

        # Try to extract and save the image
        if content_length > 0 and rating_key:
            try:
                image_bytes, ext = self._extract_image_from_body(body)
                if image_bytes:
                    saved_path = self._save_captured_image(
                        rating_key, kind, image_bytes, ext, timestamp_safe
                    )
                    capture_record['saved_path'] = saved_path
                    capture_record['size_bytes'] = len(image_bytes)
                    logger.info(
                        f"CAPTURED_UPLOAD ratingKey={rating_key} kind={kind} "
                        f"bytes={len(image_bytes)} saved={saved_path}"
                    )
                else:
                    capture_record['parse_error'] = 'No image data found in body'
                    logger.warning(
                        f"BLOCKED_WRITE (no image): {method} {self.path} "
                        f"ratingKey={rating_key}"
                    )
                    # Save raw body for debugging
                    self._save_debug_body(rating_key, kind, body, timestamp_safe)
            except Exception as e:
                capture_record['parse_error'] = str(e)
                logger.error(
                    f"BLOCKED_WRITE (parse error): {method} {self.path} "
                    f"ratingKey={rating_key} error={e}"
                )
                # Save raw body for debugging
                self._save_debug_body(rating_key, kind, body, timestamp_safe)
        elif content_length > 0:
            # Has body but no ratingKey - save for debugging
            logger.warning(f"BLOCKED_WRITE (unknown path): {method} {self.path}")
            self._save_debug_body('unknown', 'unknown', body, timestamp_safe)
            capture_record['parse_error'] = 'Could not parse ratingKey from path'
        else:
            logger.warning(f"BLOCKED_WRITE (no body): {method} {self.path}")

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

        Returns: (ratingKey or None, kind)
        """
        match = PLEX_UPLOAD_PATTERN.match(path.split('?')[0])
        if match:
            rating_key = match.group(1)
            kind_raw = match.group(2)
            # Normalize: posters->poster, arts->art, thumbs->thumb
            kind = kind_raw.rstrip('s')
            return rating_key, kind

        # Fallback: try to find any /library/metadata/<id>/ pattern
        fallback_match = re.search(r'/library/metadata/(\d+)/', path)
        if fallback_match:
            return fallback_match.group(1), 'unknown'

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

        # Check for multipart/form-data
        if content_type.startswith('multipart/form-data'):
            return self._parse_multipart(body, content_type)

        # Check if body is raw image data
        if self._is_image_data(body):
            ext = self._detect_image_type(body)
            return body, ext

        # Try to detect image anyway (some uploads don't set proper content-type)
        if len(body) > 0 and self._is_image_data(body):
            ext = self._detect_image_type(body)
            return body, ext

        return None, 'bin'

    def _parse_multipart(self, body: bytes, content_type: str) -> Tuple[Optional[bytes], str]:
        """Parse multipart/form-data and extract first image part."""
        try:
            # Use cgi module to parse multipart
            # Create a fake environ for cgi.FieldStorage
            boundary = None
            for part in content_type.split(';'):
                part = part.strip()
                if part.startswith('boundary='):
                    boundary = part[9:].strip('"\'')
                    break

            if not boundary:
                logger.warning("No boundary found in multipart content-type")
                return None, 'bin'

            # Parse using email.parser for better handling
            # Wrap body with MIME headers
            full_msg = (
                f'Content-Type: {content_type}\r\n'
                f'MIME-Version: 1.0\r\n\r\n'
            ).encode() + body

            parser = BytesParser(policy=email_policy)
            msg = parser.parsebytes(full_msg)

            # Walk through parts looking for image
            if msg.is_multipart():
                for part in msg.iter_parts():
                    part_ct = part.get_content_type()
                    filename = part.get_filename()

                    # Check if this is an image
                    is_image = (
                        part_ct.startswith('image/') or
                        (filename and any(
                            filename.lower().endswith(ext)
                            for ext in ['.jpg', '.jpeg', '.png', '.webp']
                        ))
                    )

                    if is_image:
                        payload = part.get_payload(decode=True)
                        if payload:
                            # Determine extension
                            if part_ct == 'image/jpeg':
                                ext = 'jpg'
                            elif part_ct == 'image/png':
                                ext = 'png'
                            elif part_ct == 'image/webp':
                                ext = 'webp'
                            elif filename:
                                ext = filename.rsplit('.', 1)[-1].lower()
                            else:
                                ext = self._detect_image_type(payload)
                            return payload, ext

            # Fallback: try the whole body as image
            if self._is_image_data(body):
                return body, self._detect_image_type(body)

        except Exception as e:
            logger.warning(f"Multipart parsing error: {e}")
            # Try body directly
            if self._is_image_data(body):
                return body, self._detect_image_type(body)

        return None, 'bin'

    def _is_image_data(self, data: bytes) -> bool:
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

    def _detect_image_type(self, data: bytes) -> str:
        """Detect image type from magic bytes."""
        if len(data) >= 2 and data[:2] == b'\xff\xd8':
            return 'jpg'
        if len(data) >= 8 and data[:8] == b'\x89PNG\r\n\x1a\n':
            return 'png'
        if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return 'webp'
        return 'jpg'  # Default to jpg

    def _save_captured_image(
        self,
        rating_key: str,
        kind: str,
        image_bytes: bytes,
        ext: str,
        timestamp: str
    ) -> str:
        """Save captured image to the by_ratingkey directory."""
        if not self.job_path:
            logger.error("job_path not set on handler!")
            return ''

        output_dir = Path(self.job_path) / 'output' / 'by_ratingkey'
        output_dir.mkdir(parents=True, exist_ok=True)

        # Filename: <ratingKey>_<kind>_<timestamp>.<ext>
        filename = f"{rating_key}_{kind}_{timestamp}.{ext}"
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
        logger.info(f"  Captures saved to: {self.job_path}/output/by_ratingkey/")

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


# ============================================================================
# Config Management
# ============================================================================

def load_preview_config(job_path: Path) -> Dict[str, Any]:
    """Load the preview configuration from the job directory"""
    config_path = job_path / 'config' / 'preview.yml'

    if not config_path.exists():
        raise FileNotFoundError(f"Preview config not found: {config_path}")

    try:
        import yaml
        with open(config_path, 'r') as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        from ruamel.yaml import YAML
        yaml_parser = YAML()
        with open(config_path, 'r') as f:
            return dict(yaml_parser.load(f) or {})


def generate_proxy_config(job_path: Path, preview_config: Dict[str, Any], proxy_url: str) -> Path:
    """
    Generate a Kometa config that points to the proxy instead of real Plex.
    """
    # Determine which YAML library to use
    use_pyyaml = False
    try:
        import yaml as pyyaml
        use_pyyaml = True
    except ImportError:
        pass

    config_dir = job_path / 'config'
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
        'cache_expiration': 1440 if cache_enabled else 0,  # 24 hours in minutes
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
        if use_pyyaml:
            pyyaml.dump(kometa_config, f, default_flow_style=False)
        else:
            # Use ruamel.yaml (available in Kometa image)
            from ruamel.yaml import YAML
            ruamel_yaml = YAML()
            ruamel_yaml.default_flow_style = False
            ruamel_yaml.dump(kometa_config, f)

    logger.info(f"Generated Kometa config: {kometa_config_path}")
    logger.info(f"  Plex URL set to proxy: {proxy_url}")

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


def run_kometa(config_path: Path) -> int:
    """Run Kometa with the given config file."""
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
    targets = preview_data.get('targets', [])

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

    if not job_path.exists():
        logger.error(f"Job directory not found: {job_path}")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("Kometa Preview Studio")
    logger.info("Path A: Real Kometa with Proxy Write Blocking + Upload Capture")
    logger.info("=" * 60)
    logger.info(f"Job path: {job_path}")

    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create output subdirectories
    (output_dir / 'by_ratingkey').mkdir(parents=True, exist_ok=True)

    # Load config
    try:
        preview_config = load_preview_config(job_path)
        logger.info("Preview config loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load preview config: {e}")
        sys.exit(1)

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

    try:
        proxy.start()

        # Generate config that points to our proxy
        kometa_config_path = generate_proxy_config(job_path, preview_config, proxy.proxy_url)

        # Run Kometa
        logger.info("=" * 60)
        logger.info("Starting Kometa...")
        logger.info("=" * 60)

        exit_code = run_kometa(kometa_config_path)

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

        logger.info(f"Blocked {len(blocked_requests)} write attempts")
        logger.info(f"Captured {len(captured_uploads)} uploads")

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
        exported_files, missing_targets = export_overlay_outputs(
            job_path, preview_config, captured_uploads
        )

        # Write summary
        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': exit_code == 0 and len(missing_targets) == 0 and len(exported_files) > 0,
            'kometa_exit_code': exit_code,
            'blocked_write_attempts': blocked_requests,
            'captured_uploads': captured_uploads,
            'captured_uploads_count': len(captured_uploads),
            'successful_captures_count': len(successful_captures),
            'exported_files': exported_files,
            'missing_targets': missing_targets,
            'output_files': [f.name for f in output_dir.glob('*_after.*')],
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
        }

        summary_path = output_dir / 'summary.json'
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)

        logger.info(f"Summary written to: {summary_path}")

        # Report results
        output_count = len(list(output_dir.glob('*_after.*')))
        if output_count > 0 and len(missing_targets) == 0:
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
            final_exit = 1

    finally:
        proxy.stop()

    sys.exit(final_exit)


if __name__ == '__main__':
    main()
