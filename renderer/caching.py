"""
Output caching for Kometa Preview Studio.

This module provides functions for caching preview outputs to enable
instant returns when configuration hasn't changed.
"""

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from constants import logger


def safe_preview_targets(preview_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return preview targets list safely without raising."""
    if not isinstance(preview_config, dict):
        return []
    preview_data = preview_config.get('preview', {})
    if not isinstance(preview_data, dict):
        return []
    targets = preview_data.get('targets', [])
    return targets if isinstance(targets, list) else []


def compute_config_hash(preview_config: Dict[str, Any]) -> str:
    """
    Compute a hash of the configuration that affects overlay output.

    This includes:
    - Preview targets (id, type, metadata)
    - Overlay file references
    - Library configurations

    Does NOT include:
    - Plex URL/token (doesn't affect output)
    - TMDb credentials (doesn't affect output)

    Returns:
        A hex hash string that uniquely identifies this configuration.
    """
    hash_input = {}

    # Include preview targets
    targets = safe_preview_targets(preview_config)

    # Sort targets by id for consistent hashing
    sorted_targets = sorted(targets, key=lambda t: t.get('id', ''))
    hash_input['targets'] = [
        {
            'id': t.get('id'),
            'type': t.get('type'),
            'ratingKey': t.get('ratingKey'),
            'metadata': t.get('metadata'),
        }
        for t in sorted_targets
    ]

    # Include library overlay configurations
    if 'libraries' in preview_config:
        hash_input['libraries'] = {}
        for lib_name, lib_config in preview_config['libraries'].items():
            if isinstance(lib_config, dict):
                hash_input['libraries'][lib_name] = {
                    'overlay_files': lib_config.get('overlay_files'),
                }

    # Serialize and hash
    hash_str = json.dumps(hash_input, sort_keys=True, default=str)
    return hashlib.sha256(hash_str.encode()).hexdigest()[:16]


def check_cached_outputs(job_path: Path, config_hash: str) -> bool:
    """
    Check if cached outputs exist and are valid for this config hash.

    Returns True if:
    1. Cache hash file exists and matches current config
    2. All expected output files exist
    """
    output_dir = job_path / 'output'
    cache_hash_path = output_dir / '.cache_hash'

    # Check if hash file exists
    if not cache_hash_path.exists():
        return False

    # Check if hash matches
    try:
        stored_hash = cache_hash_path.read_text().strip()
        if stored_hash != config_hash:
            logger.info(f"Config changed (hash {stored_hash[:8]}... -> {config_hash[:8]}...)")
            return False
    except Exception as e:
        logger.warning(f"Failed to read cache hash: {e}")
        return False

    # Check if output files exist
    output_files = list(output_dir.glob('*_after.*'))
    if not output_files:
        logger.info("No cached output files found")
        return False

    logger.info(f"Found {len(output_files)} cached output files")
    return True


def save_cache_hash(job_path: Path, config_hash: str):
    """Save the config hash after successful rendering."""
    output_dir = job_path / 'output'
    cache_hash_path = output_dir / '.cache_hash'

    try:
        cache_hash_path.write_text(config_hash)
        logger.info(f"Saved cache hash: {config_hash[:8]}...")
    except Exception as e:
        logger.warning(f"Failed to save cache hash: {e}")


def use_cached_outputs(job_path: Path) -> Tuple[bool, Dict[str, str]]:
    """
    Use cached outputs without re-rendering.

    Returns:
        (success, exported_files dict)
    """
    output_dir = job_path / 'output'
    exported = {}

    # Find all output files
    for output_file in output_dir.glob('*_after.*'):
        # Extract target_id from filename (e.g., "matrix_after.png" -> "matrix")
        target_id = output_file.stem.replace('_after', '')
        exported[target_id] = str(output_file)

    return len(exported) > 0, exported


def get_cached_outputs_for_targets(
    job_path: Path,
    target_ids: List[str]
) -> Dict[str, str]:
    """
    Get cached output files for specific targets.

    Returns:
        Dict mapping target_id -> output file path (only for targets that have cached outputs)
    """
    output_dir = job_path / 'output'
    cached = {}

    for target_id in target_ids:
        # Look for output file matching this target
        matches = list(output_dir.glob(f'{target_id}_after.*'))
        if matches:
            # Use the most recent if multiple exist
            cached[target_id] = str(max(matches, key=lambda p: p.stat().st_mtime))

    return cached


def merge_cached_and_new_outputs(
    job_path: Path,
    cached_targets: List[str],
    new_exported: Dict[str, str]
) -> Dict[str, str]:
    """
    Merge cached outputs with newly rendered outputs.

    Args:
        job_path: Path to job directory
        cached_targets: List of target IDs that should use cached outputs
        new_exported: Dict of newly rendered target_id -> output_path

    Returns:
        Combined dict of all target outputs
    """
    merged = dict(new_exported)  # Start with new outputs

    # Add cached outputs for targets that weren't re-rendered
    cached_outputs = get_cached_outputs_for_targets(job_path, cached_targets)
    for target_id, output_path in cached_outputs.items():
        if target_id not in merged:
            merged[target_id] = output_path
            logger.info(f"Using cached output for {target_id}: {Path(output_path).name}")

    return merged
