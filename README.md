# Kometa Preview Studio

A local-only web application for previewing Kometa overlays exactly as Kometa would render them, without modifying your Plex metadata or artwork.

## Features

- **Pixel-identical preview**: Uses Kometa's actual overlay rendering code for pixel-perfect results
- **Safe by design**: Preview mode cannot accidentally modify Plex metadata - operates fully offline
- **Multiple artwork sources**: Supports asset directories, Original Posters backups, and Plex current artwork
- **Real-time logs**: Live streaming of render progress via Server-Sent Events
- **Before/After comparison**: Toggle between original and overlayed images
- **Deterministic rendering**: Pinned Kometa Docker image version ensures consistent results

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

4. **Build and start the application**
   ```bash
   # Build the Kometa-based renderer image first
   docker-compose build

   # Start the services
   docker-compose up -d
   ```

5. **Access the UI**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:3001

> **Note**: The first build will pull the Kometa base image which may take a few minutes depending on your connection speed.

#### One-click (Windows)

For Windows users, we provide convenient scripts that automate the entire setup process:

**Quick Start:**
1. Double-click `scripts\start.bat` (or run `.\scripts\start.ps1` in PowerShell)
2. Wait for the build to complete - the UI will open automatically

**What the start script does:**
- Verifies Docker Desktop is running
- Creates `fonts/` and `jobs/` directories if missing
- Creates `.env` with sensible defaults if missing
- Downloads Inter font automatically if `fonts/Inter-Regular.ttf` is missing
- Builds and starts all containers
- Opens http://localhost:5173 in your browser

**Available scripts:**

| Script | Purpose |
|--------|---------|
| `scripts\start.bat` | Start the application (auto-setup on first run) |
| `scripts\stop.bat` | Stop all containers |
| `scripts\logs.bat` | View live container logs (Ctrl+C to exit) |
| `scripts\reset.bat` | Full reset: remove volumes, rebuild without cache |

**PowerShell alternative:**
```powershell
# From the repository root
.\scripts\start.ps1   # Start
.\scripts\stop.ps1    # Stop
.\scripts\logs.ps1    # View logs
.\scripts\reset.ps1   # Full reset
```

> **Note**: The scripts use `docker-compose` (not `docker compose`) and require Docker Desktop to be running. PowerShell 5.1+ is required (included with Windows 10/11).

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
│              Kometa Renderer Container (Docker)              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Based on kometateam/kometa (pinned version)          │   │
│  │  - Uses Kometa's actual overlay rendering modules     │   │
│  │  - Loads base images from /jobs/input                 │   │
│  │  - Applies overlays using Kometa's PIL/Pillow code    │   │
│  │  - Saves pixel-identical results to /jobs/output      │   │
│  │  - Network isolated (no Plex writes possible)         │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Why Kometa Container?

The preview renderer is based on the official Kometa Docker image (`kometateam/kometa`) for several important reasons:

1. **Pixel-identical rendering**: By using Kometa's actual overlay code, the preview output matches exactly what Kometa would produce when running against your real library.

2. **Deterministic results**: The Kometa image version is pinned (default: `v2.0.2`) to ensure consistent rendering across different environments and over time.

3. **Same fonts and styling**: Kometa's bundled fonts and styling calculations are used, eliminating subtle differences that could occur with a reimplementation.

4. **Future compatibility**: As Kometa's overlay system evolves, updates to the pinned version will automatically incorporate improvements.

### Preview Renderer Architecture (Proxy-Based Write Blocking)

The preview renderer runs **real Kometa** with a **local HTTP proxy** that blocks all writes to Plex:

```
┌──────────────────────────────────────────────────────────────┐
│                     preview_entrypoint.py                     │
├──────────────────────────────────────────────────────────────┤
│  1. Start PlexProxy on 127.0.0.1:32500                       │
│     - Forward GET/HEAD requests to real Plex                 │
│     - Block PUT/POST/PATCH/DELETE → return 200 OK            │
│     - Log all blocked write attempts                         │
│                                                               │
│  2. Generate kometa_run.yml                                  │
│     - plex.url = proxy URL (not real Plex!)                  │
│     - All Plex traffic routes through proxy                  │
│                                                               │
│  3. Run Kometa subprocess                                    │
│     - Kometa connects to proxy, writes blocked at network    │
│     - Streams stdout/stderr for SSE logging                  │
│                                                               │
│  4. Export Kometa's rendered images to output/               │
└──────────────────────────────────────────────────────────────┘
```

**Why proxy instead of monkeypatching?** Monkeypatches don't work across process boundaries. The proxy runs in the main process and intercepts all HTTP traffic from the Kometa subprocess.

**Key differences from normal Kometa:**

| Feature | Normal Kometa | Preview Mode |
|---------|--------------|--------------|
| Plex connection | Direct | Via write-blocking proxy |
| Plex writes | Allowed | Blocked at network layer |
| Metadata updates | Yes (labels, posters) | No (returns fake 200) |
| Output destination | Uploaded to Plex | Exported to local files |

For more technical details, see [renderer/PREVIEW_MODE.md](renderer/PREVIEW_MODE.md).

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
| `JOBS_PATH` | `./jobs` | Jobs directory |
| `FONTS_PATH` | `./fonts` | Fonts directory |
| `KOMETA_IMAGE_TAG` | `v2.0.2` | Pinned Kometa Docker image tag |
| `KOMETA_RENDERER_IMAGE` | `kometa-preview-renderer:latest` | Built renderer image name |
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
- **Network isolation**: Renderer containers run with `NetworkMode: 'none'` - no network access possible
- **Token redaction**: Plex tokens are never logged or exposed to the frontend
- **Path traversal protection**: Image serving validates paths to prevent directory traversal
- **Read-only mounts**: User assets and fonts are mounted read-only into containers

## License

MIT

## Acknowledgments

- [Kometa](https://kometa.wiki/) - The metadata manager this tool previews
- [Plex](https://plex.tv/) - Media server
