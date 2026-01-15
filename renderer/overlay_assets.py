#!/usr/bin/env python3
"""
Overlay Asset Manager

Downloads and caches PNG overlay assets from Kometa's Default-Images repository.
This ensures preview overlays match production Kometa output.

Repository: https://github.com/Kometa-Team/Default-Images
"""

import os
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
import json

# Base URL for Kometa Default-Images raw files (using jsDelivr CDN for reliability)
KOMETA_CDN_BASE = "https://cdn.jsdelivr.net/gh/Kometa-Team/Default-Images@master"
KOMETA_RAW_BASE = "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master"

# Local cache directory (inside Docker container)
ASSET_CACHE_DIR = Path("/preview/assets")

# Asset mappings for different overlay types
# These match Kometa's Default-Images repository structure

STREAMING_ASSETS = {
    # Service name -> path in Default-Images repo
    "netflix": "streaming/streaming/netflix.png",
    "max": "streaming/streaming/max.png",
    "hbo_max": "streaming/streaming/max.png",  # Alias
    "prime": "streaming/streaming/amazon%20prime%20video.png",
    "amazon": "streaming/streaming/amazon%20prime%20video.png",
    "amazon_prime": "streaming/streaming/amazon%20prime%20video.png",
    "disney": "streaming/streaming/disney%2B.png",
    "disney+": "streaming/streaming/disney%2B.png",
    "hulu": "streaming/streaming/hulu.png",
    "appletv": "streaming/streaming/apple%20tv%2B.png",
    "apple_tv": "streaming/streaming/apple%20tv%2B.png",
    "peacock": "streaming/streaming/peacock.png",
    "paramount": "streaming/streaming/paramount%2B.png",
    "paramount+": "streaming/streaming/paramount%2B.png",
    "amc_plus": "streaming/streaming/amc%2B.png",
    "amc+": "streaming/streaming/amc%2B.png",
    "crunchyroll": "streaming/streaming/crunchyroll.png",
    "discovery": "streaming/streaming/discovery%2B.png",
    "discovery+": "streaming/streaming/discovery%2B.png",
    "showtime": "streaming/streaming/showtime.png",
    "starz": "streaming/streaming/starz.png",
    "britbox": "streaming/streaming/britbox.png",
    "bet+": "streaming/streaming/bet%2B.png",
    "tubi": "streaming/streaming/tubi.png",
    "mubi": "streaming/streaming/mubi.png",
    "crave": "streaming/streaming/crave.png",
    "now": "streaming/streaming/now.png",
}

NETWORK_ASSETS = {
    # Network name -> path in Default-Images repo
    "amc": "network/network/amc.png",
    "abc": "network/network/abc.png",
    "nbc": "network/network/nbc.png",
    "cbs": "network/network/cbs.png",
    "fox": "network/network/fox.png",
    "hbo": "network/network/hbo.png",
    "showtime": "network/network/showtime.png",
    "fx": "network/network/fx.png",
    "netflix": "network/network/netflix.png",
    "amazon": "network/network/amazon.png",
    "prime_video": "network/network/amazon.png",
    "disney+": "network/network/disney%2B.png",
    "disney": "network/network/disney%2B.png",
    "hulu": "network/network/hulu.png",
    "apple_tv+": "network/network/apple%20tv%2B.png",
    "apple_tv": "network/network/apple%20tv%2B.png",
    "appletv": "network/network/apple%20tv%2B.png",
    "paramount+": "network/network/paramount%2B.png",
    "paramount": "network/network/paramount%2B.png",
    "peacock": "network/network/peacock.png",
    "bbc_one": "network/network/bbc%20one.png",
    "bbc_two": "network/network/bbc%20two.png",
    "bbc": "network/network/bbc%20one.png",
    "itv": "network/network/itv.png",
    "syfy": "network/network/syfy.png",
    "usa": "network/network/usa%20network.png",
    "usa_network": "network/network/usa%20network.png",
    "tnt": "network/network/tnt.png",
    "tbs": "network/network/tbs.png",
    "adult_swim": "network/network/adult%20swim.png",
    "cartoon_network": "network/network/cartoon%20network.png",
    "comedy_central": "network/network/comedy%20central.png",
    "the_cw": "network/network/the%20cw.png",
    "cw": "network/network/the%20cw.png",
    "history": "network/network/history.png",
    "discovery": "network/network/discovery.png",
    "natgeo": "network/network/national%20geographic.png",
    "national_geographic": "network/network/national%20geographic.png",
    "a&e": "network/network/a%26e.png",
}

STUDIO_ASSETS = {
    # Studio name (lowercase) -> path in Default-Images repo
    "warner bros. pictures": "studio/studio/warner%20bros.%20pictures.png",
    "warner bros.": "studio/studio/warner%20bros.%20pictures.png",
    "warner bros": "studio/studio/warner%20bros.%20pictures.png",
    "legendary pictures": "studio/studio/legendary%20pictures.png",
    "legendary": "studio/studio/legendary%20pictures.png",
    "sony pictures": "studio/studio/sony%20pictures.png",
    "sony pictures television": "studio/studio/sony%20pictures%20television.png",
    "sony": "studio/studio/sony%20pictures.png",
    "universal pictures": "studio/studio/universal%20pictures.png",
    "universal": "studio/studio/universal%20pictures.png",
    "paramount pictures": "studio/studio/paramount%20pictures.png",
    "paramount": "studio/studio/paramount%20pictures.png",
    "20th century studios": "studio/studio/20th%20century%20studios.png",
    "20th century fox": "studio/studio/20th%20century%20studios.png",
    "walt disney pictures": "studio/studio/walt%20disney%20pictures.png",
    "disney": "studio/studio/walt%20disney%20pictures.png",
    "pixar": "studio/studio/pixar.png",
    "pixar animation studios": "studio/studio/pixar.png",
    "dreamworks": "studio/studio/dreamworks%20animation.png",
    "dreamworks animation": "studio/studio/dreamworks%20animation.png",
    "marvel studios": "studio/studio/marvel%20studios.png",
    "marvel": "studio/studio/marvel%20studios.png",
    "dc studios": "studio/studio/dc%20studios.png",
    "dc films": "studio/studio/dc%20studios.png",
    "dc": "studio/studio/dc%20studios.png",
    "lucasfilm": "studio/studio/lucasfilm.png",
    "lionsgate": "studio/studio/lionsgate.png",
    "mgm": "studio/studio/mgm.png",
    "metro-goldwyn-mayer": "studio/studio/mgm.png",
    "columbia pictures": "studio/studio/columbia%20pictures.png",
    "columbia": "studio/studio/columbia%20pictures.png",
    "new line cinema": "studio/studio/new%20line%20cinema.png",
    "new line": "studio/studio/new%20line%20cinema.png",
    "a24": "studio/studio/a24.png",
    "blumhouse": "studio/studio/blumhouse.png",
    "blumhouse productions": "studio/studio/blumhouse.png",
}

RESOLUTION_ASSETS = {
    "4k": "resolution/resolution/4k.png",
    "4K": "resolution/resolution/4k.png",
    "1080p": "resolution/resolution/1080p.png",
    "1080": "resolution/resolution/1080p.png",
    "720p": "resolution/resolution/720p.png",
    "720": "resolution/resolution/720p.png",
    "576p": "resolution/resolution/576p.png",
    "480p": "resolution/resolution/480p.png",
    "480": "resolution/resolution/480p.png",
    "sd": "resolution/resolution/sd.png",
}

AUDIO_CODEC_ASSETS = {
    "dolby atmos": "audio_codec/audio_codec/dolby%20atmos.png",
    "atmos": "audio_codec/audio_codec/dolby%20atmos.png",
    "truehd": "audio_codec/audio_codec/truehd.png",
    "dts-hd ma": "audio_codec/audio_codec/dts-hd%20ma.png",
    "dts-hd": "audio_codec/audio_codec/dts-hd%20ma.png",
    "dts-x": "audio_codec/audio_codec/dts-x.png",
    "dts": "audio_codec/audio_codec/dts.png",
    "aac": "audio_codec/audio_codec/aac.png",
    "ac3": "audio_codec/audio_codec/dolby%20digital.png",
    "eac3": "audio_codec/audio_codec/dolby%20digital%20plus.png",
    "dolby digital": "audio_codec/audio_codec/dolby%20digital.png",
    "dolby digital plus": "audio_codec/audio_codec/dolby%20digital%20plus.png",
    "flac": "audio_codec/audio_codec/flac.png",
    "pcm": "audio_codec/audio_codec/pcm.png",
    "opus": "audio_codec/audio_codec/opus.png",
}

HDR_ASSETS = {
    "hdr": "resolution/resolution/hdr.png",
    "hdr10": "resolution/resolution/hdr.png",
    "hdr10+": "resolution/resolution/hdr.png",
    "dolby_vision": "resolution/resolution/dolby%20vision.png",
    "dv": "resolution/resolution/dolby%20vision.png",
}

RIBBON_ASSETS = {
    "imdb_top_250": "ribbon/ribbon/imdb%20top%20250.png",
    "imdb_lowest": "ribbon/ribbon/imdb%20lowest%20rated.png",
    "rt_certified_fresh": "ribbon/ribbon/rotten%20tomatoes%20certified%20fresh.png",
    "common_sense": "ribbon/ribbon/common%20sense%20selection.png",
}

# Ratings assets have multiple source options
RATINGS_ASSETS = {
    "imdb": "ratings/ratings/imdb.png",
    "tmdb": "ratings/ratings/tmdb.png",
    "rt_critics": "ratings/ratings/rotten%20tomatoes%20critics.png",
    "rt_audience": "ratings/ratings/rotten%20tomatoes%20audience.png",
    "metacritic": "ratings/ratings/metacritic.png",
    "letterboxd": "ratings/ratings/letterboxd.png",
}

# Cache for downloaded assets (in-memory)
_asset_cache: Dict[str, bytes] = {}


def ensure_cache_dir() -> Path:
    """Ensure the asset cache directory exists."""
    ASSET_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return ASSET_CACHE_DIR


def get_cache_path(asset_path: str) -> Path:
    """Get local cache path for an asset."""
    # Create a safe filename from the path
    safe_name = hashlib.md5(asset_path.encode()).hexdigest() + ".png"
    return ensure_cache_dir() / safe_name


def download_asset(asset_path: str, use_cdn: bool = True) -> Optional[bytes]:
    """
    Download an asset from Kometa's Default-Images repository.

    Args:
        asset_path: Path within the repository (e.g., "streaming/streaming/netflix.png")
        use_cdn: Use CDN (jsDelivr) instead of raw GitHub

    Returns:
        PNG image data as bytes, or None if download failed
    """
    # Check in-memory cache first
    if asset_path in _asset_cache:
        return _asset_cache[asset_path]

    # Check local disk cache
    cache_path = get_cache_path(asset_path)
    if cache_path.exists():
        try:
            data = cache_path.read_bytes()
            _asset_cache[asset_path] = data
            return data
        except Exception:
            pass

    # Download from remote
    base_url = KOMETA_CDN_BASE if use_cdn else KOMETA_RAW_BASE
    url = f"{base_url}/{asset_path}"

    try:
        req = Request(url, headers={"User-Agent": "KometaPreviewStudio/1.0"})
        with urlopen(req, timeout=10) as response:
            data = response.read()

            # Cache to disk
            try:
                cache_path.write_bytes(data)
            except Exception as e:
                print(f"Warning: Failed to cache asset to disk: {e}")

            # Cache in memory
            _asset_cache[asset_path] = data
            return data

    except HTTPError as e:
        # Try fallback to raw GitHub if CDN fails
        if use_cdn:
            print(f"CDN failed for {asset_path}, trying raw GitHub...")
            return download_asset(asset_path, use_cdn=False)
        print(f"Failed to download asset {asset_path}: HTTP {e.code}")
        return None
    except URLError as e:
        print(f"Failed to download asset {asset_path}: {e.reason}")
        return None
    except Exception as e:
        print(f"Error downloading asset {asset_path}: {e}")
        return None


def get_streaming_asset(service: str) -> Optional[bytes]:
    """Get streaming service overlay PNG."""
    service_lower = service.lower().replace(" ", "_").replace("-", "_")

    # Try direct lookup
    if service_lower in STREAMING_ASSETS:
        return download_asset(STREAMING_ASSETS[service_lower])

    # Try variations
    for key, path in STREAMING_ASSETS.items():
        if service_lower in key or key in service_lower:
            return download_asset(path)

    print(f"No streaming asset found for: {service}")
    return None


def get_network_asset(network: str) -> Optional[bytes]:
    """Get network overlay PNG."""
    network_lower = network.lower().replace(" ", "_").replace("-", "_")

    # Try direct lookup
    if network_lower in NETWORK_ASSETS:
        return download_asset(NETWORK_ASSETS[network_lower])

    # Try variations
    for key, path in NETWORK_ASSETS.items():
        if network_lower in key or key in network_lower:
            return download_asset(path)

    print(f"No network asset found for: {network}")
    return None


def get_studio_asset(studio: str) -> Optional[bytes]:
    """Get studio overlay PNG."""
    studio_lower = studio.lower()

    # Try direct lookup
    if studio_lower in STUDIO_ASSETS:
        return download_asset(STUDIO_ASSETS[studio_lower])

    # Try partial match
    for key, path in STUDIO_ASSETS.items():
        if key in studio_lower or studio_lower in key:
            return download_asset(path)

    print(f"No studio asset found for: {studio}")
    return None


def get_resolution_asset(resolution: str) -> Optional[bytes]:
    """Get resolution overlay PNG."""
    res_lower = resolution.lower()
    if res_lower in RESOLUTION_ASSETS:
        return download_asset(RESOLUTION_ASSETS[res_lower])
    return None


def get_audio_codec_asset(codec: str) -> Optional[bytes]:
    """Get audio codec overlay PNG."""
    codec_lower = codec.lower()
    if codec_lower in AUDIO_CODEC_ASSETS:
        return download_asset(AUDIO_CODEC_ASSETS[codec_lower])
    return None


def get_hdr_asset(hdr_type: str) -> Optional[bytes]:
    """Get HDR overlay PNG."""
    hdr_lower = hdr_type.lower().replace(" ", "_")
    if hdr_lower in HDR_ASSETS:
        return download_asset(HDR_ASSETS[hdr_lower])
    return None


def get_ribbon_asset(ribbon_type: str) -> Optional[bytes]:
    """Get ribbon overlay PNG."""
    if ribbon_type in RIBBON_ASSETS:
        return download_asset(RIBBON_ASSETS[ribbon_type])
    return None


def get_rating_source_asset(source: str) -> Optional[bytes]:
    """Get rating source logo PNG (e.g., IMDb logo, TMDb logo)."""
    source_lower = source.lower()
    if source_lower in RATINGS_ASSETS:
        return download_asset(RATINGS_ASSETS[source_lower])
    return None


def preload_common_assets():
    """Pre-download commonly used assets for faster rendering."""
    common_assets = [
        # Resolution
        "resolution/resolution/4k.png",
        "resolution/resolution/1080p.png",
        "resolution/resolution/hdr.png",
        "resolution/resolution/dolby%20vision.png",
        # Audio
        "audio_codec/audio_codec/dolby%20atmos.png",
        "audio_codec/audio_codec/dts-hd%20ma.png",
        # Ribbons
        "ribbon/ribbon/imdb%20top%20250.png",
        # Common streaming
        "streaming/streaming/netflix.png",
        "streaming/streaming/max.png",
        # Common networks
        "network/network/amc.png",
        "network/network/hbo.png",
    ]

    loaded = 0
    for asset_path in common_assets:
        if download_asset(asset_path):
            loaded += 1

    print(f"Pre-loaded {loaded}/{len(common_assets)} common overlay assets")
    return loaded
