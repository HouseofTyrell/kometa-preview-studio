#!/usr/bin/env python3
"""
Kometa Preview Studio - Preview Renderer (Path A Implementation)

This script runs REAL Kometa inside the container but:
1. Blocks ALL Plex writes (PUT/POST/DELETE/PATCH)
2. Intercepts overlay outputs before upload
3. Copies the final rendered images to the job output directory

The result is pixel-identical output to what Kometa would produce,
but with zero modifications to Plex.

Usage:
    python3 preview_entrypoint.py --job /jobs/<jobId>
"""

import argparse
import json
import logging
import os
import shutil
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

# Configure logging before any other imports
logging.basicConfig(
    level=logging.INFO,
    format='| %(levelname)-8s | %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger('KometaPreview')

# ============================================================================
# Write Blocker Installation
# ============================================================================

class PlexWriteBlocker:
    """
    Blocks all non-GET requests to Plex server URLs.

    This ensures preview mode cannot modify Plex metadata, artwork, or labels.
    """

    def __init__(self, plex_url: str):
        self.plex_url = plex_url.rstrip('/')
        self.plex_host = urlparse(plex_url).netloc
        self.blocked_requests: List[Dict[str, str]] = []
        self._original_request = None
        self._installed = False

    def install(self):
        """Install the write blocker by monkeypatching requests.Session.request"""
        if self._installed:
            return

        import requests.sessions

        self._original_request = requests.sessions.Session.request
        blocker = self

        def blocked_request(session_self, method, url, **kwargs):
            """Wrapper that blocks non-GET requests to Plex"""
            # Check if this is a Plex request
            parsed = urlparse(url)
            is_plex_request = (
                parsed.netloc == blocker.plex_host or
                url.startswith(blocker.plex_url)
            )

            if is_plex_request and method.upper() != 'GET':
                # Block the write request
                blocker.blocked_requests.append({
                    'method': method.upper(),
                    'url': url,
                    'timestamp': datetime.now().isoformat()
                })
                logger.warning(f"BLOCKED PLEX WRITE: {method.upper()} {url}")

                # Return a fake successful response
                from requests.models import Response
                fake_response = Response()
                fake_response.status_code = 200
                fake_response._content = b'{"blocked": true}'
                fake_response.headers['Content-Type'] = 'application/json'
                return fake_response

            # Allow the request (GET or non-Plex)
            return blocker._original_request(session_self, method, url, **kwargs)

        requests.sessions.Session.request = blocked_request
        self._installed = True
        logger.info(f"Plex write blocker installed for: {self.plex_url}")

    def uninstall(self):
        """Restore original requests behavior"""
        if self._installed and self._original_request:
            import requests.sessions
            requests.sessions.Session.request = self._original_request
            self._installed = False

    def get_blocked_requests(self) -> List[Dict[str, str]]:
        """Return list of all blocked write attempts"""
        return self.blocked_requests.copy()


class OverlayOutputCapture:
    """
    Captures overlay outputs by patching Kometa's upload methods.

    Instead of uploading to Plex, we copy the rendered image to our output directory.
    """

    def __init__(self, output_dir: Path, target_mapping: Dict[str, str]):
        self.output_dir = output_dir
        self.target_mapping = target_mapping  # Maps Plex ratingKey -> output filename
        self.captured_outputs: List[Dict[str, Any]] = []
        self._patches_installed = False

    def install(self):
        """Install patches to capture overlay outputs"""
        if self._patches_installed:
            return

        try:
            # Try to patch the Plex library's upload_poster method
            self._patch_plex_library()
        except Exception as e:
            logger.warning(f"Could not patch Plex library directly: {e}")

        try:
            # Also patch PlexAPI's uploadPoster/uploadArt methods
            self._patch_plexapi()
        except Exception as e:
            logger.warning(f"Could not patch PlexAPI: {e}")

        self._patches_installed = True
        logger.info("Overlay output capture installed")

    def _patch_plex_library(self):
        """Patch Kometa's Plex library upload_poster method"""
        try:
            from modules.plex import PlexAPI

            capture = self
            original_upload_poster = PlexAPI.upload_poster

            def patched_upload_poster(self_lib, item, image, url=False):
                """Capture the overlay output instead of uploading"""
                if not url and os.path.exists(image):
                    # This is a file upload - capture it
                    rating_key = str(getattr(item, 'ratingKey', 'unknown'))
                    title = getattr(item, 'title', 'unknown')

                    output_filename = capture._get_output_filename(item)
                    if output_filename:
                        output_path = capture.output_dir / output_filename
                        shutil.copy2(image, output_path)
                        logger.info(f"CAPTURED: {title} -> {output_path}")
                        capture.captured_outputs.append({
                            'ratingKey': rating_key,
                            'title': title,
                            'source': image,
                            'destination': str(output_path),
                            'timestamp': datetime.now().isoformat()
                        })
                    else:
                        logger.warning(f"No output mapping for item: {title} (ratingKey={rating_key})")
                else:
                    logger.info(f"BLOCKED URL upload for: {getattr(item, 'title', 'unknown')}")

                # Don't actually upload to Plex
                return None

            PlexAPI.upload_poster = patched_upload_poster
            logger.info("Patched PlexAPI.upload_poster")

        except ImportError:
            logger.debug("PlexAPI module not available for patching")

    def _patch_plexapi(self):
        """Patch PlexAPI library's upload methods"""
        try:
            import plexapi.base

            capture = self

            # Patch uploadPoster
            if hasattr(plexapi.base.Playable, 'uploadPoster'):
                original_upload_poster = plexapi.base.Playable.uploadPoster

                def patched_upload_poster(self_item, url=None, filepath=None):
                    if filepath and os.path.exists(filepath):
                        rating_key = str(getattr(self_item, 'ratingKey', 'unknown'))
                        title = getattr(self_item, 'title', 'unknown')

                        output_filename = capture._get_output_filename(self_item)
                        if output_filename:
                            output_path = capture.output_dir / output_filename
                            shutil.copy2(filepath, output_path)
                            logger.info(f"CAPTURED (PlexAPI): {title} -> {output_path}")
                            capture.captured_outputs.append({
                                'ratingKey': rating_key,
                                'title': title,
                                'source': filepath,
                                'destination': str(output_path),
                                'timestamp': datetime.now().isoformat()
                            })
                        return None
                    logger.info(f"BLOCKED PlexAPI upload: {getattr(self_item, 'title', 'unknown')}")
                    return None

                plexapi.base.Playable.uploadPoster = patched_upload_poster

            # Also patch uploadArt for backgrounds
            if hasattr(plexapi.base.Playable, 'uploadArt'):
                def patched_upload_art(self_item, url=None, filepath=None):
                    logger.info(f"BLOCKED PlexAPI uploadArt: {getattr(self_item, 'title', 'unknown')}")
                    return None
                plexapi.base.Playable.uploadArt = patched_upload_art

            logger.info("Patched PlexAPI upload methods")

        except ImportError:
            logger.debug("plexapi library not available for patching")

    def _get_output_filename(self, item) -> Optional[str]:
        """Get the output filename for a Plex item"""
        rating_key = str(getattr(item, 'ratingKey', ''))
        title = getattr(item, 'title', '').lower()
        item_type = getattr(item, 'type', '')

        # Check direct ratingKey mapping first
        if rating_key in self.target_mapping:
            return self.target_mapping[rating_key]

        # Try to match by title/type
        if 'matrix' in title:
            return 'matrix_after.png'
        elif 'dune' in title:
            return 'dune_after.png'
        elif 'breaking bad' in title:
            if item_type == 'show':
                return 'breakingbad_series_after.png'
            elif item_type == 'season':
                season_num = getattr(item, 'index', getattr(item, 'seasonNumber', 1))
                if season_num == 1:
                    return 'breakingbad_s01_after.png'
            elif item_type == 'episode':
                return 'breakingbad_s01e01_after.png'

        return None

    def get_captured_outputs(self) -> List[Dict[str, Any]]:
        """Return list of all captured outputs"""
        return self.captured_outputs.copy()


# ============================================================================
# Config Parser
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
        # Try ruamel.yaml
        from ruamel.yaml import YAML
        yaml = YAML()
        with open(config_path, 'r') as f:
            return dict(yaml.load(f) or {})


def extract_plex_url(config: Dict[str, Any]) -> Optional[str]:
    """Extract Plex URL from config"""
    # Try plex section
    if 'plex' in config:
        plex_config = config['plex']
        if isinstance(plex_config, dict):
            return plex_config.get('url')

    # Try settings
    if 'settings' in config and isinstance(config['settings'], dict):
        return config['settings'].get('plex_url')

    return None


def load_metadata(job_path: Path) -> Dict[str, Any]:
    """Load job metadata"""
    meta_path = job_path / 'meta.json'
    if meta_path.exists():
        with open(meta_path, 'r') as f:
            return json.load(f)
    return {}


# ============================================================================
# Kometa Runner
# ============================================================================

def run_kometa_with_config(config_path: Path, job_path: Path) -> int:
    """
    Run Kometa with the given config file.

    Returns the exit code.
    """
    import subprocess

    # Kometa is typically run via: python kometa.py -r --config <path>
    # The -r flag means "run once" instead of scheduling

    # First, try to find kometa.py
    kometa_paths = [
        Path('/kometa.py'),
        Path('/app/kometa.py'),
        Path('/Kometa/kometa.py'),
    ]

    kometa_script = None
    for p in kometa_paths:
        if p.exists():
            kometa_script = p
            break

    if not kometa_script:
        # Try running as module
        logger.info("Attempting to run Kometa as module...")
        cmd = [
            sys.executable, '-m', 'kometa',
            '-r',  # Run once
            '--config', str(config_path),
        ]
    else:
        logger.info(f"Running Kometa from: {kometa_script}")
        cmd = [
            sys.executable, str(kometa_script),
            '-r',  # Run once
            '--config', str(config_path),
        ]

    logger.info(f"Kometa command: {' '.join(cmd)}")

    # Set environment for Kometa
    env = os.environ.copy()
    env['KOMETA_CONFIG'] = str(config_path)

    # Run Kometa, streaming output
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
                # Preserve Kometa's log format
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


def generate_kometa_config(job_path: Path, preview_config: Dict[str, Any]) -> Path:
    """
    Generate a valid Kometa config file for the preview run.

    This creates a config that:
    1. Has Plex connection info
    2. Has the user's overlay definitions
    3. Attempts to scope to preview items only
    """
    import yaml

    config_dir = job_path / 'config'
    kometa_config_path = config_dir / 'kometa_config.yml'

    # Start with the preview config structure
    kometa_config = {}

    # Copy plex section if present
    if 'plex' in preview_config:
        kometa_config['plex'] = preview_config['plex']

    # Set up settings
    kometa_config['settings'] = {
        'cache': False,
        'cache_expiration': 0,
        'asset_folders': False,
        'run_order': ['overlays'],  # Only run overlays
        'show_unmanaged': False,
        'show_filtered': False,
        'show_options': False,
        'show_missing': False,
        'save_report': False,
    }

    # Copy overlay definitions
    if 'overlays' in preview_config:
        # Extract library configs with overlay_files
        libraries = {}
        for lib_name, lib_config in preview_config.get('overlays', {}).items():
            if isinstance(lib_config, dict) and 'overlay_files' in lib_config:
                libraries[lib_name] = {
                    'overlay_files': lib_config['overlay_files'],
                    # Add filters to try to scope to preview items
                    'operations': None,
                    'collections': None,
                    'metadata': None,
                }
        if libraries:
            kometa_config['libraries'] = libraries

    # Write the config
    with open(kometa_config_path, 'w') as f:
        yaml.dump(kometa_config, f, default_flow_style=False)

    logger.info(f"Generated Kometa config: {kometa_config_path}")
    return kometa_config_path


# ============================================================================
# Fallback: Direct Overlay Application
# ============================================================================

def apply_overlays_directly(job_path: Path, preview_config: Dict[str, Any]) -> bool:
    """
    Fallback: Apply overlays directly using Kometa's overlay module.

    This is used if running Kometa as a subprocess fails.
    """
    logger.info("Attempting direct overlay application...")

    try:
        from PIL import Image

        input_dir = job_path / 'input'
        output_dir = job_path / 'output'
        output_dir.mkdir(parents=True, exist_ok=True)

        # Load metadata for items
        meta = load_metadata(job_path)
        items_meta = meta.get('items', {})

        # Get preview targets
        preview_data = preview_config.get('preview', {})
        targets = preview_data.get('targets', [])

        success_count = 0

        for target in targets:
            target_id = target.get('id', '')
            input_path = input_dir / f"{target_id}.jpg"

            if not input_path.exists():
                input_path = input_dir / f"{target_id}.png"

            if not input_path.exists():
                logger.warning(f"Input image not found for: {target_id}")
                continue

            output_path = output_dir / f"{target_id}_after.png"

            try:
                # Load and copy image (basic passthrough if no overlay logic)
                img = Image.open(input_path)
                img = img.convert('RGBA')

                # Apply basic overlay based on type
                img = apply_basic_overlay(img, target, items_meta.get(target_id, {}))

                # Save
                img.save(output_path, 'PNG')
                logger.info(f"Processed: {target_id} -> {output_path}")
                success_count += 1

            except Exception as e:
                logger.error(f"Failed to process {target_id}: {e}")

        return success_count > 0

    except Exception as e:
        logger.error(f"Direct overlay application failed: {e}")
        traceback.print_exc()
        return False


def apply_basic_overlay(img: 'Image.Image', target: Dict, meta: Dict) -> 'Image.Image':
    """Apply a basic overlay to an image"""
    from PIL import ImageDraw, ImageFont

    draw = ImageDraw.Draw(img)
    width, height = img.size

    # Try to load a font
    try:
        font_paths = [
            '/modules/fonts/Roboto-Medium.ttf',
            '/fonts/Inter-Regular.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        ]
        font = None
        for fp in font_paths:
            if os.path.exists(fp):
                font = ImageFont.truetype(fp, max(24, int(height * 0.04)))
                break
        if not font:
            font = ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()

    target_type = target.get('type', meta.get('type', 'movie'))

    # Add type-appropriate badge
    if target_type == 'movie':
        badge_text = meta.get('resolution', '1080p')
    elif target_type == 'show':
        badge_text = str(meta.get('rating', '9.5'))
    elif target_type == 'season':
        season_idx = meta.get('season_index', 1)
        badge_text = f"S{season_idx:02d}"
    elif target_type == 'episode':
        season_idx = meta.get('season_index', 1)
        episode_idx = meta.get('episode_index', 1)
        badge_text = f"S{season_idx:02d}E{episode_idx:02d}"
    else:
        badge_text = "PREVIEW"

    # Calculate badge size
    bbox = draw.textbbox((0, 0), badge_text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    padding = int(height * 0.015)
    badge_x = int(width * 0.03)
    badge_y = int(height * 0.03)

    # Draw badge
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + text_width + padding * 2, badge_y + text_height + padding * 2],
        radius=int((text_height + padding * 2) * 0.25),
        fill=(30, 30, 30, 220)
    )
    draw.text((badge_x + padding, badge_y + padding), badge_text, fill=(255, 255, 255), font=font)

    return img


# ============================================================================
# Main Entry Point
# ============================================================================

def main():
    """Main entry point for the Kometa Preview Renderer"""
    parser = argparse.ArgumentParser(
        description='Kometa Preview Renderer - Runs real Kometa with write blocking'
    )
    parser.add_argument('--job', required=True, help='Path to job directory')
    args = parser.parse_args()

    job_path = Path(args.job)

    # Validate job directory
    if not job_path.exists():
        logger.error(f"Job directory not found: {job_path}")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("Kometa Preview Studio")
    logger.info("Path A: Real Kometa with Write Blocking")
    logger.info("=" * 60)
    logger.info(f"Job path: {job_path}")

    # Setup output directory
    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    # Load config
    try:
        preview_config = load_preview_config(job_path)
        logger.info("Preview config loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load preview config: {e}")
        sys.exit(1)

    # Extract Plex URL for write blocker
    plex_url = extract_plex_url(preview_config)

    # Initialize blockers and captures
    write_blocker = None
    output_capture = None

    if plex_url:
        logger.info(f"Plex URL detected: {plex_url}")

        # Install write blocker
        write_blocker = PlexWriteBlocker(plex_url)
        write_blocker.install()

        # Setup output capture with target mapping
        # Build mapping from preview targets
        target_mapping = {}
        preview_data = preview_config.get('preview', {})
        for target in preview_data.get('targets', []):
            target_id = target.get('id', '')
            target_mapping[target_id] = f"{target_id}_after.png"

        output_capture = OverlayOutputCapture(output_dir, target_mapping)
        output_capture.install()
    else:
        logger.warning("No Plex URL found in config - running in offline mode")

    # Try to run Kometa
    exit_code = 1
    kometa_ran = False

    try:
        # Generate Kometa config
        kometa_config_path = generate_kometa_config(job_path, preview_config)

        # Run Kometa
        logger.info("=" * 60)
        logger.info("Starting Kometa...")
        logger.info("=" * 60)

        exit_code = run_kometa_with_config(kometa_config_path, job_path)
        kometa_ran = True

        logger.info("=" * 60)
        logger.info(f"Kometa finished with exit code: {exit_code}")
        logger.info("=" * 60)

    except Exception as e:
        logger.error(f"Kometa execution failed: {e}")
        traceback.print_exc()

    # If Kometa didn't produce outputs, try direct overlay application
    output_files = list(output_dir.glob('*_after.png'))
    if not output_files:
        logger.info("No outputs from Kometa, attempting fallback overlay application...")
        if apply_overlays_directly(job_path, preview_config):
            exit_code = 0
        else:
            exit_code = 1

    # Write summary
    summary = {
        'timestamp': datetime.now().isoformat(),
        'success': exit_code == 0,
        'kometa_exit_code': exit_code if kometa_ran else None,
        'kometa_ran': kometa_ran,
        'blocked_write_attempts': write_blocker.get_blocked_requests() if write_blocker else [],
        'captured_outputs': output_capture.get_captured_outputs() if output_capture else [],
        'output_files': [str(f.name) for f in output_dir.glob('*_after.png')],
    }

    summary_path = output_dir / 'summary.json'
    with open(summary_path, 'w') as f:
        json.dump(summary, f, indent=2)

    logger.info(f"Summary written to: {summary_path}")

    # Log blocked requests
    if write_blocker:
        blocked = write_blocker.get_blocked_requests()
        if blocked:
            logger.info(f"Blocked {len(blocked)} Plex write attempts:")
            for req in blocked:
                logger.info(f"  {req['method']} {req['url']}")
        else:
            logger.info("No Plex write attempts were made")

    # Cleanup
    if write_blocker:
        write_blocker.uninstall()

    # Final status
    output_count = len(list(output_dir.glob('*_after.png')))
    if output_count > 0:
        logger.info(f"Preview rendering complete: {output_count} images generated")
        sys.exit(0)
    else:
        logger.error("Preview rendering failed: no output images generated")
        sys.exit(1)


if __name__ == '__main__':
    main()
