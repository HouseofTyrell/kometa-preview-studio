"""
Per-Overlay Fingerprinting for Kometa Preview Studio.

This module provides granular caching by computing fingerprints for individual
overlay configurations. Instead of invalidating the entire cache when any
config changes, we can now determine exactly which targets need re-rendering.

Key Concepts:
- Overlay Fingerprint: SHA256 hash of an overlay file's content
- Target Affinity: Which overlay files affect which target types (movie vs TV)
- Granular Cache: Per-target cache entries that include overlay fingerprints

Since the 5 preview targets are fixed (matrix, dune, breakingbad_series/s01/s01e01),
we can cache results per-target and only re-render when relevant overlays change.
"""

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from constants import logger


# Target type mappings
MOVIE_TARGETS = {'matrix', 'dune'}
TV_SHOW_TARGETS = {'breakingbad_series'}
TV_SEASON_TARGETS = {'breakingbad_s01'}
TV_EPISODE_TARGETS = {'breakingbad_s01e01'}
ALL_TV_TARGETS = TV_SHOW_TARGETS | TV_SEASON_TARGETS | TV_EPISODE_TARGETS


def compute_overlay_fingerprint(overlay_path: Path) -> Optional[str]:
    """
    Compute a SHA256 fingerprint for an overlay file.

    Returns None if the file doesn't exist or can't be read.
    """
    if not overlay_path.exists():
        return None

    try:
        content = overlay_path.read_bytes()
        return hashlib.sha256(content).hexdigest()[:16]
    except Exception as e:
        logger.warning(f"Failed to fingerprint overlay {overlay_path}: {e}")
        return None


def determine_overlay_target_affinity(
    overlay_path: Path,
    library_type: Optional[str] = None
) -> Set[str]:
    """
    Determine which target types an overlay affects based on:
    1. The library type it's associated with (movie vs show)
    2. The overlay content (plex_search filters, etc.)

    Returns a set of target IDs that this overlay affects.
    """
    affected_targets: Set[str] = set()

    # If we know the library type, use it
    if library_type in ('movie', 'movies'):
        affected_targets.update(MOVIE_TARGETS)
    elif library_type in ('show', 'shows', 'series', 'tv'):
        affected_targets.update(ALL_TV_TARGETS)
    else:
        # Unknown library type - assume it affects all targets
        affected_targets.update(MOVIE_TARGETS)
        affected_targets.update(ALL_TV_TARGETS)

    # Try to refine based on overlay content
    if overlay_path.exists():
        try:
            content = overlay_path.read_text()
            content_lower = content.lower()

            # Check for type-specific filters in overlay content
            has_movie_filters = (
                'type: movie' in content_lower or
                'library_type: movie' in content_lower
            )
            has_show_filters = (
                'type: show' in content_lower or
                'type: season' in content_lower or
                'type: episode' in content_lower or
                'library_type: show' in content_lower
            )

            # If we found type-specific filters, narrow down affected targets
            if has_movie_filters and not has_show_filters:
                affected_targets = MOVIE_TARGETS.copy()
            elif has_show_filters and not has_movie_filters:
                affected_targets = ALL_TV_TARGETS.copy()

        except Exception as e:
            logger.debug(f"Could not analyze overlay content {overlay_path}: {e}")

    return affected_targets


def collect_overlay_fingerprints(
    preview_config: Dict[str, Any],
    job_path: Path
) -> Dict[str, Dict[str, Any]]:
    """
    Collect fingerprints for all overlay files in the configuration.

    Returns a dict mapping overlay file paths to their metadata:
    {
        "overlays/resolution.yml": {
            "fingerprint": "abc123...",
            "affects_targets": ["matrix", "dune"],
            "library": "Movies"
        }
    }
    """
    fingerprints: Dict[str, Dict[str, Any]] = {}

    libraries = preview_config.get('libraries', {})
    if not isinstance(libraries, dict):
        return fingerprints

    for lib_name, lib_config in libraries.items():
        if not isinstance(lib_config, dict):
            continue

        # Determine library type from targets or config
        lib_type = _infer_library_type(lib_name, preview_config)

        overlay_entries = lib_config.get('overlay_files', [])
        if not isinstance(overlay_entries, list):
            continue

        for entry in overlay_entries:
            if isinstance(entry, str):
                overlay_rel_path = entry
            elif isinstance(entry, dict) and 'file' in entry:
                overlay_rel_path = str(entry['file'])
            else:
                continue

            # Resolve path
            overlay_path = _resolve_overlay_path(job_path, overlay_rel_path)
            fingerprint = compute_overlay_fingerprint(overlay_path)

            if fingerprint:
                affected_targets = determine_overlay_target_affinity(overlay_path, lib_type)
                fingerprints[overlay_rel_path] = {
                    'fingerprint': fingerprint,
                    'affects_targets': sorted(affected_targets),
                    'library': lib_name,
                    'resolved_path': str(overlay_path),
                }

    return fingerprints


def _resolve_overlay_path(job_path: Path, raw_path: str) -> Path:
    """Resolve an overlay path relative to the job config directory."""
    raw = Path(raw_path)
    if raw.is_absolute():
        return raw
    return job_path / 'config' / raw


def _infer_library_type(
    lib_name: str,
    preview_config: Dict[str, Any]
) -> Optional[str]:
    """Infer library type from library name or preview targets."""
    lib_name_lower = lib_name.lower()

    # Common naming conventions
    if 'movie' in lib_name_lower:
        return 'movie'
    elif 'tv' in lib_name_lower or 'show' in lib_name_lower or 'series' in lib_name_lower:
        return 'show'

    # Check preview targets for hints
    preview = preview_config.get('preview', {})
    targets = preview.get('targets', [])

    movie_count = sum(1 for t in targets if t.get('type') == 'movie')
    tv_count = sum(1 for t in targets if t.get('type') in ('show', 'season', 'episode'))

    if movie_count > 0 and tv_count == 0:
        return 'movie'
    elif tv_count > 0 and movie_count == 0:
        return 'show'

    return None


def compute_target_fingerprints(
    overlay_fingerprints: Dict[str, Dict[str, Any]],
    preview_config: Dict[str, Any]
) -> Dict[str, str]:
    """
    Compute a combined fingerprint for each target based on overlays that affect it.

    This allows us to detect when a specific target needs re-rendering.

    Returns:
        Dict mapping target_id -> combined_fingerprint
    """
    target_fingerprints: Dict[str, str] = {}

    # Get all target IDs from preview config
    preview = preview_config.get('preview', {})
    targets = preview.get('targets', [])

    for target in targets:
        target_id = target.get('id')
        if not target_id:
            continue

        # Collect fingerprints of overlays affecting this target
        relevant_fingerprints: List[str] = []

        for overlay_path, overlay_meta in sorted(overlay_fingerprints.items()):
            if target_id in overlay_meta.get('affects_targets', []):
                relevant_fingerprints.append(
                    f"{overlay_path}:{overlay_meta['fingerprint']}"
                )

        # Also include target metadata in the fingerprint
        # (in case metadata changes affect overlay rendering)
        target_meta = target.get('metadata', {})
        target_meta_str = json.dumps(target_meta, sort_keys=True)
        relevant_fingerprints.append(f"metadata:{target_meta_str}")

        # Combine into single fingerprint
        combined = '|'.join(relevant_fingerprints)
        target_fingerprints[target_id] = hashlib.sha256(
            combined.encode()
        ).hexdigest()[:16]

    return target_fingerprints


def load_cached_target_fingerprints(job_path: Path) -> Dict[str, str]:
    """
    Load previously cached target fingerprints.

    Returns empty dict if no cache exists.
    """
    cache_path = job_path / 'output' / '.target_fingerprints.json'

    if not cache_path.exists():
        return {}

    try:
        return json.loads(cache_path.read_text())
    except Exception as e:
        logger.warning(f"Failed to load target fingerprints cache: {e}")
        return {}


def save_target_fingerprints(
    job_path: Path,
    target_fingerprints: Dict[str, str]
) -> None:
    """Save target fingerprints to cache."""
    cache_path = job_path / 'output' / '.target_fingerprints.json'
    cache_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        cache_path.write_text(json.dumps(target_fingerprints, indent=2))
        logger.info(f"Saved target fingerprints: {list(target_fingerprints.keys())}")
    except Exception as e:
        logger.warning(f"Failed to save target fingerprints: {e}")


def determine_targets_needing_render(
    job_path: Path,
    preview_config: Dict[str, Any]
) -> Tuple[List[str], List[str], Dict[str, str]]:
    """
    Determine which targets need rendering based on overlay fingerprints.

    Returns:
        (targets_to_render, cached_targets, new_fingerprints)

        - targets_to_render: List of target IDs that need fresh rendering
        - cached_targets: List of target IDs that can use cached outputs
        - new_fingerprints: Dict of current fingerprints for all targets
    """
    # Collect current overlay fingerprints
    overlay_fingerprints = collect_overlay_fingerprints(preview_config, job_path)

    if overlay_fingerprints:
        logger.info(f"Collected {len(overlay_fingerprints)} overlay fingerprints")
        for path, meta in overlay_fingerprints.items():
            logger.debug(
                f"  {path}: {meta['fingerprint'][:8]}... "
                f"affects {meta['affects_targets']}"
            )

    # Compute current target fingerprints
    new_fingerprints = compute_target_fingerprints(overlay_fingerprints, preview_config)

    # Load cached fingerprints
    cached_fingerprints = load_cached_target_fingerprints(job_path)

    # Determine what needs rendering
    targets_to_render: List[str] = []
    cached_targets: List[str] = []

    output_dir = job_path / 'output'

    for target_id, new_fp in new_fingerprints.items():
        cached_fp = cached_fingerprints.get(target_id)

        # Check if output file exists
        output_exists = any(output_dir.glob(f'{target_id}_after.*'))

        if cached_fp == new_fp and output_exists:
            logger.info(
                f"  {target_id}: CACHED (fingerprint {new_fp[:8]}... unchanged)"
            )
            cached_targets.append(target_id)
        else:
            reason = "new" if not cached_fp else "changed" if cached_fp != new_fp else "missing output"
            logger.info(
                f"  {target_id}: RENDER NEEDED ({reason}, "
                f"fingerprint {new_fp[:8]}...)"
            )
            targets_to_render.append(target_id)

    return targets_to_render, cached_targets, new_fingerprints


def filter_preview_config_for_targets(
    preview_config: Dict[str, Any],
    target_ids: List[str]
) -> Dict[str, Any]:
    """
    Create a filtered preview config that only includes specified targets.

    This allows rendering only the targets that need updating.
    """
    if not target_ids:
        return preview_config

    filtered = json.loads(json.dumps(preview_config))  # Deep copy

    preview = filtered.get('preview', {})
    targets = preview.get('targets', [])

    # Filter to only requested targets
    filtered_targets = [t for t in targets if t.get('id') in target_ids]
    preview['targets'] = filtered_targets
    filtered['preview'] = preview

    logger.info(
        f"Filtered config: {len(filtered_targets)} targets "
        f"(from {len(targets)} total)"
    )

    return filtered
