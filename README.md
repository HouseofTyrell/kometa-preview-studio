# Kometa Preview Studio

A local-only web application for previewing Kometa overlays exactly as Kometa would render them, without modifying your Plex metadata or artwork.

## Features

- **Pixel-identical preview**: Uses the same rendering pipeline as Kometa
- **Safe by design**: Preview mode cannot accidentally modify Plex metadata
- **Multiple artwork sources**: Supports asset directories, Original Posters backups, and Plex current artwork
- **Real-time logs**: Live streaming of render progress via Server-Sent Events
- **Before/After comparison**: Toggle between original and overlayed images

## Preview Targets (v0)

The current version previews 5 static items:

| Item | Type |
|------|------|
| The Matrix (1999) | Movie |
| Dune (2021) | Movie |
| Breaking Bad | Series |
| Breaking Bad Season 1 | Season |
| Breaking Bad S01E01 | Episode |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Node.js 18+ (for local development)
- A running Plex Media Server
- A Kometa `config.yml` file with Plex URL and token

### Option 1: Docker Compose (Recommended)

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd kometa-preview-studio
   ```

2. **Add fonts** (required for consistent rendering)
   ```bash
   # Download Inter font
   cd fonts
   curl -L "https://github.com/rsms/inter/releases/download/v4.0/Inter-4.0.zip" -o Inter.zip
   unzip Inter.zip "Inter Desktop/Inter-Regular.ttf"
   mv "Inter Desktop/Inter-Regular.ttf" .
   rm -rf "Inter Desktop" Inter.zip
   cd ..
   ```

3. **Configure asset directories** (optional)

   Edit `docker-compose.yml` to mount your asset directories:
   ```yaml
   volumes:
     # ... existing volumes ...
     - /path/to/your/assets:/user_assets:ro
     - /path/to/your/kometa/config:/user_config:ro
   ```

4. **Start the application**
   ```bash
   docker-compose up -d
   ```

5. **Access the UI**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

### Option 2: Local Development

1. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Install frontend dependencies**
   ```bash
   cd ../frontend
   npm install
   ```

3. **Start the backend**
   ```bash
   cd ../backend
   npm run dev
   ```

4. **Start the frontend** (in a new terminal)
   ```bash
   cd frontend
   npm run dev
   ```

5. **Access the UI**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

## Usage

### 1. Upload Configuration

Navigate to the **Config** page and either:
- Drag and drop your `config.yml` file
- Paste the YAML content directly

The parser will extract:
- Plex server URL and token presence
- Asset directory paths
- Overlay file configurations
- Library names

### 2. Run Preview

Navigate to the **Preview** page and click **Run Preview**. The system will:

1. Resolve the 5 preview items from your Plex server
2. Fetch base artwork using this priority:
   - Asset directory images (if configured)
   - Original Posters backups (if available)
   - Current Plex artwork (with warning)
3. Generate preview-safe configuration
4. Run the overlay renderer in Docker
5. Display before/after images

### 3. View Results

Each preview tile shows:
- Before image (original artwork)
- After image (with overlays applied)
- Toggle between views
- Download button for the rendered image

The log panel shows real-time progress and any warnings.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │  Config  │  │  Preview │  │ Log Panel│  │ Before/After │ │
│  │  Upload  │  │   Tiles  │  │   (SSE)  │  │  Comparison  │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Backend (Node.js/Express)                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │
│  │   YAML   │  │   Plex   │  │   Job    │  │   Docker     │ │
│  │  Parser  │  │  Client  │  │  Manager │  │   Runner     │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Renderer Container (Docker)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Python + Pillow                                      │   │
│  │  - Loads base images from /jobs/input                 │   │
│  │  - Applies overlay compositions                       │   │
│  │  - Saves results to /jobs/output                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/config` | POST | Upload/parse config |
| `/api/config/:id` | GET | Get saved profile |
| `/api/preview/start` | POST | Start preview job |
| `/api/preview/status/:id` | GET | Get job status |
| `/api/preview/events/:id` | GET | SSE event stream |
| `/api/preview/artifacts/:id` | GET | Get job artifacts |
| `/api/preview/image/:id/:folder/:file` | GET | Serve image |
| `/api/preview/logs/:id` | GET | Get job logs |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend port |
| `HOST` | `127.0.0.1` | Backend host |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed CORS origin |
| `JOBS_PATH` | `../jobs` | Jobs directory |
| `FONTS_PATH` | `../fonts` | Fonts directory |
| `KOMETA_IMAGE` | `python:3.11-slim` | Docker image for renderer |
| `USER_ASSETS_PATH` | - | User asset directory mount |
| `USER_KOMETA_CONFIG_PATH` | - | User Kometa config mount |

## Base Artwork Priority

The system fetches base artwork in this order:

1. **Asset Directory** - If `asset_directory` is configured in your Kometa config and a matching file exists
2. **Original Posters** - If you have Kometa's "Original Posters" backup directory mounted
3. **Plex Current** - Falls back to current Plex artwork (warning: may already contain overlays)

## Dry Run Checklist

Before running a preview, verify:

- [ ] Your `config.yml` contains valid Plex URL and token
- [ ] The Plex server is accessible from the machine running this tool
- [ ] The 5 preview items exist in your Plex library
- [ ] Docker is running and accessible
- [ ] Fonts are present in the `fonts/` directory

## Troubleshooting

### "Plex connection failed"

- Verify your Plex URL is correct (include http:// or https://)
- Check that your Plex token is valid
- Ensure the Plex server is accessible from the Docker container

### "Item not found in Plex"

- The preview targets must exist in your Plex library
- Search is by title and year, so ensure exact matches

### Windows Path Mapping

When running on Windows with Docker Desktop:
- Use forward slashes in volume paths
- Ensure paths are accessible to Docker (usually under `/c/Users/...`)

### Font Issues

- Ensure at least one `.ttf` or `.otf` font is in the `fonts/` directory
- The Inter font is recommended for consistent rendering

### Container Can't Access Docker Socket

On Linux, ensure the user running the backend has access to `/var/run/docker.sock`:
```bash
sudo usermod -aG docker $USER
```

## Security Notes

- **Local-only**: The backend binds to `127.0.0.1` by default
- **No Plex writes**: Preview mode only reads from Plex, never writes
- **Token redaction**: Plex tokens are never logged or exposed to the frontend
- **Path traversal protection**: Image serving validates paths to prevent directory traversal

## License

MIT

## Acknowledgments

- [Kometa](https://kometa.wiki/) - The metadata manager this tool previews
- [Plex](https://plex.tv/) - Media server
