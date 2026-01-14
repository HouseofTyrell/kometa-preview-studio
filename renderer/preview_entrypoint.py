#!/usr/bin/env python3
"""
Kometa Preview Studio - Preview Renderer (Path A with Proxy + Upload Capture)

This script runs REAL Kometa inside the container with a local HTTP proxy
that blocks all write operations to Plex while CAPTURING the uploaded images.

SAFETY MECHANISM:
- A local proxy server intercepts all Plex requests
- GET/HEAD requests are forwarded to the real Plex server
- PUT/POST/PATCH/DELETE requests are BLOCKED but their payloads are CAPTURED
- Captured images are saved to disk keyed by Plex ratingKey
- This works across process boundaries (subprocess-safe)

OUTPUT MAPPING:
- When Kometa uploads a poster (blocked), the image bytes are extracted
- The ratingKey is parsed from the request path
- Images are saved to: output/previews/<ratingKey>__<kind>.<ext>
- After Kometa finishes, targets are mapped by ratingKey to get correct outputs

Usage:
    python3 preview_entrypoint.py --job /jobs/<jobId>
"""

import argparse
import json
import os
import re
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add the renderer directory to the path for direct execution
_renderer_dir = Path(__file__).parent.resolve()
if str(_renderer_dir) not in sys.path:
    sys.path.insert(0, str(_renderer_dir))

# Import from refactored modules
from constants import (
    logger,
    PREVIEW_ACCURACY,
    PREVIEW_EXTERNAL_ID_LIMIT,
    PREVIEW_EXTERNAL_PAGES_LIMIT,
    TMDB_PROXY_ENABLED,
    FAST_MODE,
    OUTPUT_CACHE_ENABLED,
)
from fonts import validate_fonts_at_startup, ensure_font_fallbacks
from caching import (
    compute_config_hash,
    check_cached_outputs,
    save_cache_hash,
    use_cached_outputs,
)
from xml_builders import extract_allowed_rating_keys
from proxy_plex import PlexProxy
from proxy_tmdb import TMDbProxy
from config import (
    load_preview_config,
    apply_fast_mode_sanitization,
    apply_font_fallbacks_to_overlays,
    fetch_proxy_sections,
    validate_library_sections,
    generate_proxy_config,
    redact_yaml_snippet,
)
from kometa_runner import run_kometa
from export import export_overlay_outputs, export_local_preview_artifacts


def main():
    """Main entry point for the Kometa Preview Renderer"""
    parser = argparse.ArgumentParser(
        description='Kometa Preview Renderer - Runs real Kometa with proxy-based write blocking and upload capture'
    )
    parser.add_argument('--job', required=True, help='Path to job directory')
    args = parser.parse_args()

    job_path = Path(args.job)
    preview_targets: List[Dict[str, Any]] = []
    proxy: Optional[PlexProxy] = None
    tmdb_proxy: Optional[TMDbProxy] = None
    final_exit = 1
    summary_written = False
    summary_path: Optional[Path] = None
    summary: Optional[Dict[str, Any]] = None
    config_hash: Optional[str] = None

    if not job_path.exists():
        logger.error(f"Job directory not found: {job_path}")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("Kometa Preview Studio")
    logger.info("Path A: Real Kometa with Proxy Write Blocking + Upload Capture")
    logger.info("=" * 60)
    logger.info(f"Job path: {job_path}")
    logger.info(f"Preview mode: {PREVIEW_ACCURACY}")

    # P1: Validate font availability at startup
    try:
        available_font_dirs = validate_fonts_at_startup()
    except FileNotFoundError as e:
        logger.error(f"Font validation failed: {e}")
        sys.exit(1)

    output_dir = job_path / 'output'
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create output subdirectories
    (output_dir / 'previews').mkdir(parents=True, exist_ok=True)
    (output_dir / 'by_ratingkey').mkdir(parents=True, exist_ok=True)

    # Load config
    try:
        preview_config = load_preview_config(job_path)
        logger.info("Preview config loaded successfully")
    except Exception as e:
        logger.error(f"Failed to load preview config: {e}")
        sys.exit(1)

    summary_path = output_dir / 'summary.json'

    # Log configured Plex URL
    configured_plex_url = preview_config.get('plex', {}).get('url', '')
    logger.info(f"Configured Plex URL (preview config): {configured_plex_url}")

    # Apply font fallbacks and FAST mode guardrails
    ensure_font_fallbacks(preview_config)
    if FAST_MODE:
        preview_config = apply_fast_mode_sanitization(job_path, preview_config)
    else:
        apply_font_fallbacks_to_overlays(job_path, preview_config)

    # ================================================================
    # Output Caching Check
    # Skip rendering entirely if config unchanged and outputs exist
    # ================================================================
    if OUTPUT_CACHE_ENABLED:
        config_hash = compute_config_hash(preview_config)
        logger.info(f"Config hash: {config_hash}")

        if check_cached_outputs(job_path, config_hash):
            logger.info("=" * 60)
            logger.info("CACHE HIT - Using cached outputs (instant return)")
            logger.info("=" * 60)

            success, cached_files = use_cached_outputs(job_path)

            if success:
                # Write summary for cached run
                summary = {
                    'timestamp': datetime.now().isoformat(),
                    'success': True,
                    'cached': True,
                    'config_hash': config_hash,
                    'exported_files': cached_files,
                    'output_files': [Path(f).name for f in cached_files.values()],
                }
                summary_path = output_dir / 'summary.json'
                with open(summary_path, 'w') as f:
                    json.dump(summary, f, indent=2)

                logger.info(f"Returning {len(cached_files)} cached outputs")
                sys.exit(0)
            else:
                logger.warning("Cache invalid - proceeding with rendering")
    else:
        config_hash = None
        logger.info("Output caching disabled (PREVIEW_OUTPUT_CACHE=0)")

    # Extract Plex connection info
    plex_config = preview_config.get('plex', {})
    real_plex_url = plex_config.get('url', '')
    plex_token = plex_config.get('token', '')

    if not real_plex_url:
        logger.error("No Plex URL found in config")
        sys.exit(1)

    logger.info(f"Real Plex URL: {real_plex_url}")

    # Extract allowed ratingKeys for filtering
    allowed_rating_keys = extract_allowed_rating_keys(preview_config)

    # Log target ratingKeys for debugging
    preview_data = preview_config.get('preview', {})
    targets = preview_data.get('targets', [])
    preview_targets = targets
    logger.info(f"Preview targets ({len(targets)}):")
    for t in targets:
        rk = t.get('ratingKey') or t.get('rating_key') or 'MISSING'
        logger.info(f"  - {t.get('id')}: ratingKey={rk}")

    if not allowed_rating_keys:
        logger.warning("No ratingKeys found in preview targets - filtering will be DISABLED")
        logger.warning("Kometa will process ALL library items (may be slow)")
    else:
        logger.info(f"Proxy will only expose {len(allowed_rating_keys)} items to Kometa")

    # Start the write-blocking proxy with capture, filtering, and mock mode
    proxy = PlexProxy(
        real_plex_url, plex_token, job_path,
        allowed_rating_keys=allowed_rating_keys,
        preview_targets=targets
    )
    if configured_plex_url and configured_plex_url != proxy.proxy_url:
        logger.warning(
            f"Configured Plex URL is not the proxy: {configured_plex_url} "
            f"(expected {proxy.proxy_url})"
        )

    # Start TMDb proxy for fast mode (caps external ID expansions)
    tmdb_proxy = None
    if TMDB_PROXY_ENABLED:
        logger.info("=" * 60)
        logger.info(f"Preview Accuracy Mode: {PREVIEW_ACCURACY.upper()}")
        logger.info(f"  External ID Limit: {PREVIEW_EXTERNAL_ID_LIMIT}")
        logger.info(f"  External Pages Limit: {PREVIEW_EXTERNAL_PAGES_LIMIT}")
        logger.info("=" * 60)

        tmdb_proxy = TMDbProxy(
            fast_mode=(PREVIEW_ACCURACY == 'fast'),
            id_limit=PREVIEW_EXTERNAL_ID_LIMIT,
            pages_limit=PREVIEW_EXTERNAL_PAGES_LIMIT
        )
    else:
        logger.info("=" * 60)
        logger.info(f"Preview Accuracy Mode: {PREVIEW_ACCURACY.upper()}")
        if PREVIEW_ACCURACY == 'accurate':
            logger.info("  TMDb proxy disabled - full external expansion enabled")
        logger.info("=" * 60)

    try:
        proxy.start()
        if tmdb_proxy:
            tmdb_proxy.start()

        # Validate sections endpoint for selected libraries
        selected_libraries = list(preview_config.get('libraries', {}).keys())
        has_movies = any(t.get('type') in ('movie', 'movies') for t in targets)
        has_shows = any(t.get('type') in ('show', 'shows', 'series', 'season', 'episode') for t in targets)
        expected_type = None
        if has_movies and not has_shows:
            expected_type = 'movie'
        elif has_shows and not has_movies:
            expected_type = 'show'

        if selected_libraries:
            sections_xml = fetch_proxy_sections(proxy.proxy_url, plex_token)
            validate_library_sections(sections_xml, selected_libraries, expected_type)

        # ================================================================
        # PHASE 1: Instant Draft Preview
        # Create draft overlays immediately using hardcoded metadata
        # ================================================================
        logger.info("=" * 60)
        logger.info("Phase 1: Creating instant draft preview...")
        logger.info("=" * 60)

        try:
            from instant_compositor import run_instant_preview
            draft_result = run_instant_preview(job_path)
            if draft_result == 0:
                logger.info("Draft preview created successfully")
            else:
                logger.warning("Draft preview creation had issues (continuing with Kometa)")
        except ImportError:
            logger.warning("Instant compositor not available - skipping draft preview")
        except Exception as e:
            logger.warning(f"Draft preview failed (continuing with Kometa): {e}")

        # ================================================================
        # PHASE 2: Full Kometa Render
        # Run real Kometa for accurate, production-quality overlays
        # ================================================================

        # Generate config that points to our proxy
        kometa_config_path = generate_proxy_config(job_path, preview_config, proxy.proxy_url)

        # Run Kometa
        logger.info("=" * 60)
        logger.info("Phase 2: Starting Kometa for accurate render...")
        logger.info("=" * 60)

        tmdb_proxy_url = tmdb_proxy.proxy_url if tmdb_proxy else None
        logger.info(f"Launching Kometa with config={kometa_config_path} plex_url={proxy.proxy_url}")
        exit_code = run_kometa(kometa_config_path, tmdb_proxy_url=tmdb_proxy_url)

        logger.info("=" * 60)
        logger.info(f"Kometa finished with exit code: {exit_code}")
        logger.info("=" * 60)

        # Get captured data
        blocked_requests = proxy.get_blocked_requests()
        captured_uploads = proxy.get_captured_uploads()
        filtered_requests = proxy.get_filtered_requests()
        mock_list_requests = proxy.get_mock_list_requests()
        forward_count = proxy.get_forward_request_count()
        blocked_metadata_count = proxy.get_blocked_metadata_count()
        learned_parents = proxy.get_learned_parent_keys()
        request_log = proxy.get_request_log()
        sections_get_count = proxy.get_sections_get_count()
        metadata_get_count = proxy.get_metadata_get_count()
        # H3/H4: Get diagnostic data
        zero_match_searches = proxy.get_zero_match_searches()
        type_mismatches = proxy.get_type_mismatches()

        logger.info(f"Blocked {len(blocked_requests)} write attempts")
        logger.info(f"Captured {len(captured_uploads)} uploads")

        sections_all_count = sum(
            1 for req in request_log
            if req.get('method') == 'GET' and re.match(r'^/library/sections/\d+/all$', req.get('path_base', ''))
        )

        # Traffic sanity check: ensure proxy is in the request path
        if sections_get_count == 0 and metadata_get_count == 0 and sections_all_count == 0:
            logger.error("PROXY_TRAFFIC_SANITY_FAILED: missing expected Plex GET traffic")
            logger.error(f"  /library/sections GETs: {sections_get_count}")
            logger.error(f"  /library/metadata/* GETs: {metadata_get_count}")
            logger.error(f"  /library/sections/<id>/all GETs: {sections_all_count}")
            if request_log:
                logger.error("  Last 30 requests:")
                for req in request_log[-30:]:
                    logger.error(f"    {req.get('method')} {req.get('path_base')}")
            if kometa_config_path and kometa_config_path.exists():
                snippet_lines = kometa_config_path.read_text().splitlines()[:20]
                snippet_lines = redact_yaml_snippet(snippet_lines)
                logger.error("Kometa config snippet (first 20 lines, redacted):")
                for line in snippet_lines:
                    logger.error(f"  {line}")
            raise RuntimeError(
                "Kometa did not process libraries - likely invalid config "
                "(missing libraries) or YAML truncated (unexpected '...')."
            )

        # Log mock mode vs filter mode statistics
        if proxy.mock_mode_enabled:
            logger.info(f"Mock list requests: {len(mock_list_requests)}")
            logger.info(f"Forwarded requests: {forward_count}")
            logger.info(f"Blocked metadata requests: {blocked_metadata_count}")
            if learned_parents:
                logger.info(f"Learned parent ratingKeys: {sorted(learned_parents)}")
        else:
            logger.info(f"Filtered {len(filtered_requests)} listing requests")

        # Log capture summary
        successful_captures = [u for u in captured_uploads if u.get('saved_path')]
        failed_captures = [u for u in captured_uploads if not u.get('saved_path')]

        if successful_captures:
            logger.info("Successful captures:")
            for u in successful_captures:
                logger.info(f"  ratingKey={u.get('rating_key')} kind={u.get('kind')} path={u.get('saved_path')}")

        if failed_captures:
            logger.warning("Failed captures:")
            for u in failed_captures:
                logger.warning(f"  ratingKey={u.get('rating_key')} error={u.get('parse_error')}")

        # Export outputs with deterministic mapping
        if successful_captures:
            exported_files, missing_targets = export_overlay_outputs(
                job_path, preview_config, captured_uploads
            )
        else:
            exported_files = {}
            missing_targets = [
                t.get('id') for t in targets if t.get('id')
            ]

        local_artifacts = {}
        if not successful_captures:
            local_artifacts = export_local_preview_artifacts(job_path, preview_config)
            for target_id, preview_path in local_artifacts.items():
                exported_files[target_id] = preview_path
                if target_id in missing_targets:
                    missing_targets.remove(target_id)

        no_capture_error = False
        if not successful_captures and not local_artifacts and targets:
            no_capture_error = True
            logger.error("NO_CAPTURE_OUTPUTS: No uploads captured and no local artifacts found.")
            if request_log:
                logger.error("Last 30 requests seen by proxy:")
                for req in request_log[-30:]:
                    logger.error(f"  {req.get('method')} {req.get('path_base')}")

        # Get TMDb proxy statistics
        tmdb_stats = {}
        if tmdb_proxy:
            tmdb_stats = tmdb_proxy.get_stats()
            tmdb_capped_requests = tmdb_stats.get('capped_requests', [])
            if tmdb_capped_requests:
                logger.info(f"TMDb capped requests: {len(tmdb_capped_requests)}")
                for req in tmdb_capped_requests:
                    logger.info(
                        f"  {req.get('path')}: {req.get('original_total')} -> {req.get('capped_to')}"
                    )
            # G1/G2/H1: Log deduplication and suppression stats
            if tmdb_stats.get('cache_hits', 0) > 0:
                logger.info(f"TMDb requests deduplicated (cache hits): {tmdb_stats['cache_hits']}")
            if tmdb_stats.get('skipped_non_overlay', 0) > 0:
                logger.info(f"TMDb non-overlay discover skipped: {tmdb_stats['skipped_non_overlay']}")
            if tmdb_stats.get('skipped_tvdb_conversions', 0) > 0:
                logger.info(f"TMDb->TVDb conversions skipped: {tmdb_stats['skipped_tvdb_conversions']}")

        # H3/H4: Log diagnostic warnings
        if zero_match_searches > 0:
            logger.warning(f"DIAGNOSTIC: {zero_match_searches} search queries returned 0 results")
        if type_mismatches:
            logger.warning(f"DIAGNOSTIC: {len(type_mismatches)} type mismatches detected")
            for mismatch in type_mismatches[:5]:  # Limit to first 5
                logger.warning(f"  {mismatch.get('description', mismatch)}")

        # Write summary
        render_success = (
            exit_code == 0 and
            len(missing_targets) == 0 and
            len(exported_files) > 0 and
            not no_capture_error
        )
        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': render_success,
            'cached': False,
            'config_hash': config_hash,
            'kometa_exit_code': exit_code,
            'blocked_write_attempts': blocked_requests,
            'captured_uploads': captured_uploads,
            'captured_uploads_count': len(captured_uploads),
            'successful_captures_count': len(successful_captures),
            'local_artifacts': local_artifacts,
            'local_artifacts_count': len(local_artifacts),
            'exported_files': exported_files,
            'missing_targets': missing_targets,
            'output_files': [f.name for f in output_dir.glob('*_after.*')],
            'proxy_request_log_tail': request_log[-30:],
            'proxy_traffic': {
                'sections_get_count': sections_get_count,
                'metadata_get_count': metadata_get_count,
                'total_requests': len(request_log),
            },
            # Preview accuracy mode statistics (G1/G2/G3/H1)
            'preview_accuracy': {
                'mode': PREVIEW_ACCURACY,
                'external_id_limit': PREVIEW_EXTERNAL_ID_LIMIT,
                'external_pages_limit': PREVIEW_EXTERNAL_PAGES_LIMIT,
                'tmdb_proxy_enabled': tmdb_proxy is not None,
                'tmdb_total_requests': tmdb_stats.get('total_requests', 0),
                'tmdb_capped_requests': tmdb_stats.get('capped_requests', []),
                'tmdb_capped_requests_count': tmdb_stats.get('capped_requests_count', 0),
                # G1: Request deduplication statistics
                'tmdb_cache_hits': tmdb_stats.get('cache_hits', 0),
                'tmdb_cache_size': tmdb_stats.get('cache_size', 0),
                # G2: Non-overlay discover suppression
                'tmdb_skipped_non_overlay': tmdb_stats.get('skipped_non_overlay', 0),
                # H1: TVDb conversion suppression
                'tmdb_skipped_tvdb_conversions': tmdb_stats.get('skipped_tvdb_conversions', 0),
            },
            # Mock library mode statistics
            'mock_mode': {
                'enabled': proxy.mock_mode_enabled,
                'mock_list_requests': mock_list_requests,
                'mock_list_requests_count': len(mock_list_requests),
                'forward_requests_count': forward_count,
                'blocked_metadata_count': blocked_metadata_count,
                'learned_parent_keys': sorted(learned_parents) if learned_parents else [],
            },
            # Legacy filtering statistics (when mock mode disabled)
            'filtering': {
                'enabled': proxy.filtering_enabled and not proxy.mock_mode_enabled,
                'allowed_rating_keys': sorted(allowed_rating_keys) if allowed_rating_keys else [],
                'allowed_count': len(allowed_rating_keys),
                'filtered_requests': filtered_requests,
                'filtered_requests_count': len(filtered_requests),
            },
            # H3/H4: Diagnostic information
            'diagnostics': {
                'zero_match_searches': zero_match_searches,
                'type_mismatches': type_mismatches,
                'type_mismatches_count': len(type_mismatches),
                'no_capture_error': no_capture_error,
            },
        }

        summary_path = output_dir / 'summary.json'
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)

        logger.info(f"Summary written to: {summary_path}")
        summary_written = True

        # Save cache hash for successful renders (enables instant subsequent runs)
        if render_success and config_hash:
            save_cache_hash(job_path, config_hash)

        # P0 Safety Check: If we have targets but no captured uploads, provide actionable error
        targets_count = len(preview_targets) if preview_targets else 0
        if targets_count > 0 and len(successful_captures) == 0:
            logger.error("=" * 60)
            logger.error("UPLOAD CAPTURE FAILURE - No images were captured!")
            logger.error("=" * 60)
            logger.error(f"Targets: {targets_count}")
            logger.error(f"Total blocked requests: {len(blocked_requests)}")
            logger.error(f"Total capture attempts: {len(captured_uploads)}")

            # Show last 20 PUT/POST requests for debugging
            write_requests = [r for r in blocked_requests if r.get('method') in ('PUT', 'POST')]
            if write_requests:
                logger.error(f"\nLast {min(20, len(write_requests))} PUT/POST requests:")
                for req in write_requests[-20:]:
                    logger.error(
                        f"  {req.get('method')} {req.get('path', '').split('?')[0]} "
                        f"content_type={req.get('content_type')} "
                        f"content_length={req.get('content_length')} "
                        f"ratingKey={req.get('rating_key')}"
                    )
            else:
                logger.error("No PUT/POST requests were received by the proxy!")
                logger.error("Check if Kometa is actually sending upload requests.")

            # Show failed captures
            if failed_captures:
                logger.error("\nFailed capture attempts:")
                for cap in failed_captures[:10]:
                    logger.error(
                        f"  path={cap.get('path')} error={cap.get('parse_error')}"
                    )

            logger.error("=" * 60)

        # Report results
        output_count = len(list(output_dir.glob('*_after.*')))
        if output_count > 0 and len(missing_targets) == 0 and not no_capture_error:
            logger.info(f"Preview rendering complete: {output_count} images generated")
            final_exit = 0
        elif output_count > 0:
            logger.warning(
                f"Preview rendering partial: {output_count} images generated, "
                f"{len(missing_targets)} targets missing"
            )
            final_exit = 1
        else:
            logger.error("Preview rendering failed: no output images generated")
            # Add extra diagnostic info for P0 failure
            if targets_count > 0:
                logger.error(f"  - {targets_count} targets were expected")
                logger.error(f"  - {len(blocked_requests)} write requests were blocked")
                logger.error(f"  - {len(successful_captures)} images were captured")
                logger.error("  Check logs above for UPLOAD_CAPTURED or UPLOAD_IGNORED messages")
            final_exit = 1

    except Exception as e:
        logger.error("Preview run failed with an unexpected error:")
        logger.error(str(e))
        logger.debug(traceback.format_exc())

        if proxy:
            request_log = proxy.get_request_log()
        else:
            request_log = []

        summary = {
            'timestamp': datetime.now().isoformat(),
            'success': False,
            'cached': False,
            'error': str(e),
            'request_log_tail': request_log[-30:],
        }
        final_exit = 1

    finally:
        if proxy:
            proxy.stop()
        if tmdb_proxy:
            tmdb_proxy.stop()
        if summary_path and summary and not summary_written:
            try:
                with open(summary_path, 'w') as f:
                    json.dump(summary, f, indent=2)
                logger.info(f"Summary written to: {summary_path}")
            except Exception as write_error:
                logger.error(f"Failed to write summary: {write_error}")

    sys.exit(final_exit)


if __name__ == '__main__':
    main()
