"""
Overlay positioning parser for Kometa Preview Studio.

Parses overlay positioning from Kometa config files and provides
positioning calculation functions.
"""

from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def parse_overlay_positions(preview_config: Dict[str, Any], library_name: str) -> Dict[str, Dict[str, Any]]:
    """
    Parse overlay positioning from Kometa config for a specific library.

    Returns a dict mapping overlay names (with optional builder_level suffix) to their positioning config:
    {
        'resolution': {...},           # Default (show level)
        'resolution:season': {...},    # Season-specific
        'resolution:episode': {...},   # Episode-specific
        'ratings': {...},              # Default
        'ratings:episode': {...},      # Episode-specific
    }

    The key format is 'overlay_name' or 'overlay_name:builder_level' for level-specific configs.
    """
    positions = {}

    libraries = preview_config.get('libraries', {})
    if not isinstance(libraries, dict):
        return positions

    lib_config = libraries.get(library_name)
    if not isinstance(lib_config, dict):
        return positions

    overlay_files = lib_config.get('overlay_files', [])
    if not isinstance(overlay_files, list):
        return positions

    for entry in overlay_files:
        if not isinstance(entry, dict):
            continue

        # Get overlay name from 'default' key
        overlay_name = entry.get('default')
        if not overlay_name:
            continue

        # Get template_variables with positioning
        template_vars = entry.get('template_variables', {})
        if not isinstance(template_vars, dict):
            continue

        # Extract positioning parameters
        position_config = {}

        # Standard positioning
        if 'horizontal_align' in template_vars:
            position_config['horizontal_align'] = template_vars['horizontal_align']
        if 'vertical_align' in template_vars:
            position_config['vertical_align'] = template_vars['vertical_align']
        if 'horizontal_offset' in template_vars:
            position_config['horizontal_offset'] = int(template_vars['horizontal_offset'])
        if 'vertical_offset' in template_vars:
            position_config['vertical_offset'] = int(template_vars['vertical_offset'])

        # Special case: ratings uses 'horizontal_position' instead of 'horizontal_align'
        if 'horizontal_position' in template_vars:
            position_config['horizontal_position'] = template_vars['horizontal_position']

        # Builder level (for show/season/episode specific overlays)
        builder_level = template_vars.get('builder_level')

        if position_config:
            # Create key with builder_level suffix if present
            if builder_level:
                key = f"{overlay_name}:{builder_level}"
            else:
                key = overlay_name
            positions[key] = position_config

    return positions


def get_position_for_target(
    overlay_name: str,
    target_type: str,
    overlay_positions: Dict[str, Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """
    Get the appropriate position config for an overlay based on target type.

    Looks up positions in this order:
    1. overlay_name:builder_level (e.g., 'resolution:episode')
    2. overlay_name (default, e.g., 'resolution')

    Then merges with Kometa defaults for the overlay type to fill in missing values.

    Args:
        overlay_name: Name of overlay (e.g., 'resolution', 'ratings')
        target_type: Type of target ('movie', 'show', 'season', 'episode')
        overlay_positions: Dict of position configs from parse_overlay_positions()

    Returns:
        Position config dict merged with defaults, or None if not found
    """
    # Map target types to builder levels
    # Movies and shows don't have builder_level
    # Seasons and episodes have specific builder_level keys
    builder_level = None
    if target_type == 'season':
        builder_level = 'season'
    elif target_type == 'episode':
        builder_level = 'episode'

    # Try level-specific first if applicable
    position_config = None
    if builder_level:
        level_key = f"{overlay_name}:{builder_level}"
        if level_key in overlay_positions:
            position_config = overlay_positions[level_key]

    # Fall back to default (no builder_level)
    if not position_config and overlay_name in overlay_positions:
        position_config = overlay_positions[overlay_name]

    if not position_config:
        return None

    # Merge with Kometa defaults for this overlay type
    # This ensures that if user only specifies horizontal_position,
    # we still get the correct vertical_align default (e.g., bottom for ratings)
    defaults = get_default_position_config(overlay_name)
    merged = defaults.copy()
    merged.update(position_config)

    return merged


def calculate_position(
    overlay_width: int,
    overlay_height: int,
    poster_width: int,
    poster_height: int,
    position_config: Dict[str, Any]
) -> Tuple[int, int]:
    """
    Calculate the (x, y) position for an overlay based on Kometa positioning config.

    Kometa positioning uses:
    - horizontal_align: left, center, right
    - vertical_align: top, center, bottom
    - horizontal_offset: pixels from align point
    - vertical_offset: pixels from align point

    Returns: (x, y) tuple for top-left corner of overlay
    """
    # Get positioning parameters with defaults
    h_align = position_config.get('horizontal_align', 'left')
    v_align = position_config.get('vertical_align', 'top')
    h_offset = position_config.get('horizontal_offset', 0)
    v_offset = position_config.get('vertical_offset', 0)

    # Special case: horizontal_position (used by ratings)
    if 'horizontal_position' in position_config:
        h_pos = position_config['horizontal_position']
        if h_pos == 'right':
            h_align = 'right'
        elif h_pos == 'left':
            h_align = 'left'
        elif h_pos == 'center':
            h_align = 'center'

    # Calculate X position
    if h_align == 'left':
        x = h_offset
    elif h_align == 'center':
        x = (poster_width - overlay_width) // 2 + h_offset
    elif h_align == 'right':
        x = poster_width - overlay_width - h_offset
    else:
        x = h_offset  # Default to left

    # Calculate Y position
    if v_align == 'top':
        y = v_offset
    elif v_align == 'center':
        y = (poster_height - overlay_height) // 2 + v_offset
    elif v_align == 'bottom':
        y = poster_height - overlay_height - v_offset
    else:
        y = v_offset  # Default to top

    # Ensure position is within poster bounds
    x = max(0, min(x, poster_width - overlay_width))
    y = max(0, min(y, poster_height - overlay_height))

    return (x, y)


def get_default_position_config(overlay_type: str) -> Dict[str, Any]:
    """
    Get default Kometa positioning for an overlay type.

    Based on Kometa's standard overlay defaults.
    """
    defaults = {
        'resolution': {
            'horizontal_align': 'left',
            'vertical_align': 'top',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'audio_codec': {
            'horizontal_align': 'left',
            'vertical_align': 'top',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'ratings': {
            'horizontal_align': 'left',
            'vertical_align': 'center',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'streaming': {
            'horizontal_align': 'right',
            'vertical_align': 'top',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'network': {
            'horizontal_align': 'right',
            'vertical_align': 'top',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'studio': {
            'horizontal_align': 'right',
            'vertical_align': 'top',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'ribbon': {
            'horizontal_align': 'right',
            'vertical_align': 'bottom',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
        'status': {
            'horizontal_align': 'center',
            'vertical_align': 'top',
            'horizontal_offset': 0,
            'vertical_offset': 0,
        },
    }

    return defaults.get(overlay_type, {
        'horizontal_align': 'left',
        'vertical_align': 'top',
        'horizontal_offset': 0,
        'vertical_offset': 0,
    })
