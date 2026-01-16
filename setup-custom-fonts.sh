#!/bin/bash
# Setup script for custom fonts in Kometa Preview Studio

set -e

echo "=========================================="
echo "Kometa Preview Studio - Custom Fonts Setup"
echo "=========================================="
echo ""

# Check if .env exists
if [ -f .env ]; then
    echo "Found existing .env file"
    if grep -q "KOMETA_CONFIG_PATH" .env; then
        current_path=$(grep "KOMETA_CONFIG_PATH" .env | cut -d'=' -f2)
        echo "Current KOMETA_CONFIG_PATH: $current_path"
    fi
else
    echo "No .env file found, will create one"
fi

echo ""
echo "Please enter the full path to your Kometa config directory"
echo "(The directory containing config.yml and config/fonts/)"
echo ""
read -p "Kometa config path: " kometa_path

# Expand tilde if present
kometa_path="${kometa_path/#\~/$HOME}"

# Validate path
if [ ! -d "$kometa_path" ]; then
    echo "ERROR: Directory does not exist: $kometa_path"
    exit 1
fi

if [ ! -f "$kometa_path/config.yml" ]; then
    echo "WARNING: config.yml not found at $kometa_path/config.yml"
    echo "Are you sure this is the correct directory?"
    read -p "Continue anyway? (y/N): " confirm
    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

if [ ! -d "$kometa_path/config/fonts" ]; then
    echo "WARNING: config/fonts/ directory not found at $kometa_path/config/fonts"
    echo "Custom fonts will not be available unless this directory exists"
fi

# Update or create .env
if [ -f .env ]; then
    if grep -q "KOMETA_CONFIG_PATH" .env; then
        # Update existing line
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^KOMETA_CONFIG_PATH=.*|KOMETA_CONFIG_PATH=$kometa_path|" .env
        else
            sed -i "s|^KOMETA_CONFIG_PATH=.*|KOMETA_CONFIG_PATH=$kometa_path|" .env
        fi
        echo "Updated KOMETA_CONFIG_PATH in .env"
    else
        # Append new line
        echo "KOMETA_CONFIG_PATH=$kometa_path" >> .env
        echo "Added KOMETA_CONFIG_PATH to .env"
    fi
else
    # Create new .env
    echo "KOMETA_CONFIG_PATH=$kometa_path" > .env
    echo "Created .env with KOMETA_CONFIG_PATH"
fi

echo ""
echo "Now updating docker-compose.yml to mount the volume..."

# Check if the volume mount line exists and is commented
if grep -q "^[[:space:]]*#.*:/user_config:ro" docker-compose.yml; then
    echo "Found commented volume mount, uncommenting..."
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' 's|^[[:space:]]*#\(.*\):/user_config:ro|\1:/user_config:ro|' docker-compose.yml
    else
        sed -i 's|^[[:space:]]*#\(.*\):/user_config:ro|\1:/user_config:ro|' docker-compose.yml
    fi
elif grep -q ":/user_config:ro" docker-compose.yml; then
    echo "Volume mount already active"
else
    echo "Adding volume mount to docker-compose.yml..."
    # Add before the depends_on line
    if [[ "$OSTYPE" == "darwin"* ]]; then
        sed -i '' '/depends_on:/i\
      - ${KOMETA_CONFIG_PATH}:/user_config:ro
' docker-compose.yml
    else
        sed -i '/depends_on:/i\      - ${KOMETA_CONFIG_PATH}:/user_config:ro' docker-compose.yml
    fi
fi

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Kometa config path: $kometa_path"
echo "  Container mount: /user_config"
echo ""
echo "Next steps:"
echo "  1. Verify your fonts exist at: $kometa_path/config/fonts/"
echo "  2. Restart the containers:"
echo "     docker-compose down"
echo "     docker-compose up -d --build"
echo ""
echo "  3. Check logs to verify fonts are loading:"
echo "     docker-compose logs backend | grep -i font"
echo ""
echo "See CUSTOM_FONTS.md for more details and troubleshooting."
