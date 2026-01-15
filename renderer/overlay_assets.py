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
    # Service name -> path in Default-Images repo
    # Major US Services
    "netflix": "streaming/streaming/netflix.png",
    "max": "streaming/streaming/max.png",
    "hbo_max": "streaming/streaming/max.png",  # Alias
    "hbo": "streaming/streaming/max.png",  # Alias
    "prime": "streaming/streaming/amazon%20prime%20video.png",
    "amazon": "streaming/streaming/amazon%20prime%20video.png",
    "amazon_prime": "streaming/streaming/amazon%20prime%20video.png",
    "amazon_prime_video": "streaming/streaming/amazon%20prime%20video.png",
    "disney": "streaming/streaming/disney%2B.png",
    "disney+": "streaming/streaming/disney%2B.png",
    "disneyplus": "streaming/streaming/disney%2B.png",
    "hulu": "streaming/streaming/hulu.png",
    "appletv": "streaming/streaming/apple%20tv%2B.png",
    "apple_tv": "streaming/streaming/apple%20tv%2B.png",
    "apple_tv+": "streaming/streaming/apple%20tv%2B.png",
    "apple": "streaming/streaming/apple%20tv%2B.png",
    "peacock": "streaming/streaming/peacock.png",
    "paramount": "streaming/streaming/paramount%2B.png",
    "paramount+": "streaming/streaming/paramount%2B.png",
    "paramountplus": "streaming/streaming/paramount%2B.png",
    # Premium Cable Streaming
    "amc_plus": "streaming/streaming/amc%2B.png",
    "amc+": "streaming/streaming/amc%2B.png",
    "showtime": "streaming/streaming/showtime.png",
    "starz": "streaming/streaming/starz.png",
    "mgm+": "streaming/streaming/mgm%2B.png",
    "mgm_plus": "streaming/streaming/mgm%2B.png",
    # Discovery/Reality
    "discovery": "streaming/streaming/discovery%2B.png",
    "discovery+": "streaming/streaming/discovery%2B.png",
    "discoveryplus": "streaming/streaming/discovery%2B.png",
    # Sports
    "espn+": "streaming/streaming/espn%2B.png",
    "espn_plus": "streaming/streaming/espn%2B.png",
    "espn": "streaming/streaming/espn%2B.png",
    "dazn": "streaming/streaming/dazn.png",
    # Anime/Asian
    "crunchyroll": "streaming/streaming/crunchyroll.png",
    "funimation": "streaming/streaming/funimation.png",
    "hidive": "streaming/streaming/hidive.png",
    "viki": "streaming/streaming/viki.png",
    # Free Ad-Supported
    "tubi": "streaming/streaming/tubi.png",
    "pluto": "streaming/streaming/pluto%20tv.png",
    "pluto_tv": "streaming/streaming/pluto%20tv.png",
    "freevee": "streaming/streaming/amazon%20freevee.png",
    "amazon_freevee": "streaming/streaming/amazon%20freevee.png",
    "roku": "streaming/streaming/the%20roku%20channel.png",
    "roku_channel": "streaming/streaming/the%20roku%20channel.png",
    "vudu": "streaming/streaming/vudu.png",
    # Independent/Art House
    "mubi": "streaming/streaming/mubi.png",
    "criterion": "streaming/streaming/the%20criterion%20channel.png",
    "criterion_channel": "streaming/streaming/the%20criterion%20channel.png",
    "shudder": "streaming/streaming/shudder.png",
    "sundance": "streaming/streaming/sundance%20now.png",
    "sundance_now": "streaming/streaming/sundance%20now.png",
    "kanopy": "streaming/streaming/kanopy.png",
    # UK/European
    "britbox": "streaming/streaming/britbox.png",
    "now": "streaming/streaming/now.png",
    "nowtv": "streaming/streaming/now.png",
    "sky": "streaming/streaming/sky%20go.png",
    "sky_go": "streaming/streaming/sky%20go.png",
    "stan": "streaming/streaming/stan.png",
    "hayu": "streaming/streaming/hayu.png",
    "iplayer": "streaming/streaming/bbc%20iplayer.png",
    "bbc_iplayer": "streaming/streaming/bbc%20iplayer.png",
    "all4": "streaming/streaming/all%204.png",
    "all_4": "streaming/streaming/all%204.png",
    "itvx": "streaming/streaming/itvx.png",
    # Canadian
    "crave": "streaming/streaming/crave.png",
    "cbc_gem": "streaming/streaming/cbc%20gem.png",
    # Other
    "bet+": "streaming/streaming/bet%2B.png",
    "bet_plus": "streaming/streaming/bet%2B.png",
    "curiosity": "streaming/streaming/curiositystream.png",
    "curiositystream": "streaming/streaming/curiositystream.png",
    "acorn": "streaming/streaming/acorn%20tv.png",
    "acorn_tv": "streaming/streaming/acorn%20tv.png",
}

NETWORK_ASSETS = {
    # Network name -> path in Default-Images repo
    # Major Broadcast Networks
    "abc": "network/network/abc.png",
    "nbc": "network/network/nbc.png",
    "cbs": "network/network/cbs.png",
    "fox": "network/network/fox.png",
    "the_cw": "network/network/the%20cw.png",
    "cw": "network/network/the%20cw.png",
    "pbs": "network/network/pbs.png",
    # Premium Cable
    "hbo": "network/network/hbo.png",
    "showtime": "network/network/showtime.png",
    "starz": "network/network/starz.png",
    "cinemax": "network/network/cinemax.png",
    "epix": "network/network/epix.png",
    # Basic Cable - Entertainment
    "amc": "network/network/amc.png",
    "fx": "network/network/fx.png",
    "fxx": "network/network/fxx.png",
    "usa": "network/network/usa%20network.png",
    "usa_network": "network/network/usa%20network.png",
    "tnt": "network/network/tnt.png",
    "tbs": "network/network/tbs.png",
    "syfy": "network/network/syfy.png",
    "bravo": "network/network/bravo.png",
    "e!": "network/network/e%21.png",
    "e_entertainment": "network/network/e%21.png",
    "lifetime": "network/network/lifetime.png",
    "hallmark": "network/network/hallmark%20channel.png",
    "hallmark_channel": "network/network/hallmark%20channel.png",
    "oxygen": "network/network/oxygen.png",
    "wetv": "network/network/wetv.png",
    "bet": "network/network/bet.png",
    "vh1": "network/network/vh1.png",
    "mtv": "network/network/mtv.png",
    "tvland": "network/network/tv%20land.png",
    "tv_land": "network/network/tv%20land.png",
    "paramount_network": "network/network/paramount%20network.png",
    # Comedy/Animation
    "comedy_central": "network/network/comedy%20central.png",
    "adult_swim": "network/network/adult%20swim.png",
    "cartoon_network": "network/network/cartoon%20network.png",
    "nickelodeon": "network/network/nickelodeon.png",
    "nick": "network/network/nickelodeon.png",
    "disney_channel": "network/network/disney%20channel.png",
    "disney_xd": "network/network/disney%20xd.png",
    "freeform": "network/network/freeform.png",
    # Documentary/Educational
    "discovery": "network/network/discovery.png",
    "history": "network/network/history.png",
    "natgeo": "network/network/national%20geographic.png",
    "national_geographic": "network/network/national%20geographic.png",
    "nat_geo": "network/network/national%20geographic.png",
    "a&e": "network/network/a%26e.png",
    "ae": "network/network/a%26e.png",
    "tlc": "network/network/tlc.png",
    "animal_planet": "network/network/animal%20planet.png",
    "science_channel": "network/network/science%20channel.png",
    "food_network": "network/network/food%20network.png",
    "hgtv": "network/network/hgtv.png",
    "travel_channel": "network/network/travel%20channel.png",
    "investigation_discovery": "network/network/investigation%20discovery.png",
    "id": "network/network/investigation%20discovery.png",
    # News
    "cnn": "network/network/cnn.png",
    "msnbc": "network/network/msnbc.png",
    "fox_news": "network/network/fox%20news.png",
    # Sports
    "espn": "network/network/espn.png",
    "espn2": "network/network/espn2.png",
    "fs1": "network/network/fox%20sports%201.png",
    "fox_sports": "network/network/fox%20sports%201.png",
    "nfl_network": "network/network/nfl%20network.png",
    "nba_tv": "network/network/nba%20tv.png",
    "mlb_network": "network/network/mlb%20network.png",
    # Streaming Networks (when used as production source)
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
    "max": "network/network/max.png",
    # UK Networks
    "bbc_one": "network/network/bbc%20one.png",
    "bbc_two": "network/network/bbc%20two.png",
    "bbc_three": "network/network/bbc%20three.png",
    "bbc_four": "network/network/bbc%20four.png",
    "bbc": "network/network/bbc%20one.png",
    "itv": "network/network/itv.png",
    "itv2": "network/network/itv2.png",
    "channel_4": "network/network/channel%204.png",
    "channel4": "network/network/channel%204.png",
    "channel_5": "network/network/channel%205.png",
    "sky_one": "network/network/sky%20one.png",
    "sky_atlantic": "network/network/sky%20atlantic.png",
    "sky": "network/network/sky%20one.png",
    # Canadian Networks
    "cbc": "network/network/cbc.png",
    "ctv": "network/network/ctv.png",
    "global": "network/network/global.png",
    "citytv": "network/network/citytv.png",
    "showcase": "network/network/showcase.png",
    # Australian Networks
    "abc_au": "network/network/abc%20%28au%29.png",
    "nine": "network/network/nine%20network.png",
    "nine_network": "network/network/nine%20network.png",
    "seven": "network/network/seven%20network.png",
    "seven_network": "network/network/seven%20network.png",
    "ten": "network/network/network%2010.png",
    "network_10": "network/network/network%2010.png",
    "sbs": "network/network/sbs.png",
    "foxtel": "network/network/foxtel.png",
}

STUDIO_ASSETS = {
    # Studio name (lowercase) -> path in Default-Images repo
    # Major Hollywood Studios
    "warner bros. pictures": "studio/studio/warner%20bros.%20pictures.png",
    "warner bros.": "studio/studio/warner%20bros.%20pictures.png",
    "warner bros": "studio/studio/warner%20bros.%20pictures.png",
    "warner": "studio/studio/warner%20bros.%20pictures.png",
    "warner bros. television": "studio/studio/warner%20bros.%20television.png",
    "legendary pictures": "studio/studio/legendary%20pictures.png",
    "legendary": "studio/studio/legendary%20pictures.png",
    "sony pictures": "studio/studio/sony%20pictures.png",
    "sony pictures television": "studio/studio/sony%20pictures%20television.png",
    "sony": "studio/studio/sony%20pictures.png",
    "universal pictures": "studio/studio/universal%20pictures.png",
    "universal studios": "studio/studio/universal%20pictures.png",
    "universal": "studio/studio/universal%20pictures.png",
    "universal television": "studio/studio/universal%20television.png",
    "paramount pictures": "studio/studio/paramount%20pictures.png",
    "paramount": "studio/studio/paramount%20pictures.png",
    "paramount television": "studio/studio/paramount%20television%20studios.png",
    "20th century studios": "studio/studio/20th%20century%20studios.png",
    "20th century fox": "studio/studio/20th%20century%20studios.png",
    "twentieth century fox": "studio/studio/20th%20century%20studios.png",
    "20th television": "studio/studio/20th%20television.png",
    # Disney/ABC
    "walt disney pictures": "studio/studio/walt%20disney%20pictures.png",
    "disney": "studio/studio/walt%20disney%20pictures.png",
    "walt disney animation": "studio/studio/walt%20disney%20animation%20studios.png",
    "walt disney animation studios": "studio/studio/walt%20disney%20animation%20studios.png",
    "disney television animation": "studio/studio/disney%20television%20animation.png",
    "pixar": "studio/studio/pixar.png",
    "pixar animation studios": "studio/studio/pixar.png",
    "dreamworks": "studio/studio/dreamworks%20animation.png",
    "dreamworks animation": "studio/studio/dreamworks%20animation.png",
    "dreamworks pictures": "studio/studio/dreamworks%20pictures.png",
    "touchstone pictures": "studio/studio/touchstone%20pictures.png",
    "touchstone": "studio/studio/touchstone%20pictures.png",
    "abc studios": "studio/studio/abc%20studios.png",
    "abc signature": "studio/studio/abc%20signature.png",
    # Warner/DC
    "marvel studios": "studio/studio/marvel%20studios.png",
    "marvel": "studio/studio/marvel%20studios.png",
    "marvel entertainment": "studio/studio/marvel%20entertainment.png",
    "marvel television": "studio/studio/marvel%20television.png",
    "dc studios": "studio/studio/dc%20studios.png",
    "dc films": "studio/studio/dc%20studios.png",
    "dc entertainment": "studio/studio/dc%20entertainment.png",
    "dc": "studio/studio/dc%20studios.png",
    # Lucasfilm/George Lucas
    "lucasfilm": "studio/studio/lucasfilm.png",
    "lucasfilm ltd.": "studio/studio/lucasfilm.png",
    "lucasfilm animation": "studio/studio/lucasfilm%20animation.png",
    "industrial light & magic": "studio/studio/industrial%20light%20%26%20magic.png",
    "ilm": "studio/studio/industrial%20light%20%26%20magic.png",
    # Independent/Mini-Majors
    "lionsgate": "studio/studio/lionsgate.png",
    "lionsgate films": "studio/studio/lionsgate.png",
    "lionsgate television": "studio/studio/lionsgate%20television.png",
    "mgm": "studio/studio/mgm.png",
    "metro-goldwyn-mayer": "studio/studio/mgm.png",
    "mgm television": "studio/studio/mgm%20television.png",
    "columbia pictures": "studio/studio/columbia%20pictures.png",
    "columbia": "studio/studio/columbia%20pictures.png",
    "tristar pictures": "studio/studio/tristar%20pictures.png",
    "tristar": "studio/studio/tristar%20pictures.png",
    "new line cinema": "studio/studio/new%20line%20cinema.png",
    "new line": "studio/studio/new%20line%20cinema.png",
    "miramax": "studio/studio/miramax.png",
    "focus features": "studio/studio/focus%20features.png",
    "focus": "studio/studio/focus%20features.png",
    "searchlight pictures": "studio/studio/searchlight%20pictures.png",
    "fox searchlight": "studio/studio/searchlight%20pictures.png",
    "searchlight": "studio/studio/searchlight%20pictures.png",
    # Art House/Independent
    "a24": "studio/studio/a24.png",
    "neon": "studio/studio/neon.png",
    "annapurna pictures": "studio/studio/annapurna%20pictures.png",
    "annapurna": "studio/studio/annapurna%20pictures.png",
    "amazon studios": "studio/studio/amazon%20studios.png",
    "apple studios": "studio/studio/apple%20studios.png",
    "apple tv+": "studio/studio/apple%20studios.png",
    "netflix": "studio/studio/netflix.png",
    # Horror/Genre
    "blumhouse": "studio/studio/blumhouse.png",
    "blumhouse productions": "studio/studio/blumhouse.png",
    "blumhouse television": "studio/studio/blumhouse%20television.png",
    "platinum dunes": "studio/studio/platinum%20dunes.png",
    "atomic monster": "studio/studio/atomic%20monster.png",
    # Animation Studios
    "illumination": "studio/studio/illumination.png",
    "illumination entertainment": "studio/studio/illumination.png",
    "blue sky studios": "studio/studio/blue%20sky%20studios.png",
    "blue sky": "studio/studio/blue%20sky%20studios.png",
    "laika": "studio/studio/laika.png",
    "sony pictures animation": "studio/studio/sony%20pictures%20animation.png",
    "nickelodeon animation": "studio/studio/nickelodeon%20animation%20studio.png",
    "cartoon network studios": "studio/studio/cartoon%20network%20studios.png",
    "rooster teeth": "studio/studio/rooster%20teeth.png",
    # International
    "studio ghibli": "studio/studio/studio%20ghibli.png",
    "ghibli": "studio/studio/studio%20ghibli.png",
    "toho": "studio/studio/toho.png",
    "studio canal": "studio/studio/studiocanal.png",
    "studiocanal": "studio/studio/studiocanal.png",
    "gaumont": "studio/studio/gaumont.png",
    "pathé": "studio/studio/path%C3%A9.png",
    "pathe": "studio/studio/path%C3%A9.png",
    "eone": "studio/studio/eone.png",
    "entertainment one": "studio/studio/eone.png",
    "bbc studios": "studio/studio/bbc%20studios.png",
    "bbc films": "studio/studio/bbc%20film.png",
    "itv studios": "studio/studio/itv%20studios.png",
    "working title": "studio/studio/working%20title%20films.png",
    "working title films": "studio/studio/working%20title%20films.png",
    # TV Production Companies
    "bad robot": "studio/studio/bad%20robot.png",
    "bad robot productions": "studio/studio/bad%20robot.png",
    "amblin entertainment": "studio/studio/amblin%20entertainment.png",
    "amblin": "studio/studio/amblin%20entertainment.png",
    "amblin television": "studio/studio/amblin%20television.png",
    "skydance": "studio/studio/skydance.png",
    "skydance media": "studio/studio/skydance.png",
    "village roadshow": "studio/studio/village%20roadshow%20pictures.png",
    "village roadshow pictures": "studio/studio/village%20roadshow%20pictures.png",
    "imagine entertainment": "studio/studio/imagine%20entertainment.png",
    "imagine": "studio/studio/imagine%20entertainment.png",
    "regency enterprises": "studio/studio/regency%20enterprises.png",
    "regency": "studio/studio/regency%20enterprises.png",
    "hbo films": "studio/studio/hbo%20films.png",
    "hbo max": "studio/studio/hbo%20max.png",
    "showtime": "studio/studio/showtime.png",
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
        asset_path: Path within the repository (e.g., "streaming/streaming/netflix.png")
        use_cdn: Use CDN (jsDelivr) instead of raw GitHub

    Returns:
        PNG image data as bytes, or None if download failed
    """
    # Check in-memory cache first
    if asset_path in _asset_cache:
        return _asset_cache[asset_path]

    # Check local overlay-assets directory first (pre-downloaded assets)
    local_assets_dir = Path("/overlay-assets")
    if local_assets_dir.exists():
        local_asset_path = local_assets_dir / asset_path
        if local_asset_path.exists():
            try:
                data = local_asset_path.read_bytes()
                _asset_cache[asset_path] = data
                return data
            except Exception as e:
                print(f"Warning: Failed to read local asset {local_asset_path}: {e}")

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
        # Resolution
        "resolution/resolution/4k.png",
        "resolution/resolution/1080p.png",
        "resolution/resolution/720p.png",
        "resolution/resolution/hdr.png",
        "resolution/resolution/dolby%20vision.png",
        # Audio
        "audio_codec/audio_codec/dolby%20atmos.png",
        "audio_codec/audio_codec/dts-hd%20ma.png",
        "audio_codec/audio_codec/truehd.png",
        # Ribbons
        "ribbon/ribbon/imdb%20top%20250.png",
        "ribbon/ribbon/rotten%20tomatoes%20certified%20fresh.png",
        # Common streaming
        "streaming/streaming/netflix.png",
        "streaming/streaming/max.png",
        "streaming/streaming/disney%2B.png",
        "streaming/streaming/amazon%20prime%20video.png",
        "streaming/streaming/apple%20tv%2B.png",
        # Common networks
        "network/network/amc.png",
        "network/network/hbo.png",
        "network/network/fx.png",
        "network/network/netflix.png",
        # Common studios
        "studio/studio/a24.png",
        "studio/studio/marvel%20studios.png",
        "studio/studio/netflix.png",
        # Ratings sources
        "ratings/ratings/imdb.png",
        "ratings/ratings/tmdb.png",
    ]

    loaded = 0
    for asset_path in common_assets:
        if download_asset(asset_path):
            loaded += 1

    stats = get_cache_stats()
    print(f"Pre-loaded {loaded}/{len(common_assets)} common overlay assets")
    print(f"Cache stats: {stats['disk_cached']} files, {stats['total_size_mb']:.2f} MB")
    return loaded
