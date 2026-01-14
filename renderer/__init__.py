"""
Kometa Preview Studio - Renderer Package

This package provides preview rendering functionality for Kometa overlays,
including:
- Plex proxy for write-blocking and upload capture
- TMDb proxy for fast mode result capping
- Font handling and fallbacks
- Configuration management
- Output caching and export
"""

from .constants import (
    logger,
    PROXY_PORT,
    PROXY_HOST,
    PREVIEW_ACCURACY,
    PREVIEW_EXTERNAL_ID_LIMIT,
    PREVIEW_EXTERNAL_PAGES_LIMIT,
    TMDB_PROXY_ENABLED,
    TMDB_PROXY_PORT,
    FAST_MODE,
    OUTPUT_CACHE_ENABLED,
)

from .fonts import (
    validate_fonts_at_startup,
    ensure_font_fallbacks,
)

from .caching import (
    compute_config_hash,
    check_cached_outputs,
    save_cache_hash,
    use_cached_outputs,
    safe_preview_targets,
)

from .xml_builders import (
    extract_allowed_rating_keys,
    extract_preview_targets,
)

from .proxy_plex import PlexProxy
from .proxy_tmdb import TMDbProxy

from .config import (
    load_preview_config,
    apply_fast_mode_sanitization,
    apply_font_fallbacks_to_overlays,
    fetch_proxy_sections,
    validate_library_sections,
    generate_proxy_config,
    redact_yaml_snippet,
)

from .kometa_runner import run_kometa

from .export import (
    export_overlay_outputs,
    export_local_preview_artifacts,
)

__all__ = [
    # Constants
    'logger',
    'PROXY_PORT',
    'PROXY_HOST',
    'PREVIEW_ACCURACY',
    'PREVIEW_EXTERNAL_ID_LIMIT',
    'PREVIEW_EXTERNAL_PAGES_LIMIT',
    'TMDB_PROXY_ENABLED',
    'TMDB_PROXY_PORT',
    'FAST_MODE',
    'OUTPUT_CACHE_ENABLED',
    # Fonts
    'validate_fonts_at_startup',
    'ensure_font_fallbacks',
    # Caching
    'compute_config_hash',
    'check_cached_outputs',
    'save_cache_hash',
    'use_cached_outputs',
    'safe_preview_targets',
    # XML
    'extract_allowed_rating_keys',
    'extract_preview_targets',
    # Proxies
    'PlexProxy',
    'TMDbProxy',
    # Config
    'load_preview_config',
    'apply_fast_mode_sanitization',
    'apply_font_fallbacks_to_overlays',
    'fetch_proxy_sections',
    'validate_library_sections',
    'generate_proxy_config',
    'redact_yaml_snippet',
    # Runner
    'run_kometa',
    # Export
    'export_overlay_outputs',
    'export_local_preview_artifacts',
]
