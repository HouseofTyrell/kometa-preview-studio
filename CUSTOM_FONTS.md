# Custom Fonts Setup for Kometa Preview Studio

Custom fonts are now supported in fast preview mode! This allows your instant previews to use the same custom fonts (Adlib, Impact, Avenir, etc.) that you've configured in your Kometa config.

## How It Works

The instant compositor now:
1. Extracts font configurations from your Kometa config (`rating1_font`, `rating2_font`, `rating3_font`)
2. Loads custom fonts from your mounted Kometa config directory
3. Uses them when rendering rating badges in fast preview mode

## Setup Instructions

### Option 1: Using Environment Variable

1. Create a `.env` file in the project root (if you don't have one):
   ```bash
   cd /Users/housetyrell/Documents/Programming\ Projects/kometa-preview-studio
   touch .env
   ```

2. Add your Kometa config path to `.env`:
   ```bash
   # Path to your Kometa config directory (the one containing config.yml and config/fonts/)
   KOMETA_CONFIG_PATH=/path/to/your/kometa
   ```

3. Add the volume mount to `docker-compose.yml` (uncomment line 44):
   ```yaml
   volumes:
     # ... other volumes ...
     - ${KOMETA_CONFIG_PATH}:/user_config:ro
   ```

4. Restart containers:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

### Option 2: Direct Path in docker-compose.yml

1. Edit `docker-compose.yml` line 33 and 44:
   ```yaml
   environment:
     - USER_KOMETA_CONFIG_PATH=/user_config

   volumes:
     - /actual/path/to/your/kometa:/user_config:ro
   ```

2. Restart containers:
   ```bash
   docker-compose down
   docker-compose up -d --build
   ```

## Finding Your Kometa Config Directory

Your Kometa config directory is the folder that contains:
- `config.yml` (your main Kometa configuration)
- `config/fonts/` directory with your custom fonts (Adlib.ttf, Impact.ttf, Avenir_95_Black.ttf)

Common locations:
- Docker: `/path/to/kometa/config`
- Local: `~/kometa` or `~/Kometa`
- NAS: `/volume1/docker/kometa` (Synology) or similar

## Verifying It Works

Once configured, when you run a preview job, you should see:

```
Loaded custom rating fonts:
  rating1: config/fonts/Adlib.ttf @ 63pt
  rating2: config/fonts/Impact.ttf @ 70pt
  rating3: config/fonts/Avenir_95_Black.ttf @ 70pt
```

And when creating badges:
```
Loaded custom font: /user_config/config/fonts/Adlib.ttf at size 63
```

## Troubleshooting

### Fonts not loading?

1. Check that `USER_KOMETA_CONFIG_PATH` environment variable is set:
   ```bash
   docker-compose exec backend env | grep KOMETA_CONFIG
   ```

2. Verify the volume is mounted:
   ```bash
   docker-compose exec backend ls -la /user_config/config/fonts/
   ```
   You should see your .ttf files.

3. Check the logs when running a preview job:
   ```bash
   docker-compose logs backend | grep -i font
   ```

### Still using default fonts?

The instant compositor will fall back to default fonts if:
- The Kometa config directory isn't mounted
- The font files don't exist at the expected paths
- The paths in your config.yml don't match the actual file locations

This is by design - the system degrades gracefully to system fonts rather than failing.

## What Gets Mounted

When you mount your Kometa config directory to `/user_config`:
- Custom fonts at `/user_config/config/fonts/*.ttf` become available
- Original Posters at `/user_config/Original Posters/` can be used as base images
- Your actual `config.yml` is NOT used (Preview Studio uses its own generated config)

This is read-only, so your actual Kometa setup is never modified.
