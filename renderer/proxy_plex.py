"""
Plex Write-Blocking Proxy Server with Upload Capture.

This module provides the PlexProxyHandler and PlexProxy classes that intercept
Plex API calls, block writes, and capture uploaded images for preview generation.
"""

import http.client
import re
import ssl
import threading
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

from constants import (
    logger,
    PROXY_PORT,
    PROXY_HOST,
    MOCK_LIBRARY_ENABLED,
    DEBUG_MOCK_XML,
    PLEX_UPLOAD_PATTERN,
    RATING_KEY_EXTRACT_PATTERNS,
)
from xml_builders import (
    filter_media_container_xml,
    create_empty_media_container_xml,
    is_listing_endpoint,
    is_metadata_endpoint,
    is_library_sections_endpoint,
    is_library_section_detail_endpoint,
    is_children_endpoint,
    extract_rating_key_from_path,
    extract_section_id,
    extract_search_query,
    build_synthetic_library_sections_xml,
    build_synthetic_section_detail_xml,
    build_synthetic_listing_xml,
    build_synthetic_children_xml,
    extract_image_from_body,
    is_image_data,
    detect_image_type,
    parse_multipart_image,
)


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
