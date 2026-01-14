#!/bin/bash
#
# Resets Kometa Preview Studio to a clean state.
#
# This script removes all containers, volumes, and orphaned containers,
# then rebuilds all images from scratch without cache.
# WARNING: This will delete all job data stored in Docker volumes.
#
# Requires: Bash, Docker with docker-compose

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

# Determine repo root (scripts are in repo_root/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

info "Changing to repository root: $REPO_ROOT"
cd "$REPO_ROOT"

# Determine compose command
if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
elif docker-compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
else
    err "docker-compose is not available."
    exit 1
fi

# Warning prompt
echo ""
warn "=========================================="
warn "              WARNING"
warn "=========================================="
warn "This will:"
warn "  - Stop and remove all containers"
warn "  - Remove all Docker volumes (job data)"
warn "  - Remove orphaned containers"
warn "  - Rebuild all images from scratch"
echo ""

# Check if running non-interactively (e.g., from the web UI)
if [ -t 0 ]; then
    read -p "Are you sure you want to continue? (y/N) " confirmation
    if [ "$confirmation" != "y" ] && [ "$confirmation" != "Y" ]; then
        info "Reset cancelled"
        exit 0
    fi
else
    # Non-interactive mode - proceed without confirmation
    info "Running in non-interactive mode, proceeding with reset..."
fi

echo ""

# Remove containers and volumes
info "Stopping containers and removing volumes..."

$COMPOSE_CMD down -v --remove-orphans
if [ $? -ne 0 ]; then
    err "docker-compose down failed"
    exit 1
fi
success "Containers and volumes removed"

# Rebuild without cache
info "Rebuilding images without cache (this may take several minutes)..."

$COMPOSE_CMD build --no-cache
if [ $? -ne 0 ]; then
    err "docker-compose build --no-cache failed"
    exit 1
fi
success "Images rebuilt successfully"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Reset complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Run ./scripts/start.sh to restart Kometa Preview Studio"
echo ""
