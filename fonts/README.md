# Fonts Directory

This directory contains fonts that will be mounted into the Kometa renderer container.

## Default Font

For consistent overlay rendering, you should add at least one font family here.

### Recommended: Inter Font

Download Inter from Google Fonts:
https://fonts.google.com/specimen/Inter

Place the following files here:
- `Inter-Regular.ttf`
- `Inter-Bold.ttf`
- `Inter-SemiBold.ttf`
- `Inter-Medium.ttf`

### Alternative: DejaVu Sans

Download from:
https://dejavu-fonts.github.io/

Place:
- `DejaVuSans.ttf`
- `DejaVuSans-Bold.ttf`

## Quick Setup

Run this to download Inter font:

```bash
# Create fonts directory if it doesn't exist
mkdir -p fonts

# Download Inter font (you'll need wget or curl)
cd fonts
curl -L "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip" -o Inter.zip
unzip Inter.zip "Inter Desktop/Inter-Regular.ttf" "Inter Desktop/Inter-Bold.ttf" "Inter Desktop/Inter-SemiBold.ttf"
mv "Inter Desktop"/* .
rm -rf "Inter Desktop" Inter.zip
```

## Font Loading

The renderer will automatically scan this directory and load any `.ttf` or `.otf` files it finds.
