"""
Kometa execution for Kometa Preview Studio.

This module provides functions for finding and running Kometa with
the appropriate configuration for preview rendering.
"""

import os
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Optional

from constants import (
    logger,
    PREVIEW_ACCURACY,
    PREVIEW_EXTERNAL_ID_LIMIT,
    PREVIEW_EXTERNAL_PAGES_LIMIT,
)


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
