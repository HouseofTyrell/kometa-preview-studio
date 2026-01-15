#!/bin/bash
#
# Downloads Kometa overlay assets with correct filenames and structure
# Assets are stored in assets/ directory and committed to the repository
#

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS_DIR="$REPO_ROOT/assets"
BASE_URL="https://raw.githubusercontent.com/Kometa-Team/Default-Images/master"

echo "Downloading Kometa overlay assets..."
echo "Target: $ASSETS_DIR"
echo ""

# Create directory structure
mkdir -p "$ASSETS_DIR/resolution/overlays/standard"
mkdir -p "$ASSETS_DIR/streaming/logos"
mkdir -p "$ASSETS_DIR/network/logos"
mkdir -p "$ASSETS_DIR/studio/logos"

# Function to download a file
download() {
    local url="$1"
    local output="$2"

    if [ -f "$output" ]; then
        echo "  ✓ $(basename "$output") (already exists)"
        return 0
    fi

    echo "  Downloading $(basename "$output")..."
    if curl -f -s -L -o "$output" "$url" 2>/dev/null; then
        echo "  ✓ $(basename "$output")"
    else
        echo "  ✗ $(basename "$output") (404 or error)"
        rm -f "$output"
        return 1
    fi
}

# Resolution overlays
echo "Resolution overlays:"
download "$BASE_URL/resolution/overlays/standard/4K.png" "$ASSETS_DIR/resolution/overlays/standard/4K.png"
download "$BASE_URL/resolution/overlays/standard/1080p.png" "$ASSETS_DIR/resolution/overlays/standard/1080p.png"
download "$BASE_URL/resolution/overlays/standard/720p.png" "$ASSETS_DIR/resolution/overlays/standard/720p.png"
download "$BASE_URL/resolution/overlays/standard/480p.png" "$ASSETS_DIR/resolution/overlays/standard/480p.png"
echo ""

# Streaming logos (common ones from your config)
echo "Streaming logos:"
download "$BASE_URL/streaming/logos/Netflix.png" "$ASSETS_DIR/streaming/logos/Netflix.png"
download "$BASE_URL/streaming/logos/Max.png" "$ASSETS_DIR/streaming/logos/Max.png"
download "$BASE_URL/streaming/logos/Disney%2B.png" "$ASSETS_DIR/streaming/logos/Disney+.png"
download "$BASE_URL/streaming/logos/Prime%20Video.png" "$ASSETS_DIR/streaming/logos/Prime Video.png"
download "$BASE_URL/streaming/logos/Apple%20TV%2B.png" "$ASSETS_DIR/streaming/logos/Apple TV+.png"
download "$BASE_URL/streaming/logos/AMC%2B.png" "$ASSETS_DIR/streaming/logos/AMC+.png"
echo ""

# Network logos (common ones from your config)
echo "Network logos:"
download "$BASE_URL/network/logos/AMC.png" "$ASSETS_DIR/network/logos/AMC.png"
download "$BASE_URL/network/logos/HBO.png" "$ASSETS_DIR/network/logos/HBO.png"
download "$BASE_URL/network/logos/FX.png" "$ASSETS_DIR/network/logos/FX.png"
download "$BASE_URL/network/logos/Netflix.png" "$ASSETS_DIR/network/logos/Netflix.png"
echo ""

# Studio logos (common ones from your config)
echo "Studio logos:"
download "$BASE_URL/studio/logos/Warner%20Bros.%20Pictures.png" "$ASSETS_DIR/studio/logos/Warner Bros. Pictures.png"
download "$BASE_URL/studio/logos/Legendary%20Pictures.png" "$ASSETS_DIR/studio/logos/Legendary Pictures.png"
download "$BASE_URL/studio/logos/Sony%20Pictures%20Television.png" "$ASSETS_DIR/studio/logos/Sony Pictures Television.png"
download "$BASE_URL/studio/logos/Marvel%20Studios.png" "$ASSETS_DIR/studio/logos/Marvel Studios.png"
download "$BASE_URL/studio/logos/A24.png" "$ASSETS_DIR/studio/logos/A24.png"
download "$BASE_URL/studio/logos/Netflix.png" "$ASSETS_DIR/studio/logos/Netflix.png"
echo ""

echo "✅ Download complete!"
echo ""
echo "Assets saved to: $ASSETS_DIR"
echo "These assets are committed to the repository."
