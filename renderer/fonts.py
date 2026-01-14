"""
Font handling for Kometa Preview Studio.

This module provides font validation, fallback resolution, and font path
management for overlay rendering.
"""

import shutil
from pathlib import Path
from typing import Any, List, Optional

from constants import (
    logger,
    PREVIEW_STRICT_FONTS,
    DEFAULT_FALLBACK_FONT,
    COMMON_FONT_PATHS,
    FALLBACK_FONT_CANDIDATES,
)


def validate_fonts_at_startup() -> List[str]:
    """
    Validate font availability at startup.

    P1 Fix: Check common font directories and log warnings for missing fonts.
    Returns a list of available font directories.
    """
    available_dirs = []
    missing_dirs = []

    for font_path in COMMON_FONT_PATHS:
        if Path(font_path).exists():
            available_dirs.append(font_path)
            # List available fonts
            fonts = list(Path(font_path).glob('*.ttf')) + list(Path(font_path).glob('*.otf'))
            if fonts:
                logger.info(f"FONT_DIR_FOUND: {font_path} ({len(fonts)} fonts)")
                for font in fonts[:5]:  # Log first 5
                    logger.debug(f"  - {font.name}")
                if len(fonts) > 5:
                    logger.debug(f"  - ... and {len(fonts) - 5} more")
            else:
                logger.warning(f"FONT_DIR_EMPTY: {font_path} exists but contains no fonts")
        else:
            missing_dirs.append(font_path)

    if not available_dirs:
        logger.warning("FONT_WARNING: No font directories found!")
        logger.warning(f"  Checked: {', '.join(COMMON_FONT_PATHS)}")
        logger.warning("  Overlay rendering may fail if custom fonts are referenced.")
        logger.warning("  To fix: Mount font files to /config/fonts or set PREVIEW_FALLBACK_FONT")

    fallback_font = get_fallback_font_path()
    if Path(fallback_font).exists():
        logger.info(f"FALLBACK_FONT_OK: {fallback_font}")
    else:
        logger.warning(f"FALLBACK_FONT_MISSING: {fallback_font}")
        if PREVIEW_STRICT_FONTS:
            raise FileNotFoundError(
                f"Fallback font not found: {fallback_font}. "
                f"Set PREVIEW_STRICT_FONTS=0 to continue without fallback font."
            )

    return available_dirs


def normalize_font_path(requested_path: str) -> Path:
    """Normalize a font path to an absolute path."""
    requested = Path(requested_path)
    if requested.is_absolute():
        return requested
    return Path('/') / requested


def get_fallback_font_path() -> str:
    """Get the path to the fallback font."""
    for candidate in FALLBACK_FONT_CANDIDATES:
        if candidate and Path(candidate).exists():
            return candidate
    return DEFAULT_FALLBACK_FONT


def resolve_font_fallback(requested_path: str) -> Optional[str]:
    """
    Ensure a requested font path exists, falling back to DEFAULT_FALLBACK_FONT if missing.

    Returns the resolved font path if available, or None if missing and strict mode is disabled.
    """
    requested = normalize_font_path(requested_path)
    if requested.exists():
        return str(requested)

    fallback_source: Optional[Path] = None
    for root in ('/fonts', '/config/fonts'):
        candidate = Path(root) / requested.name
        if candidate.exists():
            fallback_source = candidate
            break

    if fallback_source is None:
        fallback_source = Path(get_fallback_font_path())

    if not fallback_source.exists():
        message = f"Fallback font missing: {fallback_source}"
        if PREVIEW_STRICT_FONTS:
            raise FileNotFoundError(message)
        logger.warning(f"FONT_FALLBACK_SKIPPED requested={requested_path} reason=fallback_missing")
        return None

    requested.parent.mkdir(parents=True, exist_ok=True)
    try:
        if requested.exists():
            return str(requested)
        shutil.copy2(fallback_source, requested)
        logger.info(f"FONT_FALLBACK requested={requested_path} fallback={fallback_source}")
        return str(requested)
    except Exception as e:
        if PREVIEW_STRICT_FONTS:
            raise
        logger.warning(f"FONT_FALLBACK_FAILED requested={requested_path} error={e}")
        return None


def collect_font_paths(data: Any) -> List[str]:
    """Collect font paths from nested config data."""
    font_paths: List[str] = []

    def _walk(value: Any):
        if isinstance(value, dict):
            for v in value.values():
                _walk(v)
        elif isinstance(value, list):
            for v in value:
                _walk(v)
        elif isinstance(value, str):
            lower = value.lower()
            if lower.endswith(('.ttf', '.otf', '.ttc')):
                font_paths.append(value)

    _walk(data)
    return font_paths


def ensure_font_fallbacks(data: Any) -> int:
    """Ensure all referenced fonts exist by applying fallbacks when missing."""
    fallback_count = 0
    for font_path in set(collect_font_paths(data)):
        resolved = resolve_font_fallback(font_path)
        if resolved and resolved != font_path:
            fallback_count += 1
    return fallback_count
