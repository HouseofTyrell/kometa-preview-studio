"""
Configuration management for Kometa Preview Studio.

This module provides functions for loading, parsing, and generating
configuration files for preview rendering.
"""

import http.client
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from constants import logger
from fonts import ensure_font_fallbacks
from sanitization import sanitize_overlay_data_for_fast_mode


def load_preview_config(job_path: Path) -> Dict[str, Any]:
    """Load the preview configuration from the job directory"""
    config_path = job_path / 'config' / 'preview.yml'

    if not config_path.exists():
        raise FileNotFoundError(f"Preview config not found: {config_path}")

    return load_yaml_file(config_path)


def _resolve_overlay_path(job_path: Path, raw_path: str) -> Path:
    """Resolve an overlay path relative to the job config directory."""
    raw = Path(raw_path)
    if raw.is_absolute():
        return raw
    return job_path / 'config' / raw


def _collect_overlay_files(preview_config: Dict[str, Any], job_path: Path) -> List[Path]:
    """Collect all overlay file paths from the preview configuration."""
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
    """Write data to a YAML file."""
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    yaml_parser.default_flow_style = False
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w') as f:
        yaml_parser.dump(data, f)


def _read_yaml(path: Path) -> Dict[str, Any]:
    """Read a YAML file and return its contents."""
    from ruamel.yaml import YAML
    yaml_parser = YAML()
    with path.open('r') as f:
        return dict(yaml_parser.load(f) or {})


def sanitize_yaml_text(text: str) -> str:
    """Sanitize YAML text by removing extraneous document end markers."""
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
    """Redact sensitive information from YAML snippet lines."""
    redacted = []
    for line in lines:
        scrubbed = re.sub(r'(\btoken:\s*)(\S+)', r'\1[REDACTED]', line)
        scrubbed = re.sub(r'(\bapikey:\s*)(\S+)', r'\1[REDACTED]', scrubbed)
        scrubbed = re.sub(r'(\bclient_id:\s*)(\S+)', r'\1[REDACTED]', scrubbed)
        scrubbed = re.sub(r'(\bclient_secret:\s*)(\S+)', r'\1[REDACTED]', scrubbed)
        redacted.append(scrubbed)
    return redacted


def load_yaml_file(path: Path) -> Dict[str, Any]:
    """Load a YAML file using available YAML library."""
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
