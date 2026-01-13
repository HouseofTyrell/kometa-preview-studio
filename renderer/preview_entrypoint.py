#!/usr/bin/env python3
"""
Kometa Preview Studio - Preview Renderer (Path A with Proxy)

This script runs REAL Kometa inside the container with a local HTTP proxy
that blocks all write operations to Plex while allowing reads.

SAFETY MECHANISM:
- A local proxy server intercepts all Plex requests
- GET/HEAD requests are forwarded to the real Plex server
- PUT/POST/PATCH/DELETE requests are blocked and logged
- This works across process boundaries (subprocess-safe)

Usage:
    python3 preview_entrypoint.py --job /jobs/<jobId>
"""

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import traceback
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urljoin
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


# ============================================================================
# Plex Write-Blocking Proxy Server
# ============================================================================

class PlexProxyHandler(BaseHTTPRequestHandler):
    """
    HTTP proxy handler that forwards GET/HEAD to real Plex and blocks writes.

    This provides process-boundary-safe write blocking because Kometa
    (running as subprocess) connects to this proxy instead of real Plex.
    """

    # Class-level configuration (set before server starts)
    real_plex_url: str = ''
    real_plex_host: str = ''
    real_plex_port: int = 32400
    real_plex_scheme: str = 'http'
    plex_token: str = ''
    blocked_requests: List[Dict[str, str]] = []
    blocked_lock = threading.Lock()

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
        """Block POST requests"""
        self._block_request('POST')

    def do_PUT(self):
        """Block PUT requests"""
        self._block_request('PUT')

    def do_PATCH(self):
        """Block PATCH requests"""
        self._block_request('PATCH')

    def do_DELETE(self):
        """Block DELETE requests"""
        self._block_request('DELETE')

    def _forward_request(self, method: str):
        """Forward a read request to the real Plex server"""
        try:
            # Build the target URL
            path = self.path

            # Create connection to real Plex
            if self.real_plex_scheme == 'https':
                # Allow self-signed certs for local Plex servers
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

            # Make the request
            conn.request(method, path, headers=headers)
            response = conn.getresponse()

            # Send response back to client
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() not in ('transfer-encoding', 'connection'):
                    self.send_header(key, value)
            self.end_headers()

            # Stream response body
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
        """Block a write request and log it"""
        # Log the blocked request
        blocked_entry = {
            'method': method,
            'path': self.path,
            'timestamp': datetime.now().isoformat()
        }

        with self.blocked_lock:
            self.blocked_requests.append(blocked_entry)

        logger.warning(f"BLOCKED_WRITE: {method} {self.path}")

        # Return success to keep Kometa happy (it thinks the write succeeded)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', '2')
        self.end_headers()
        self.wfile.write(b'{}')


class PlexProxy:
    """
    Manages the Plex write-blocking proxy server.
    """

    def __init__(self, real_plex_url: str, plex_token: str):
        self.real_plex_url = real_plex_url.rstrip('/')
        self.plex_token = plex_token

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
        PlexProxyHandler.blocked_requests = []

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
        logger.info(f"  Blocking all writes")

    def stop(self):
        """Stop the proxy server"""
        if self.server:
            self.server.shutdown()
            logger.info("Plex proxy stopped")

    def get_blocked_requests(self) -> List[Dict[str, str]]:
        """Return list of blocked write attempts"""
        with PlexProxyHandler.blocked_lock:
            return PlexProxyHandler.blocked_requests.copy()


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

    This ensures all Plex communication goes through our write-blocking proxy.
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
            'url': proxy_url,  # Point to our proxy!
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
        # Handle the older format where overlays was a top-level key
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

    # Write the config
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
    """
    Run Kometa with the given config file.

    Returns the exit code.
    """
    kometa_script = find_kometa_script()

    if kometa_script:
        logger.info(f"Running Kometa from: {kometa_script}")
        cmd = [
            sys.executable, str(kometa_script),
            '-r',  # Run once
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

        # Stream output
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
# Output Export
# ============================================================================

def find_kometa_overlay_outputs(config_path: Path) -> List[Path]:
    """
    Find rendered overlay images that Kometa produced.

    Kometa saves rendered overlays to: {config_dir}/overlays/temp.{ext}
    before uploading. We look for any image files in the overlays directory.
    """
    config_dir = config_path.parent

    # Kometa's default overlay folder is relative to config
    overlay_dirs = [
        config_dir / 'overlays',
        Path('/config/overlays'),
        Path('/overlays'),
    ]

    found_files = []

    for overlay_dir in overlay_dirs:
        if overlay_dir.exists():
            logger.info(f"Checking overlay directory: {overlay_dir}")

            # Look for image files
            for ext in ['*.png', '*.jpg', '*.jpeg', '*.webp']:
                for f in overlay_dir.glob(ext):
                    logger.info(f"  Found: {f}")
                    found_files.append(f)

            # Also check subdirectories
            for subdir in overlay_dir.iterdir():
                if subdir.is_dir():
                    for ext in ['*.png', '*.jpg', '*.jpeg', '*.webp']:
                        for f in subdir.glob(ext):
                            logger.info(f"  Found: {f}")
                            found_files.append(f)

    return found_files


def export_overlay_outputs(
    job_path: Path,
    kometa_config_path: Path,
    preview_config: Dict[str, Any]
) -> Dict[str, str]:
    """
    Export Kometa's rendered overlay outputs to the job output directory.

    Returns a mapping of target_id -> output_file.
    """
    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    exported = {}

    # Get preview targets
    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])

    # Find Kometa's overlay outputs
    overlay_files = find_kometa_overlay_outputs(kometa_config_path)

    if not overlay_files:
        logger.warning("No overlay output files found from Kometa")

        # Check if there are any temp files
        config_dir = kometa_config_path.parent
        temp_files = list(config_dir.glob('**/temp.*'))
        if temp_files:
            logger.info(f"Found temp files: {temp_files}")
            overlay_files = temp_files

    # Try to map outputs to targets
    # For now, if we have a single temp file, copy it for each target
    # This is a simplification - proper implementation would track which
    # item each overlay was rendered for

    if overlay_files:
        # Use the most recently modified file
        overlay_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
        latest_overlay = overlay_files[0]

        for target in targets:
            target_id = target.get('id', '')
            if target_id:
                output_path = output_dir / f"{target_id}_after.png"
                try:
                    shutil.copy2(latest_overlay, output_path)
                    exported[target_id] = str(output_path)
                    logger.info(f"Exported: {target_id} -> {output_path}")
                except Exception as e:
                    logger.error(f"Failed to export {target_id}: {e}")

    return exported


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Main entry point for the Kometa Preview Renderer"""
    parser = argparse.ArgumentParser(
        description='Kometa Preview Renderer - Runs real Kometa with proxy-based write blocking'
    )
    parser.add_argument('--job', required=True, help='Path to job directory')
    args = parser.parse_args()

    job_path = Path(args.job)

    if not job_path.exists():
        logger.error(f"Job directory not found: {job_path}")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("Kometa Preview Studio")
    logger.info("Path A: Real Kometa with Proxy Write Blocking")
    logger.info("=" * 60)
    logger.info(f"Job path: {job_path}")

    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

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

    # Start the write-blocking proxy
    proxy = PlexProxy(real_plex_url, plex_token)

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

        # Get blocked requests
        blocked_requests = proxy.get_blocked_requests()

        # Export outputs
        exported_files = export_overlay_outputs(job_path, kometa_config_path, preview_config)

        # Write summary
        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': exit_code == 0 and len(exported_files) > 0,
            'kometa_exit_code': exit_code,
            'blocked_write_attempts': blocked_requests,
            'exported_files': exported_files,
            'output_files': [f.name for f in output_dir.glob('*_after.png')],
        }

        summary_path = output_dir / 'summary.json'
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)

        logger.info(f"Summary written to: {summary_path}")

        # Log blocked requests
        if blocked_requests:
            logger.info(f"Blocked {len(blocked_requests)} Plex write attempts:")
            for req in blocked_requests:
                logger.info(f"  BLOCKED: {req['method']} {req['path']}")
        else:
            logger.info("No Plex write attempts were made")

        # Report results
        output_count = len(list(output_dir.glob('*_after.png')))
        if output_count > 0:
            logger.info(f"Preview rendering complete: {output_count} images generated")
            final_exit = 0
        else:
            logger.error("Preview rendering failed: no output images generated")
            final_exit = 1

    finally:
        proxy.stop()

    sys.exit(final_exit)


if __name__ == '__main__':
    main()
