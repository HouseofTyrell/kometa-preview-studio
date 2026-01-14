"""
Data sanitization for Kometa Preview Studio.

This module provides functions for sanitizing overlay data in FAST mode,
including removing Letterboxd builders and stripping IMDb award filters.
"""

from typing import Any, Dict, Tuple

from constants import logger


def _contains_letterboxd(data: Any) -> bool:
    """Check if data contains Letterboxd references."""
    if isinstance(data, dict):
        for key, value in data.items():
            if 'letterboxd' in str(key).lower():
                return True
            if _contains_letterboxd(value):
                return True
    elif isinstance(data, list):
        return any(_contains_letterboxd(item) for item in data)
    elif isinstance(data, str):
        return 'letterboxd' in data.lower()
    return False


def _strip_imdb_awards_category_filter(data: Any) -> int:
    """Strip category_filter from imdb_awards entries."""
    stripped = 0
    if isinstance(data, dict):
        for key, value in list(data.items()):
            if str(key).lower() == 'imdb_awards' and isinstance(value, dict):
                for filter_key in ('category_filter', 'category_filters'):
                    if filter_key in value:
                        value.pop(filter_key, None)
                        stripped += 1
            else:
                stripped += _strip_imdb_awards_category_filter(value)
    elif isinstance(data, list):
        for item in data:
            stripped += _strip_imdb_awards_category_filter(item)
    return stripped


def sanitize_overlay_data_for_fast_mode(data: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """
    Remove Letterboxd builders and skip IMDb awards category_filter validation in FAST mode.

    Args:
        data: Overlay configuration data

    Returns:
        Tuple of (sanitized_data, stats_dict)
    """
    removed_letterboxd = 0
    stripped_imdb = 0

    if not isinstance(data, dict):
        return data, {'letterboxd_removed': 0, 'imdb_category_filters_stripped': 0}

    for section_key in ('overlays', 'collections', 'metadata', 'templates'):
        section = data.get(section_key)
        if isinstance(section, dict):
            for item_key in list(section.keys()):
                item_value = section[item_key]
                if _contains_letterboxd(item_value):
                    section.pop(item_key, None)
                    removed_letterboxd += 1
                else:
                    stripped_imdb += _strip_imdb_awards_category_filter(item_value)

    return data, {
        'letterboxd_removed': removed_letterboxd,
        'imdb_category_filters_stripped': stripped_imdb,
    }
