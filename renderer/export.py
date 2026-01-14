"""
Output export for Kometa Preview Studio.

This module provides functions for exporting preview outputs and artifacts
to the output directory.
"""

import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from constants import logger
from caching import safe_preview_targets


def build_rating_key_to_target_map(preview_config: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Build a mapping from ratingKey to target info.

    Returns: { ratingKey: { target_id, type, title, ... }, ... }
    """
    targets = safe_preview_targets(preview_config)

    mapping = {}
    for target in targets:
        rating_key = target.get('ratingKey') or target.get('rating_key') or target.get('plex_id')
        if rating_key:
            mapping[str(rating_key)] = target
        else:
            logger.warning(f"Target {target.get('id')} has no ratingKey - cannot map output")

    return mapping


def find_captured_upload_for_rating_key(
    captured_uploads: List[Dict[str, Any]],
    rating_key: str,
    prefer_kind: str = 'poster'
) -> Optional[Dict[str, Any]]:
    """
    Find the most appropriate captured upload for a given ratingKey.

    Prefers 'poster' kind, then most recent upload.
    """
    matches = [
        u for u in captured_uploads
        if u.get('rating_key') == rating_key and u.get('saved_path')
    ]

    if not matches:
        return None

    # Prefer the specified kind
    kind_matches = [u for u in matches if u.get('kind') == prefer_kind]
    if kind_matches:
        matches = kind_matches

    # Return most recent (by timestamp)
    matches.sort(key=lambda u: u.get('timestamp', ''), reverse=True)
    return matches[0]


def export_local_preview_artifacts(
    job_path: Path,
    preview_config: Dict[str, Any]
) -> Dict[str, str]:
    """
    Export locally-rendered preview artifacts (e.g., *_after.png) into previews dir.
    """
    output_dir = job_path / 'output'
    previews_dir = output_dir / 'previews'
    previews_dir.mkdir(parents=True, exist_ok=True)

    exported: Dict[str, str] = {}

    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])

    for target in targets:
        target_id = target.get('id', '')
        rating_key = target.get('ratingKey') or target.get('rating_key') or target.get('plex_id')

        if not target_id or not rating_key:
            continue

        rating_key = str(rating_key)
        candidate = None
        for ext in ('png', 'jpg', 'jpeg', 'webp'):
            path = output_dir / f"{target_id}_after.{ext}"
            if path.exists():
                candidate = path
                break

        if not candidate:
            draft_path = output_dir / 'draft' / f"{target_id}_draft.png"
            if draft_path.exists():
                candidate = draft_path

        if not candidate:
            continue

        ext = candidate.suffix.lstrip('.') or 'png'
        preview_path = previews_dir / f"{rating_key}__poster.{ext}"
        try:
            shutil.copy2(candidate, preview_path)
            exported[target_id] = str(preview_path)
            logger.info(
                f"LOCAL_ARTIFACT_CAPTURED target={target_id} ratingKey={rating_key} "
                f"path={preview_path}"
            )
        except Exception as e:
            logger.warning(f"LOCAL_ARTIFACT_COPY_FAILED target={target_id} error={e}")

    return exported


def export_overlay_outputs(
    job_path: Path,
    preview_config: Dict[str, Any],
    captured_uploads: List[Dict[str, Any]]
) -> Tuple[Dict[str, str], List[str]]:
    """
    Export captured uploads to the output directory, mapping by ratingKey.

    Returns: (exported_files dict, missing_targets list)
    """
    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    exported = {}
    missing = []

    # Build ratingKey -> target mapping
    rk_to_target = build_rating_key_to_target_map(preview_config)

    # Get all targets
    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])

    logger.info(f"Mapping {len(targets)} targets to captured uploads...")
    logger.info(f"  Captured uploads: {len(captured_uploads)}")
    logger.info(f"  ratingKey mappings: {len(rk_to_target)}")

    for target in targets:
        target_id = target.get('id', '')
        rating_key = target.get('ratingKey') or target.get('rating_key') or target.get('plex_id')

        if not target_id:
            continue

        if not rating_key:
            logger.error(f"MISSING_RATINGKEY target={target_id}")
            missing.append(target_id)
            continue

        rating_key = str(rating_key)

        # Find captured upload for this ratingKey
        upload = find_captured_upload_for_rating_key(captured_uploads, rating_key)

        if not upload or not upload.get('saved_path'):
            logger.error(f"MISSING_CAPTURE ratingKey={rating_key} target={target_id}")
            missing.append(target_id)
            continue

        # Determine extension from saved file
        saved_path = Path(upload['saved_path'])
        ext = saved_path.suffix.lstrip('.') or 'png'

        # Copy to output with target_id name
        output_path = output_dir / f"{target_id}_after.{ext}"

        try:
            shutil.copy2(saved_path, output_path)
            exported[target_id] = str(output_path)
            logger.info(f"Exported: {target_id} (ratingKey={rating_key}) -> {output_path}")
        except Exception as e:
            logger.error(f"Failed to export {target_id}: {e}")
            missing.append(target_id)

    return exported, missing
