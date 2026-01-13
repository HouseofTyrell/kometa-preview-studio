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
from datetime import datetime
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse
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

# Plex upload endpoint patterns
# Matches: /library/metadata/<ratingKey>/posters, /library/metadata/<ratingKey>/arts, etc.
PLEX_UPLOAD_PATTERN = re.compile(
    r'^/library/metadata/(\d+)/(posters?|arts?|thumbs?)(?:\?.*)?$'
)


# ============================================================================
# Plex Write-Blocking Proxy Server with Upload Capture
# ============================================================================

class PlexProxyHandler(BaseHTTPRequestHandler):
    """
    HTTP proxy handler that forwards GET/HEAD to real Plex and blocks writes
    while CAPTURING the uploaded image data.

    This provides process-boundary-safe write blocking because Kometa
    (running as subprocess) connects to this proxy instead of real Plex.
    """

    # Class-level configuration (set before server starts)
    real_plex_url: str = ''
    real_plex_host: str = ''
    real_plex_port: int = 32400
    real_plex_scheme: str = 'http'
    plex_token: str = ''
    job_path: str = ''

    # Captured data
    blocked_requests: List[Dict[str, str]] = []
    captured_uploads: List[Dict[str, Any]] = []
    data_lock = threading.Lock()

    def log_message(self, format, *args):
        """Override to use our logger"""
        logger.debug(f"PROXY: {args[0]}")

    def do_GET(self):
        """Forward GET requests to real Plex"""
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
        """Forward a read request to the real Plex server"""
        try:
            path = self.path

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

            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('transfer-encoding', 'connection'):
                    self.send_header(key, value)
            self.end_headers()

            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                self.wfile.write(chunk)

            conn.close()

        except Exception as e:
            logger.error(f"PROXY ERROR forwarding {method} {self.path}: {e}")
            self.send_error(502, f"Proxy error: {e}")

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
    Manages the Plex write-blocking proxy server with upload capture.
    """

    def __init__(self, real_plex_url: str, plex_token: str, job_path: Path):
        self.real_plex_url = real_plex_url.rstrip('/')
        self.plex_token = plex_token
        self.job_path = job_path

        # Parse the real Plex URL
        parsed = urlparse(real_plex_url)
        self.real_host = parsed.hostname or 'localhost'
        self.real_port = parsed.port or 32400
        self.real_scheme = parsed.scheme or 'http'

        self.server: Optional[HTTPServer] = None
        self.server_thread: Optional[threading.Thread] = None

        # Configure the handler class
        PlexProxyHandler.real_plex_url = self.real_plex_url
        PlexProxyHandler.real_plex_host = self.real_host
        PlexProxyHandler.real_plex_port = self.real_port
        PlexProxyHandler.real_plex_scheme = self.real_scheme
        PlexProxyHandler.plex_token = plex_token
        PlexProxyHandler.job_path = str(job_path)
        PlexProxyHandler.blocked_requests = []
        PlexProxyHandler.captured_uploads = []

    @property
    def proxy_url(self) -> str:
        """URL that Kometa should connect to"""
        return f"http://{PROXY_HOST}:{PROXY_PORT}"

    def start(self):
        """Start the proxy server in a background thread"""
        self.server = HTTPServer((PROXY_HOST, PROXY_PORT), PlexProxyHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        logger.info(f"Plex proxy started at {self.proxy_url}")
        logger.info(f"  Forwarding reads to: {self.real_plex_url}")
        logger.info(f"  Blocking and capturing writes")
        logger.info(f"  Captures saved to: {self.job_path}/output/by_ratingkey/")

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
    try:
        import yaml
    except ImportError:
        from ruamel.yaml import YAML
        yaml = YAML()

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
    kometa_config['settings'] = {
        'cache': False,
        'cache_expiration': 0,
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
        if hasattr(yaml, 'dump'):
            yaml.dump(kometa_config, f, default_flow_style=False)
        else:
            yaml.dump(kometa_config, f)

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

    # Log target ratingKeys for debugging
    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])
    logger.info(f"Preview targets ({len(targets)}):")
    for t in targets:
        rk = t.get('ratingKey') or t.get('rating_key') or 'MISSING'
        logger.info(f"  - {t.get('id')}: ratingKey={rk}")

    # Start the write-blocking proxy with capture
    proxy = PlexProxy(real_plex_url, plex_token, job_path)

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

        logger.info(f"Blocked {len(blocked_requests)} write attempts")
        logger.info(f"Captured {len(captured_uploads)} uploads")

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
