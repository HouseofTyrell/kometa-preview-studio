#!/usr/bin/env python3
"""
Overlay Asset Manager

Downloads and caches PNG overlay assets from Kometa's Default-Images repository.
This ensures preview overlays match production Kometa output.

Repository: https://github.com/Kometa-Team/Default-Images

Cache Persistence:
  Mount /preview/assets as a Docker volume to persist cached assets between restarts.
  Example: docker run -v kometa-assets:/preview/assets ...

Environment Variables:
  ASSET_CACHE_DIR: Override default cache directory (default: /preview/assets)
  ASSET_CACHE_TTL_DAYS: Days before re-checking CDN for updated assets (default: 7)
  ASSET_VERSION: Force cache refresh by changing this value (default: "1")
"""

import os
import hashlib
import time
from pathlib import Path
from typing import Optional, Dict, Any
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from urllib.parse import unquote
import json

# Base URL for Kometa Default-Images raw files (using jsDelivr CDN for reliability)
KOMETA_CDN_BASE = "https://cdn.jsdelivr.net/gh/Kometa-Team/Default-Images@master"
KOMETA_RAW_BASE = "https://raw.githubusercontent.com/Kometa-Team/Default-Images/master"

# Cache configuration from environment
ASSET_CACHE_DIR = Path(os.environ.get("ASSET_CACHE_DIR", "/preview/assets"))
ASSET_CACHE_TTL_DAYS = int(os.environ.get("ASSET_CACHE_TTL_DAYS", "7"))
ASSET_VERSION = os.environ.get("ASSET_VERSION", "1")
CACHE_METADATA_FILE = "cache_metadata.json"

# Asset mappings for different overlay types
# These match Kometa's Default-Images repository structure

STREAMING_ASSETS = {
    # Service name -> path in Default-Images repo (logos, not overlays)
    # Major US Services
    "netflix": "streaming/logos/Netflix.png",
    "max": "streaming/logos/Max.png",
    "hbo_max": "streaming/logos/HBO%20Max.png",  # Alias
    "hbo": "streaming/logos/HBO%20Max.png",  # Alias
    "prime": "streaming/logos/Prime%20Video.png",
    "amazon": "streaming/logos/Prime%20Video.png",
    "amazon_prime": "streaming/logos/Prime%20Video.png",
    "amazon_prime_video": "streaming/logos/Prime%20Video.png",
    "disney": "streaming/logos/Disney%2B.png",
    "disney+": "streaming/logos/Disney%2B.png",
    "disneyplus": "streaming/logos/Disney%2B.png",
    "hulu": "streaming/logos/Hulu.png",
    "appletv": "streaming/logos/Apple%20TV%2B.png",
    "apple_tv": "streaming/logos/Apple%20TV%2B.png",
    "apple_tv+": "streaming/logos/Apple%20TV%2B.png",
    "apple": "streaming/logos/Apple%20TV%2B.png",
    "peacock": "streaming/logos/Peacock.png",
    "paramount": "streaming/logos/paramount%2B.png",
    "paramount+": "streaming/logos/paramount%2B.png",
    "paramountplus": "streaming/logos/paramount%2B.png",
    # Premium Cable Streaming
    "amc_plus": "streaming/logos/AMC%2B.png",
    "amc+": "streaming/logos/AMC%2B.png",
    "showtime": "streaming/logos/showtime.png",
    "starz": "streaming/logos/starz.png",
    "mgm+": "streaming/logos/mgm%2B.png",
    "mgm_plus": "streaming/logos/mgm%2B.png",
    # Discovery/Reality
    "discovery": "streaming/logos/discovery%2B.png",
    "discovery+": "streaming/logos/discovery%2B.png",
    "discoveryplus": "streaming/logos/discovery%2B.png",
    # Sports
    "espn+": "streaming/logos/espn%2B.png",
    "espn_plus": "streaming/logos/espn%2B.png",
    "espn": "streaming/logos/espn%2B.png",
    "dazn": "streaming/logos/dazn.png",
    # Anime/Asian
    "crunchyroll": "streaming/logos/crunchyroll.png",
    "funimation": "streaming/logos/funimation.png",
    "hidive": "streaming/logos/hidive.png",
    "viki": "streaming/logos/viki.png",
    # Free Ad-Supported
    "tubi": "streaming/logos/tubi.png",
    "pluto": "streaming/logos/pluto%20tv.png",
    "pluto_tv": "streaming/logos/pluto%20tv.png",
    "freevee": "streaming/logos/amazon%20freevee.png",
    "amazon_freevee": "streaming/logos/amazon%20freevee.png",
    "roku": "streaming/logos/the%20roku%20channel.png",
    "roku_channel": "streaming/logos/the%20roku%20channel.png",
    "vudu": "streaming/logos/vudu.png",
    # Independent/Art House
    "mubi": "streaming/logos/mubi.png",
    "criterion": "streaming/logos/the%20criterion%20channel.png",
    "criterion_channel": "streaming/logos/the%20criterion%20channel.png",
    "shudder": "streaming/logos/shudder.png",
    "sundance": "streaming/logos/sundance%20now.png",
    "sundance_now": "streaming/logos/sundance%20now.png",
    "kanopy": "streaming/logos/kanopy.png",
    # UK/European
    "britbox": "streaming/logos/britbox.png",
    "now": "streaming/logos/now.png",
    "nowtv": "streaming/logos/now.png",
    "sky": "streaming/logos/sky%20go.png",
    "sky_go": "streaming/logos/sky%20go.png",
    "stan": "streaming/logos/stan.png",
    "hayu": "streaming/logos/hayu.png",
    "iplayer": "streaming/logos/bbc%20iplayer.png",
    "bbc_iplayer": "streaming/logos/bbc%20iplayer.png",
    "all4": "streaming/logos/all%204.png",
    "all_4": "streaming/logos/all%204.png",
    "itvx": "streaming/logos/itvx.png",
    # Canadian
    "crave": "streaming/logos/crave.png",
    "cbc_gem": "streaming/logos/cbc%20gem.png",
    # Other
    "bet+": "streaming/logos/bet%2B.png",
    "bet_plus": "streaming/logos/bet%2B.png",
    "curiosity": "streaming/logos/curiositystream.png",
    "curiositystream": "streaming/logos/curiositystream.png",
    "acorn": "streaming/logos/acorn%20tv.png",
    "acorn_tv": "streaming/logos/acorn%20tv.png",
}

NETWORK_ASSETS = {
    # Network name -> path in Default-Images repo (logos, not network/network/)
    # Major Broadcast Networks
    "abc": "network/logos/ABC.png",
    "nbc": "network/logos/NBC.png",
    "cbs": "network/logos/CBS.png",
    "fox": "network/logos/FOX.png",
    "the_cw": "network/logos/The%20CW.png",
    "cw": "network/logos/The%20CW.png",
    "pbs": "network/logos/PBS.png",
    # Premium Cable
    "hbo": "network/logos/HBO.png",
    "showtime": "network/logos/Showtime.png",
    "starz": "network/logos/Starz.png",
    "cinemax": "network/logos/Cinemax.png",
    "epix": "network/logos/EPIX.png",
    # Basic Cable - Entertainment
    "amc": "network/logos/AMC.png",
    "fx": "network/logos/FX.png",
    "fxx": "network/logos/fxx.png",
    "usa": "network/logos/usa%20network.png",
    "usa_network": "network/logos/usa%20network.png",
    "tnt": "network/logos/tnt.png",
    "tbs": "network/logos/tbs.png",
    "syfy": "network/logos/syfy.png",
    "bravo": "network/logos/bravo.png",
    "e!": "network/logos/e%21.png",
    "e_entertainment": "network/logos/e%21.png",
    "lifetime": "network/logos/lifetime.png",
    "hallmark": "network/logos/hallmark%20channel.png",
    "hallmark_channel": "network/logos/hallmark%20channel.png",
    "oxygen": "network/logos/oxygen.png",
    "wetv": "network/logos/wetv.png",
    "bet": "network/logos/bet.png",
    "vh1": "network/logos/vh1.png",
    "mtv": "network/logos/mtv.png",
    "tvland": "network/logos/tv%20land.png",
    "tv_land": "network/logos/tv%20land.png",
    "paramount_network": "network/logos/paramount%20network.png",
    # Comedy/Animation
    "comedy_central": "network/logos/comedy%20central.png",
    "adult_swim": "network/logos/adult%20swim.png",
    "cartoon_network": "network/logos/cartoon%20network.png",
    "nickelodeon": "network/logos/nickelodeon.png",
    "nick": "network/logos/nickelodeon.png",
    "disney_channel": "network/logos/disney%20channel.png",
    "disney_xd": "network/logos/disney%20xd.png",
    "freeform": "network/logos/freeform.png",
    # Documentary/Educational
    "discovery": "network/logos/discovery.png",
    "history": "network/logos/history.png",
    "natgeo": "network/logos/national%20geographic.png",
    "national_geographic": "network/logos/national%20geographic.png",
    "nat_geo": "network/logos/national%20geographic.png",
    "a&e": "network/logos/a%26e.png",
    "ae": "network/logos/a%26e.png",
    "tlc": "network/logos/tlc.png",
    "animal_planet": "network/logos/animal%20planet.png",
    "science_channel": "network/logos/science%20channel.png",
    "food_network": "network/logos/food%20network.png",
    "hgtv": "network/logos/hgtv.png",
    "travel_channel": "network/logos/travel%20channel.png",
    "investigation_discovery": "network/logos/investigation%20discovery.png",
    "id": "network/logos/investigation%20discovery.png",
    # News
    "cnn": "network/logos/cnn.png",
    "msnbc": "network/logos/msnbc.png",
    "fox_news": "network/logos/fox%20news.png",
    # Sports
    "espn": "network/logos/espn.png",
    "espn2": "network/logos/espn2.png",
    "fs1": "network/logos/fox%20sports%201.png",
    "fox_sports": "network/logos/fox%20sports%201.png",
    "nfl_network": "network/logos/nfl%20network.png",
    "nba_tv": "network/logos/nba%20tv.png",
    "mlb_network": "network/logos/mlb%20network.png",
    # Streaming Networks (when used as production source)
    "netflix": "network/logos/Netflix.png",
    "amazon": "network/logos/Amazon.png",
    "prime_video": "network/logos/Amazon.png",
    "disney+": "network/logos/Disney%2B.png",
    "disney": "network/logos/Disney%2B.png",
    "hulu": "network/logos/Hulu.png",
    "apple_tv+": "network/logos/Apple%20TV%2B.png",
    "apple_tv": "network/logos/Apple%20TV%2B.png",
    "appletv": "network/logos/Apple%20TV%2B.png",
    "paramount+": "network/logos/Paramount%2B.png",
    "paramount": "network/logos/Paramount%2B.png",
    "peacock": "network/logos/Peacock.png",
    "max": "network/logos/Max.png",
    # UK Networks
    "bbc_one": "network/logos/bbc%20one.png",
    "bbc_two": "network/logos/bbc%20two.png",
    "bbc_three": "network/logos/bbc%20three.png",
    "bbc_four": "network/logos/bbc%20four.png",
    "bbc": "network/logos/bbc%20one.png",
    "itv": "network/logos/itv.png",
    "itv2": "network/logos/itv2.png",
    "channel_4": "network/logos/channel%204.png",
    "channel4": "network/logos/channel%204.png",
    "channel_5": "network/logos/channel%205.png",
    "sky_one": "network/logos/sky%20one.png",
    "sky_atlantic": "network/logos/sky%20atlantic.png",
    "sky": "network/logos/sky%20one.png",
    # Canadian Networks
    "cbc": "network/logos/cbc.png",
    "ctv": "network/logos/ctv.png",
    "global": "network/logos/global.png",
    "citytv": "network/logos/citytv.png",
    "showcase": "network/logos/showcase.png",
    # Australian Networks
    "abc_au": "network/logos/abc%20%28au%29.png",
    "nine": "network/logos/nine%20network.png",
    "nine_network": "network/logos/nine%20network.png",
    "seven": "network/logos/seven%20network.png",
    "seven_network": "network/logos/seven%20network.png",
    "ten": "network/logos/network%2010.png",
    "network_10": "network/logos/network%2010.png",
    "sbs": "network/logos/sbs.png",
    "foxtel": "network/logos/foxtel.png",
}

STUDIO_ASSETS = {
    # Studio name (lowercase) -> path in Default-Images repo (logos, not studio/studio/)
    # Major Hollywood Studios
    "warner bros. pictures": "studio/logos/Warner%20Bros.%20Pictures.png",
    "warner bros.": "studio/logos/Warner%20Bros.%20Pictures.png",
    "warner bros": "studio/logos/Warner%20Bros.%20Pictures.png",
    "warner": "studio/logos/Warner%20Bros.%20Pictures.png",
    "warner bros. television": "studio/logos/Warner%20Bros.%20Television.png",
    "legendary pictures": "studio/logos/Legendary%20Pictures.png",
    "legendary": "studio/logos/Legendary%20Pictures.png",
    "sony pictures": "studio/logos/Sony%20Pictures.png",
    "sony pictures television": "studio/logos/Sony%20Pictures.png",
    "sony": "studio/logos/sony%20pictures.png",
    "universal pictures": "studio/logos/universal%20pictures.png",
    "universal studios": "studio/logos/universal%20pictures.png",
    "universal": "studio/logos/universal%20pictures.png",
    "universal television": "studio/logos/universal%20television.png",
    "paramount pictures": "studio/logos/paramount%20pictures.png",
    "paramount": "studio/logos/paramount%20pictures.png",
    "paramount television": "studio/logos/paramount%20television%20studios.png",
    "20th century studios": "studio/logos/20th%20century%20studios.png",
    "20th century fox": "studio/logos/20th%20century%20studios.png",
    "twentieth century fox": "studio/logos/20th%20century%20studios.png",
    "20th television": "studio/logos/20th%20television.png",
    # Disney/ABC
    "walt disney pictures": "studio/logos/walt%20disney%20pictures.png",
    "disney": "studio/logos/walt%20disney%20pictures.png",
    "walt disney animation": "studio/logos/walt%20disney%20animation%20studios.png",
    "walt disney animation studios": "studio/logos/walt%20disney%20animation%20studios.png",
    "disney television animation": "studio/logos/disney%20television%20animation.png",
    "pixar": "studio/logos/pixar.png",
    "pixar animation studios": "studio/logos/pixar.png",
    "dreamworks": "studio/logos/dreamworks%20animation.png",
    "dreamworks animation": "studio/logos/dreamworks%20animation.png",
    "dreamworks pictures": "studio/logos/dreamworks%20pictures.png",
    "touchstone pictures": "studio/logos/touchstone%20pictures.png",
    "touchstone": "studio/logos/touchstone%20pictures.png",
    "abc studios": "studio/logos/abc%20studios.png",
    "abc signature": "studio/logos/abc%20signature.png",
    # Warner/DC
    "marvel studios": "studio/logos/Marvel%20Studios.png",
    "marvel": "studio/logos/Marvel%20Studios.png",
    "marvel entertainment": "studio/logos/Marvel%20Entertainment.png",
    "marvel television": "studio/logos/Marvel%20Television.png",
    "dc studios": "studio/logos/dc%20studios.png",
    "dc films": "studio/logos/dc%20studios.png",
    "dc entertainment": "studio/logos/dc%20entertainment.png",
    "dc": "studio/logos/dc%20studios.png",
    # Lucasfilm/George Lucas
    "lucasfilm": "studio/logos/lucasfilm.png",
    "lucasfilm ltd.": "studio/logos/lucasfilm.png",
    "lucasfilm animation": "studio/logos/lucasfilm%20animation.png",
    "industrial light & magic": "studio/logos/industrial%20light%20%26%20magic.png",
    "ilm": "studio/logos/industrial%20light%20%26%20magic.png",
    # Independent/Mini-Majors
    "lionsgate": "studio/logos/lionsgate.png",
    "lionsgate films": "studio/logos/lionsgate.png",
    "lionsgate television": "studio/logos/lionsgate%20television.png",
    "mgm": "studio/logos/mgm.png",
    "metro-goldwyn-mayer": "studio/logos/mgm.png",
    "mgm television": "studio/logos/mgm%20television.png",
    "columbia pictures": "studio/logos/columbia%20pictures.png",
    "columbia": "studio/logos/columbia%20pictures.png",
    "tristar pictures": "studio/logos/tristar%20pictures.png",
    "tristar": "studio/logos/tristar%20pictures.png",
    "new line cinema": "studio/logos/new%20line%20cinema.png",
    "new line": "studio/logos/new%20line%20cinema.png",
    "miramax": "studio/logos/Miramax.png",
    "focus features": "studio/logos/focus%20features.png",
    "focus": "studio/logos/focus%20features.png",
    "searchlight pictures": "studio/logos/searchlight%20pictures.png",
    "fox searchlight": "studio/logos/searchlight%20pictures.png",
    "searchlight": "studio/logos/searchlight%20pictures.png",
    # Art House/Independent
    "a24": "studio/logos/A24.png",
    "neon": "studio/logos/neon.png",
    "annapurna pictures": "studio/logos/annapurna%20pictures.png",
    "annapurna": "studio/logos/annapurna%20pictures.png",
    "amazon studios": "studio/logos/amazon%20studios.png",
    "apple studios": "studio/logos/apple%20studios.png",
    "apple tv+": "studio/logos/apple%20studios.png",
    "netflix": "studio/logos/Netflix.png",
    # Horror/Genre
    "blumhouse": "studio/logos/blumhouse.png",
    "blumhouse productions": "studio/logos/blumhouse.png",
    "blumhouse television": "studio/logos/blumhouse%20television.png",
    "platinum dunes": "studio/logos/platinum%20dunes.png",
    "atomic monster": "studio/logos/atomic%20monster.png",
    # Animation Studios
    "illumination": "studio/logos/illumination.png",
    "illumination entertainment": "studio/logos/illumination.png",
    "blue sky studios": "studio/logos/blue%20sky%20studios.png",
    "blue sky": "studio/logos/blue%20sky%20studios.png",
    "laika": "studio/logos/laika.png",
    "sony pictures animation": "studio/logos/sony%20pictures%20animation.png",
    "nickelodeon animation": "studio/logos/nickelodeon%20animation%20studio.png",
    "cartoon network studios": "studio/logos/cartoon%20network%20studios.png",
    "rooster teeth": "studio/logos/rooster%20teeth.png",
    # International
    "studio ghibli": "studio/logos/studio%20ghibli.png",
    "ghibli": "studio/logos/studio%20ghibli.png",
    "toho": "studio/logos/toho.png",
    "studio canal": "studio/logos/studiocanal.png",
    "studiocanal": "studio/logos/studiocanal.png",
    "gaumont": "studio/logos/gaumont.png",
    "pathé": "studio/logos/path%C3%A9.png",
    "pathe": "studio/logos/path%C3%A9.png",
    "eone": "studio/logos/eone.png",
    "entertainment one": "studio/logos/eone.png",
    "bbc studios": "studio/logos/bbc%20studios.png",
    "bbc films": "studio/logos/bbc%20film.png",
    "itv studios": "studio/logos/itv%20studios.png",
    "working title": "studio/logos/working%20title%20films.png",
    "working title films": "studio/logos/working%20title%20films.png",
    # TV Production Companies
    "bad robot": "studio/logos/bad%20robot.png",
    "bad robot productions": "studio/logos/bad%20robot.png",
    "amblin entertainment": "studio/logos/amblin%20entertainment.png",
    "amblin": "studio/logos/amblin%20entertainment.png",
    "amblin television": "studio/logos/amblin%20television.png",
    "skydance": "studio/logos/skydance.png",
    "skydance media": "studio/logos/skydance.png",
    "village roadshow": "studio/logos/village%20roadshow%20pictures.png",
    "village roadshow pictures": "studio/logos/village%20roadshow%20pictures.png",
    "imagine entertainment": "studio/logos/imagine%20entertainment.png",
    "imagine": "studio/logos/imagine%20entertainment.png",
    "regency enterprises": "studio/logos/regency%20enterprises.png",
    "regency": "studio/logos/regency%20enterprises.png",
    "hbo films": "studio/logos/hbo%20films.png",
    "hbo max": "studio/logos/hbo%20max.png",
    "showtime": "studio/logos/showtime.png",
}

RESOLUTION_ASSETS = {
    # Resolution overlays from Default-Images: resolution/overlays/standard/
    "4k": "resolution/overlays/standard/4K.png",
    "4K": "resolution/overlays/standard/4K.png",
    "1080p": "resolution/overlays/standard/1080p.png",
    "1080": "resolution/overlays/standard/1080p.png",
    "720p": "resolution/overlays/standard/720p.png",
    "720": "resolution/overlays/standard/720p.png",
    "576p": "resolution/overlays/standard/576p.png",
    "480p": "resolution/overlays/standard/480p.png",
    "480": "resolution/overlays/standard/480p.png",
    "sd": "resolution/overlays/standard/sd.png",
}

# Audio codec, HDR, ribbon, and ratings overlays are dynamically generated by Kometa
# They don't exist as PNG files in the Default-Images repository
# These mappings are disabled - instant compositor will use text-based generation
AUDIO_CODEC_ASSETS = {
    # Disabled: Audio codec overlays are dynamically generated
}

HDR_ASSETS = {
    # Disabled: HDR overlays are dynamically generated
}

RIBBON_ASSETS = {
    # Disabled: Ribbon overlays are dynamically generated
}

# Ratings assets have multiple source options
RATINGS_ASSETS = {
    # Disabled: Ratings overlays are dynamically generated
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


def get_metadata_path() -> Path:
    """Get path to cache metadata file."""
    return ensure_cache_dir() / CACHE_METADATA_FILE


def load_cache_metadata() -> Dict[str, Any]:
    """Load cache metadata from disk."""
    metadata_path = get_metadata_path()
    if metadata_path.exists():
        try:
            return json.loads(metadata_path.read_text())
        except Exception:
            pass
    return {"version": ASSET_VERSION, "created_at": time.time(), "assets": {}}


def save_cache_metadata(metadata: Dict[str, Any]) -> None:
    """Save cache metadata to disk."""
    try:
        metadata_path = get_metadata_path()
        metadata_path.write_text(json.dumps(metadata, indent=2))
    except Exception as e:
        print(f"Warning: Failed to save cache metadata: {e}")


def is_cache_valid() -> bool:
    """
    Check if cache is valid based on version and TTL.

    Returns False if:
    - ASSET_VERSION has changed (force refresh)
    - Cache is older than ASSET_CACHE_TTL_DAYS
    """
    metadata = load_cache_metadata()

    # Version mismatch - invalidate cache
    if metadata.get("version") != ASSET_VERSION:
        print(f"Cache version mismatch (cached: {metadata.get('version')}, current: {ASSET_VERSION})")
        return False

    # Check TTL
    created_at = metadata.get("created_at", 0)
    age_days = (time.time() - created_at) / (24 * 3600)
    if age_days > ASSET_CACHE_TTL_DAYS:
        print(f"Cache expired (age: {age_days:.1f} days, TTL: {ASSET_CACHE_TTL_DAYS} days)")
        return False

    return True


def clear_cache(clear_memory: bool = True, clear_disk: bool = True) -> int:
    """
    Clear the asset cache.

    Args:
        clear_memory: Clear in-memory cache
        clear_disk: Clear disk cache (PNG files)

    Returns:
        Number of assets cleared from disk
    """
    global _asset_cache

    cleared_count = 0

    if clear_memory:
        _asset_cache = {}
        print("Cleared in-memory asset cache")

    if clear_disk:
        cache_dir = ensure_cache_dir()
        for file_path in cache_dir.glob("*.png"):
            try:
                file_path.unlink()
                cleared_count += 1
            except Exception as e:
                print(f"Warning: Failed to delete {file_path}: {e}")

        # Remove metadata file
        metadata_path = get_metadata_path()
        if metadata_path.exists():
            try:
                metadata_path.unlink()
            except Exception:
                pass

        print(f"Cleared {cleared_count} cached assets from disk")

    return cleared_count


def refresh_cache_if_needed() -> bool:
    """
    Check cache validity and clear if stale.

    Returns True if cache was refreshed (cleared), False if cache is still valid.
    """
    if not is_cache_valid():
        clear_cache()
        # Initialize fresh metadata
        save_cache_metadata({
            "version": ASSET_VERSION,
            "created_at": time.time(),
            "assets": {}
        })
        return True
    return False


def get_cache_stats() -> Dict[str, Any]:
    """Get statistics about the current cache state."""
    cache_dir = ensure_cache_dir()
    metadata = load_cache_metadata()

    disk_files = list(cache_dir.glob("*.png"))
    total_size = sum(f.stat().st_size for f in disk_files)

    created_at = metadata.get("created_at", 0)
    age_days = (time.time() - created_at) / (24 * 3600) if created_at else 0

    return {
        "version": metadata.get("version", "unknown"),
        "memory_cached": len(_asset_cache),
        "disk_cached": len(disk_files),
        "total_size_mb": total_size / (1024 * 1024),
        "age_days": round(age_days, 2),
        "ttl_days": ASSET_CACHE_TTL_DAYS,
        "cache_dir": str(cache_dir),
    }


def download_asset(asset_path: str, use_cdn: bool = True) -> Optional[bytes]:
    """
    Download an asset from Kometa's Default-Images repository.

    Args:
        asset_path: Path within the repository (e.g., "streaming/logos/netflix.png")
        use_cdn: Use CDN (jsDelivr) instead of raw GitHub

    Returns:
        PNG image data as bytes, or None if download failed
    """
    # Check in-memory cache first
    if asset_path in _asset_cache:
        return _asset_cache[asset_path]

    # URL-decode the path for filesystem lookups (files use real spaces/plus signs, not %20/%2B)
    decoded_path = unquote(asset_path)

    # Check bundled assets directory (shipped with Docker image at /app/assets)
    assets_dir = Path("/app/assets")
    if assets_dir.exists():
        asset_file = assets_dir / decoded_path
        if asset_file.exists():
            try:
                data = asset_file.read_bytes()
                _asset_cache[asset_path] = data
                return data
            except Exception as e:
                print(f"Warning: Failed to read asset {asset_file}: {e}")

    # Check local disk cache (only if cache is valid)
    cache_path = get_cache_path(asset_path)
    if cache_path.exists() and is_cache_valid():
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
                # Update metadata with download timestamp
                metadata = load_cache_metadata()
                metadata["assets"][asset_path] = {
                    "downloaded_at": time.time(),
                    "size": len(data)
                }
                save_cache_metadata(metadata)
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


def preload_common_assets(force_refresh: bool = False):
    """
    Pre-download commonly used assets for faster rendering.

    Args:
        force_refresh: If True, clear cache before preloading

    Returns:
        Number of assets loaded
    """
    # Check if cache needs refresh
    if force_refresh:
        print("Force refresh requested, clearing cache...")
        clear_cache()
    else:
        # Check and refresh if stale
        if refresh_cache_if_needed():
            print("Cache was stale, refreshed")

    common_assets = [
        # Resolution (uses correct paths and proper capitalization)
        "resolution/overlays/standard/4K.png",
        "resolution/overlays/standard/1080p.png",
        "resolution/overlays/standard/720p.png",
        # Audio, HDR, Ribbons, and Ratings are dynamically generated - no PNG assets
        # Common streaming (URL-encoded for CDN, decoded for local filesystem)
        "streaming/logos/Netflix.png",
        "streaming/logos/Max.png",
        "streaming/logos/Disney%2B.png",
        "streaming/logos/Prime%20Video.png",
        "streaming/logos/Apple%20TV%2B.png",
        # Common networks (URL-encoded for CDN, decoded for local filesystem)
        "network/logos/AMC.png",
        "network/logos/HBO.png",
        "network/logos/FX.png",
        "network/logos/Netflix.png",
        # Common studios (URL-encoded for CDN, decoded for local filesystem)
        "studio/logos/A24.png",
        "studio/logos/Marvel%20Studios.png",
        "studio/logos/Netflix.png",
        "studio/logos/Sony%20Pictures.png",
    ]

    loaded = 0
    for asset_path in common_assets:
        if download_asset(asset_path):
            loaded += 1

    stats = get_cache_stats()
    print(f"Pre-loaded {loaded}/{len(common_assets)} common overlay assets")
    print(f"Cache stats: {stats['disk_cached']} files, {stats['total_size_mb']:.2f} MB")
    return loaded
