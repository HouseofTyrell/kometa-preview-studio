"""
XML building and filtering for Kometa Preview Studio.

This module provides functions for building synthetic Plex XML responses
and filtering XML responses based on allowed rating keys.
"""

import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urlsplit, parse_qs

from constants import (
    logger,
    LIBRARY_LISTING_PATTERNS,
    METADATA_PATTERN,
    ARTWORK_PATTERNS,
    PLEX_UPLOAD_PATTERN,
    LIBRARY_SECTIONS_PATTERN,
    LIBRARY_SECTION_DETAIL_PATTERN,
    SECTION_ID_PATTERN,
    CHILDREN_PATTERN,
    LIBRARY_FILTER_TYPES_PATTERN,
)


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
    from caching import safe_preview_targets

    allowed = set()
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


def build_synthetic_filter_types_xml(section_id: str, targets: List[Dict[str, Any]]) -> bytes:
    """
    Build synthetic /library/sections/{id}/filterTypes XML response.

    This endpoint is called by plexapi.library.listFilters() when Kometa uses
    plex_search with attributes like resolution, audio_codec, hdr, etc.

    The response format matches what plexapi expects in getFilterType():
    - MediaContainer with Type elements (one per libtype: movie, show, etc.)
    - Each Type contains Filter elements describing available filters

    Args:
        section_id: The requested section ID
        targets: List of preview targets to determine the library type

    Returns:
        XML bytes for MediaContainer with Type and Filter elements
    """
    # Determine section type based on targets
    has_movies = any(t.get('type') in ('movie', 'movies') for t in targets)
    has_shows = any(t.get('type') in ('show', 'shows', 'series', 'season', 'episode') for t in targets)

    # Build the MediaContainer
    root = ET.Element('MediaContainer', {
        'size': '1',
        'allowSync': '0',
        'identifier': 'com.plexapp.plugins.library',
    })

    # Common movie filters (used by Kometa's plex_search)
    movie_filters = [
        {'filter': 'resolution', 'filterType': 'string', 'key': 'resolution', 'title': 'Resolution', 'type': 'filter'},
        {'filter': 'audioCodec', 'filterType': 'string', 'key': 'audioCodec', 'title': 'Audio Codec', 'type': 'filter'},
        {'filter': 'videoCodec', 'filterType': 'string', 'key': 'videoCodec', 'title': 'Video Codec', 'type': 'filter'},
        {'filter': 'audioChannels', 'filterType': 'integer', 'key': 'audioChannels', 'title': 'Audio Channels', 'type': 'filter'},
        {'filter': 'videoFrameRate', 'filterType': 'string', 'key': 'videoFrameRate', 'title': 'Frame Rate', 'type': 'filter'},
        {'filter': 'container', 'filterType': 'string', 'key': 'container', 'title': 'Container', 'type': 'filter'},
        {'filter': 'hdr', 'filterType': 'boolean', 'key': 'hdr', 'title': 'HDR', 'type': 'filter'},
        {'filter': 'unmatched', 'filterType': 'boolean', 'key': 'unmatched', 'title': 'Unmatched', 'type': 'filter'},
        {'filter': 'inProgress', 'filterType': 'boolean', 'key': 'inProgress', 'title': 'In Progress', 'type': 'filter'},
        {'filter': 'unwatched', 'filterType': 'boolean', 'key': 'unwatched', 'title': 'Unwatched', 'type': 'filter'},
        {'filter': 'year', 'filterType': 'integer', 'key': 'year', 'title': 'Year', 'type': 'filter'},
        {'filter': 'decade', 'filterType': 'integer', 'key': 'decade', 'title': 'Decade', 'type': 'filter'},
        {'filter': 'genre', 'filterType': 'string', 'key': 'genre', 'title': 'Genre', 'type': 'filter'},
        {'filter': 'contentRating', 'filterType': 'string', 'key': 'contentRating', 'title': 'Content Rating', 'type': 'filter'},
        {'filter': 'collection', 'filterType': 'string', 'key': 'collection', 'title': 'Collection', 'type': 'filter'},
        {'filter': 'director', 'filterType': 'string', 'key': 'director', 'title': 'Director', 'type': 'filter'},
        {'filter': 'actor', 'filterType': 'string', 'key': 'actor', 'title': 'Actor', 'type': 'filter'},
        {'filter': 'studio', 'filterType': 'string', 'key': 'studio', 'title': 'Studio', 'type': 'filter'},
        {'filter': 'country', 'filterType': 'string', 'key': 'country', 'title': 'Country', 'type': 'filter'},
        {'filter': 'addedAt', 'filterType': 'date', 'key': 'addedAt', 'title': 'Date Added', 'type': 'filter'},
        {'filter': 'originallyAvailableAt', 'filterType': 'date', 'key': 'originallyAvailableAt', 'title': 'Release Date', 'type': 'filter'},
        {'filter': 'duration', 'filterType': 'integer', 'key': 'duration', 'title': 'Duration', 'type': 'filter'},
        {'filter': 'audienceRating', 'filterType': 'integer', 'key': 'audienceRating', 'title': 'Audience Rating', 'type': 'filter'},
        {'filter': 'rating', 'filterType': 'integer', 'key': 'rating', 'title': 'Critic Rating', 'type': 'filter'},
    ]

    # Common show filters
    show_filters = [
        {'filter': 'resolution', 'filterType': 'string', 'key': 'resolution', 'title': 'Resolution', 'type': 'filter'},
        {'filter': 'audioCodec', 'filterType': 'string', 'key': 'audioCodec', 'title': 'Audio Codec', 'type': 'filter'},
        {'filter': 'videoCodec', 'filterType': 'string', 'key': 'videoCodec', 'title': 'Video Codec', 'type': 'filter'},
        {'filter': 'hdr', 'filterType': 'boolean', 'key': 'hdr', 'title': 'HDR', 'type': 'filter'},
        {'filter': 'unmatched', 'filterType': 'boolean', 'key': 'unmatched', 'title': 'Unmatched', 'type': 'filter'},
        {'filter': 'inProgress', 'filterType': 'boolean', 'key': 'inProgress', 'title': 'In Progress', 'type': 'filter'},
        {'filter': 'unwatched', 'filterType': 'boolean', 'key': 'unwatched', 'title': 'Unwatched', 'type': 'filter'},
        {'filter': 'year', 'filterType': 'integer', 'key': 'year', 'title': 'Year', 'type': 'filter'},
        {'filter': 'genre', 'filterType': 'string', 'key': 'genre', 'title': 'Genre', 'type': 'filter'},
        {'filter': 'contentRating', 'filterType': 'string', 'key': 'contentRating', 'title': 'Content Rating', 'type': 'filter'},
        {'filter': 'collection', 'filterType': 'string', 'key': 'collection', 'title': 'Collection', 'type': 'filter'},
        {'filter': 'network', 'filterType': 'string', 'key': 'network', 'title': 'Network', 'type': 'filter'},
        {'filter': 'actor', 'filterType': 'string', 'key': 'actor', 'title': 'Actor', 'type': 'filter'},
        {'filter': 'studio', 'filterType': 'string', 'key': 'studio', 'title': 'Studio', 'type': 'filter'},
        {'filter': 'country', 'filterType': 'string', 'key': 'country', 'title': 'Country', 'type': 'filter'},
        {'filter': 'addedAt', 'filterType': 'date', 'key': 'addedAt', 'title': 'Date Added', 'type': 'filter'},
        {'filter': 'originallyAvailableAt', 'filterType': 'date', 'key': 'originallyAvailableAt', 'title': 'First Aired', 'type': 'filter'},
        {'filter': 'unviewedLeafCount', 'filterType': 'integer', 'key': 'unviewedLeafCount', 'title': 'Unplayed Episodes', 'type': 'filter'},
    ]

    # Season filters (subset of show filters)
    season_filters = [
        {'filter': 'resolution', 'filterType': 'string', 'key': 'resolution', 'title': 'Resolution', 'type': 'filter'},
        {'filter': 'audioCodec', 'filterType': 'string', 'key': 'audioCodec', 'title': 'Audio Codec', 'type': 'filter'},
        {'filter': 'videoCodec', 'filterType': 'string', 'key': 'videoCodec', 'title': 'Video Codec', 'type': 'filter'},
        {'filter': 'hdr', 'filterType': 'boolean', 'key': 'hdr', 'title': 'HDR', 'type': 'filter'},
        {'filter': 'unwatched', 'filterType': 'boolean', 'key': 'unwatched', 'title': 'Unwatched', 'type': 'filter'},
    ]

    # Episode filters
    episode_filters = [
        {'filter': 'resolution', 'filterType': 'string', 'key': 'resolution', 'title': 'Resolution', 'type': 'filter'},
        {'filter': 'audioCodec', 'filterType': 'string', 'key': 'audioCodec', 'title': 'Audio Codec', 'type': 'filter'},
        {'filter': 'videoCodec', 'filterType': 'string', 'key': 'videoCodec', 'title': 'Video Codec', 'type': 'filter'},
        {'filter': 'hdr', 'filterType': 'boolean', 'key': 'hdr', 'title': 'HDR', 'type': 'filter'},
        {'filter': 'unwatched', 'filterType': 'boolean', 'key': 'unwatched', 'title': 'Unwatched', 'type': 'filter'},
        {'filter': 'year', 'filterType': 'integer', 'key': 'year', 'title': 'Year', 'type': 'filter'},
        {'filter': 'originallyAvailableAt', 'filterType': 'date', 'key': 'originallyAvailableAt', 'title': 'Air Date', 'type': 'filter'},
    ]

    # Add movie type if we have movies
    if section_id == '1' or (has_movies and not has_shows):
        movie_type = ET.SubElement(root, 'Type', {
            'key': '1',
            'type': 'movie',
            'title': 'Movie',
            'active': '1',
        })
        for f in movie_filters:
            ET.SubElement(movie_type, 'Filter', f)

    # Add show types if we have shows
    if section_id == '2' or (has_shows and not has_movies):
        # Show type
        show_type = ET.SubElement(root, 'Type', {
            'key': '2',
            'type': 'show',
            'title': 'Show',
            'active': '1',
        })
        for f in show_filters:
            ET.SubElement(show_type, 'Filter', f)

        # Season type
        season_type = ET.SubElement(root, 'Type', {
            'key': '3',
            'type': 'season',
            'title': 'Season',
            'active': '0',
        })
        for f in season_filters:
            ET.SubElement(season_type, 'Filter', f)

        # Episode type
        episode_type = ET.SubElement(root, 'Type', {
            'key': '4',
            'type': 'episode',
            'title': 'Episode',
            'active': '0',
        })
        for f in episode_filters:
            ET.SubElement(episode_type, 'Filter', f)

        # Update size to reflect number of types
        root.set('size', '3')

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
    ET.SubElement(media_elem, 'Part', part_attrs)

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


def is_filter_types_endpoint(path: str) -> Optional[str]:
    """
    Check if path is /library/sections/{id}/filterTypes.

    This endpoint is called by plexapi.library.listFilters() when Kometa
    uses plex_search with attributes like resolution, audio_codec, etc.

    Returns the section ID if matched, None otherwise.
    """
    path_base = path.split('?')[0]
    match = LIBRARY_FILTER_TYPES_PATTERN.match(path_base)
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
# Image Detection Helpers
# ============================================================================

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


def parse_multipart_image(body: bytes, content_type: str) -> tuple:
    """Parse multipart/form-data and extract first image part."""
    from email.parser import BytesParser
    from email.policy import default as email_policy

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


def extract_image_from_body(body: bytes, content_type: str) -> tuple:
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
