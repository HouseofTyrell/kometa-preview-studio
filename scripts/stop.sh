#!/bin/bash
#
# Stops Kometa Preview Studio containers.
#
# Requires: Bash, Docker with docker-compose

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
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

# Stop containers
info "Stopping Kometa Preview Studio..."

$COMPOSE_CMD down
if [ $? -ne 0 ]; then
    err "docker-compose down failed"
    exit 1
fi

success "Kometa Preview Studio stopped"
echo ""
echo "To start again, run: ./scripts/start.sh"
echo ""
