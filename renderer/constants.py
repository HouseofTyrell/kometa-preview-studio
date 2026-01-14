"""
Constants and configuration for Kometa Preview Studio.

This module contains all global constants, regex patterns, and environment-based
configuration used throughout the preview rendering system.
"""

import logging
import os
import re
import sys

# Configure logging
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

# Mock library mode - prevents forwarding listing endpoints to real Plex
# Set PREVIEW_MOCK_LIBRARY=0 to disable and fall back to filter mode
MOCK_LIBRARY_ENABLED = os.environ.get('PREVIEW_MOCK_LIBRARY', '1') == '1'
DEBUG_MOCK_XML = os.environ.get('PREVIEW_DEBUG_MOCK_XML', '0') == '1'

# ============================================================================
# Plex API Patterns
# ============================================================================

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
# TMDb API Patterns
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
