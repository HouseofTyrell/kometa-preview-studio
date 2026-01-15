#!/bin/bash
#
# Downloads Kometa default overlay assets from the Default-Images repository
# This ensures the preview studio uses the exact same overlay images as production Kometa
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERR] ${NC} $1"; }
success() { echo -e "${GREEN}[OK]  ${NC} $1"; }

# Determine repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
ASSETS_DIR="$REPO_ROOT/overlay-assets"

info "Kometa Overlay Assets Downloader"
info "=================================="
info "This will download default overlay images from:"
info "https://github.com/Kometa-Team/Default-Images"
info ""
info "Target directory: $ASSETS_DIR"
info ""

# Create assets directory
mkdir -p "$ASSETS_DIR"

# Base URL for Default-Images repository
BASE_URL="https://raw.githubusercontent.com/Kometa-Team/Default-Images/master"

# Function to download assets for an overlay type
download_overlay_type() {
    local overlay_type="$1"
    local subdir="$2"
    local target_dir="$ASSETS_DIR/$overlay_type"

    info "Downloading $overlay_type overlays..."

    # Create target directory
    mkdir -p "$target_dir"

    local files=()
    case "$overlay_type" in
        "resolution")
            files=("4K.png" "1080p.png" "720p.png" "480p.png" "fullhd.png" "ultrahd.png")
            ;;
        "audio_codec")
            files=("dolby atmos.png" "dts-hd ma.png" "truehd.png" "aac.png")
            ;;
        "ribbon")
            files=("imdb top 250.png" "rotten tomatoes certified fresh.png")
            ;;
        "streaming")
            files=("netflix.png" "max.png" "disney+.png" "amazon prime video.png" "apple tv+.png" "amc+.png")
            ;;
        "network")
            files=("amc.png" "hbo.png" "fx.png" "netflix.png")
            ;;
        "studio")
            files=("a24.png" "marvel studios.png" "netflix.png" "sony pictures television.png" "warner bros. pictures.png" "legendary pictures.png")
            ;;
        "ratings")
            files=("imdb.png" "tmdb.png" "rotten tomatoes critics.png")
            ;;
    esac

    for file in "${files[@]}"; do
        # URL encode the filename
        encoded_file=$(echo "$file" | sed 's/ /%20/g' | sed 's/+/%2B/g')
        url="$BASE_URL/$overlay_type/$subdir/$encoded_file"
        target_file="$target_dir/$file"

        if [ -f "$target_file" ]; then
            info "  ✓ $file (already exists)"
            continue
        fi

        info "  Downloading $file..."
        if curl -f -s -L -o "$target_file" "$url"; then
            success "  ✓ $file"
        else
            warn "  ✗ $file (404 or network error)"
            rm -f "$target_file"
        fi
    done

    echo ""
}

# Download each overlay type
download_overlay_type "resolution" "overlays/standard"
download_overlay_type "audio_codec" "overlays/standard"
download_overlay_type "ribbon" "overlays/standard"
download_overlay_type "streaming" "overlays/standard"
download_overlay_type "network" "logos/standard"
download_overlay_type "studio" "logos/standard"
download_overlay_type "ratings" "overlays/standard"

info "Download complete!"
info ""
info "Next steps:"
info "1. Update docker-compose.yml to mount overlay-assets/"
info "2. Update preview config to reference local assets"
info "3. Restart the services"
