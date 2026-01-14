"""
TMDb API Proxy for Fast Mode (Caps External ID Expansions).

This module provides the TMDbProxyHandler and TMDbProxy classes that intercept
TMDb API calls and cap results in FAST mode to speed up preview generation.
"""

import hashlib
import http.client
import json
import ssl
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, parse_qs

from constants import (
    logger,
    PROXY_HOST,
    TMDB_PROXY_PORT,
    TMDB_PAGINATED_ENDPOINTS,
    TMDB_LIST_ENDPOINTS,
)


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
    skipped_tvdb_conversions: int = 0  # H1: Track skipped TMDb -> TVDb conversions
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

            # H1: In FAST mode, skip TMDb -> TVDb conversion requests (external_ids for TV shows)
            if self.fast_mode and self._is_tvdb_conversion_request(path):
                with self.data_lock:
                    self.skipped_tvdb_conversions += 1
                    # Log once per run (not per item)
                    if not self.tvdb_skip_logged:
                        logger.info("FAST_PREVIEW: skipped TMDb->TVDb conversions (external_ids)")
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
        H1: Detect if this is a TMDb -> TVDb ID conversion request.

        In FAST mode, we skip these because:
        - TV show external_ids lookups are used to get TVDb IDs
        - TVDb ID lookups add significant latency (external API calls)
        - Overlays typically don't require TVDb IDs for preview rendering

        Returns True for:
        - /tv/{id}/external_ids - TV show external IDs (includes tvdb_id)
        - /find/{external_id}?external_source=tvdb_id - TVDb -> TMDb lookups
        """
        path_base = path.split('?')[0]

        # Match /tv/{id}/external_ids
        if '/tv/' in path_base and '/external_ids' in path_base:
            return True

        # Match /find/ with tvdb_id source
        if '/find/' in path_base:
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
