#!/bin/bash
# Downloads Kometa overlay assets from the official Kometa repository
# These are the actual overlay images Kometa uses for rendering
# Source: https://github.com/Kometa-Team/Kometa/tree/master/defaults/overlays/images

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$REPO_ROOT/assets"
KOMETA_BRANCH="bd4ae61b2ebdf4848542dada8f367b94ffcd1b7a"
BASE_URL="https://raw.githubusercontent.com/Kometa-Team/Kometa/${KOMETA_BRANCH}/defaults/overlays/images"

echo "Downloading Kometa overlay assets from official repository..."
echo "Target: $ASSETS_DIR"
echo ""

# Function to download a file
download() {
    local url="$1"
    local output="$2"

    if [ -f "$output" ]; then
        echo "  ✓ $(basename "$output") (already exists)"
        return 0
    fi

    echo "  Downloading $(basename "$output")..."
    mkdir -p "$(dirname "$output")"
    if curl -f -s -L -o "$output" "$url" 2>/dev/null; then
        echo "  ✓ $(basename "$output")"
    else
        echo "  ✗ $(basename "$output") (404 or error)"
        rm -f "$output"
        return 1
    fi
}

# Audio codec overlays (standard)
echo "Audio Codec Overlays:"
mkdir -p "$ASSETS_DIR/audio_codec/standard"
download "$BASE_URL/audio_codec/standard/truehd.png" "$ASSETS_DIR/audio_codec/standard/truehd.png"
download "$BASE_URL/audio_codec/standard/dolby_atmos.png" "$ASSETS_DIR/audio_codec/standard/dolby_atmos.png"
download "$BASE_URL/audio_codec/standard/atmos.png" "$ASSETS_DIR/audio_codec/standard/atmos.png"
download "$BASE_URL/audio_codec/standard/dts.png" "$ASSETS_DIR/audio_codec/standard/dts.png"
download "$BASE_URL/audio_codec/standard/ma.png" "$ASSETS_DIR/audio_codec/standard/ma.png"
download "$BASE_URL/audio_codec/standard/dtsx.png" "$ASSETS_DIR/audio_codec/standard/dtsx.png"
download "$BASE_URL/audio_codec/standard/aac.png" "$ASSETS_DIR/audio_codec/standard/aac.png"
download "$BASE_URL/audio_codec/standard/flac.png" "$ASSETS_DIR/audio_codec/standard/flac.png"
echo ""

# Rating overlays
echo "Rating Overlays:"
mkdir -p "$ASSETS_DIR/rating"
download "$BASE_URL/rating/IMDb.png" "$ASSETS_DIR/rating/IMDb.png"
download "$BASE_URL/rating/TMDb.png" "$ASSETS_DIR/rating/TMDb.png"
download "$BASE_URL/rating/RT-Crit-Fresh.png" "$ASSETS_DIR/rating/RT-Crit-Fresh.png"
download "$BASE_URL/rating/RT-Crit-Rotten.png" "$ASSETS_DIR/rating/RT-Crit-Rotten.png"
download "$BASE_URL/rating/IMDbTop250.png" "$ASSETS_DIR/rating/IMDbTop250.png"
echo ""

# Ribbon overlays (yellow for IMDb Top 250)
echo "Ribbon Overlays:"
mkdir -p "$ASSETS_DIR/ribbon/yellow"
download "$BASE_URL/ribbon/yellow/imdb.png" "$ASSETS_DIR/ribbon/yellow/imdb.png"
download "$BASE_URL/ribbon/yellow/rotten.png" "$ASSETS_DIR/ribbon/yellow/rotten.png"
echo ""

# Resolution overlays (standard)
echo "Resolution Overlays:"
mkdir -p "$ASSETS_DIR/resolution/overlays/standard"
download "$BASE_URL/resolution/standard/4K.png" "$ASSETS_DIR/resolution/overlays/standard/4K.png"
download "$BASE_URL/resolution/standard/1080P.png" "$ASSETS_DIR/resolution/overlays/standard/1080p.png"
download "$BASE_URL/resolution/standard/720P.png" "$ASSETS_DIR/resolution/overlays/standard/720p.png"
download "$BASE_URL/resolution/standard/480P.png" "$ASSETS_DIR/resolution/overlays/standard/480p.png"
echo ""

# Streaming logos (from network directory in overlays)
echo "Streaming/Network Logos:"
mkdir -p "$ASSETS_DIR/streaming/logos"
download "$BASE_URL/network/Netflix.png" "$ASSETS_DIR/streaming/logos/Netflix.png"
download "$BASE_URL/network/Max.png" "$ASSETS_DIR/streaming/logos/Max.png"
download "$BASE_URL/network/Disney+.png" "$ASSETS_DIR/streaming/logos/Disney+.png"
download "$BASE_URL/network/Prime%20Video.png" "$ASSETS_DIR/streaming/logos/Prime Video.png"
download "$BASE_URL/network/Apple%20TV+.png" "$ASSETS_DIR/streaming/logos/Apple TV+.png"
download "$BASE_URL/network/AMC+.png" "$ASSETS_DIR/streaming/logos/AMC+.png"
echo ""

# Network logos
echo "Network Logos:"
mkdir -p "$ASSETS_DIR/network/logos"
download "$BASE_URL/network/AMC.png" "$ASSETS_DIR/network/logos/AMC.png"
download "$BASE_URL/network/HBO.png" "$ASSETS_DIR/network/logos/HBO.png"
download "$BASE_URL/network/FX.png" "$ASSETS_DIR/network/logos/FX.png"
download "$BASE_URL/network/Netflix.png" "$ASSETS_DIR/network/logos/Netflix.png"
echo ""

# Studio logos
echo "Studio Logos:"
mkdir -p "$ASSETS_DIR/studio/logos"
download "$BASE_URL/studio/Warner%20Bros.%20Pictures.png" "$ASSETS_DIR/studio/logos/Warner Bros. Pictures.png"
download "$BASE_URL/studio/Legendary%20Pictures.png" "$ASSETS_DIR/studio/logos/Legendary Pictures.png"
download "$BASE_URL/studio/Marvel%20Studios.png" "$ASSETS_DIR/studio/logos/Marvel Studios.png"
download "$BASE_URL/studio/Sony%20Pictures.png" "$ASSETS_DIR/studio/logos/Sony Pictures.png"
download "$BASE_URL/studio/A24.png" "$ASSETS_DIR/studio/logos/A24.png"
echo ""

echo "✅ Download complete!"
echo "Assets saved to: $ASSETS_DIR"
echo "These are the actual overlay images used by Kometa."
echo ""
echo "Total files downloaded:"
find "$ASSETS_DIR" -type f -name "*.png" | wc -l | xargs echo "PNG files:"
