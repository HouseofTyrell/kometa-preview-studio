# Quick Start: Custom Fonts in 3 Steps

Custom fonts are now supported in fast preview mode! Here's how to set it up:

## Step 1: Find Your Kometa Config Directory

Your Kometa config directory is the folder containing:
- `config.yml`
- `config/fonts/` with your custom .ttf files

Common locations:
- `~/kometa`
- `/opt/kometa`
- Docker: `/path/to/kometa/config`

## Step 2: Configure the Path

**Option A: Using the setup script (recommended)**
```bash
./setup-custom-fonts.sh
```

**Option B: Manual setup**
1. Copy the example env file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your path:
   ```bash
   KOMETA_CONFIG_PATH=/path/to/your/kometa
   ```

## Step 3: Restart

```bash
docker-compose down
docker-compose up -d --build
```

## Verify It's Working

Check the logs when running a preview:
```bash
docker-compose logs backend | grep -i font
```

You should see:
```
Loaded custom rating fonts:
  rating1: config/fonts/Adlib.ttf @ 63pt
  rating2: config/fonts/Impact.ttf @ 70pt
  rating3: config/fonts/Avenir_95_Black.ttf @ 70pt
```

## Need Help?

- See [CUSTOM_FONTS.md](CUSTOM_FONTS.md) for detailed documentation
- See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for technical details

---

**Note:** If you don't configure custom fonts, the system will gracefully fall back to system fonts. Everything will still work, just with default fonts instead of your custom ones.
