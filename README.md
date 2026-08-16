# 🛡️ Guardian — Ultra-Lightweight Server Dashboard & App Launcher

> A self-hosted server telemetry dashboard and app launcher for Docker homelabs. Reads the host directly from `/proc`, `/sys` and the Docker socket, and runs in ~35–45 MB of RAM.

---

## ✨ Key Features

- **🏠 App launcher**
  - Auto-discovers every container via `/var/run/docker.sock` — no manual registration.
  - **One-click launch**: a tile opens `http://<host>:<port>` in a new tab.
  - **Host resolution**: build launch URLs from the browser's own address, a configured LAN IP, a Tailscale IP, or a custom domain.
  - **Custom icons**: 60+ built-in homelab presets, or any direct image/SVG URL.
  - **Custom URLs**: override per app, with `{host}`, `{lan}` and `{tailscale}` placeholders.
  - **Categories, search and pinning**, plus `/` to jump straight to the search box.
  - **Bookmarks** for anything outside Docker — a router page, a NAS UI, a hosted service.
  - **Persistence**: customisations live in `/data/guardian.json` and survive image updates.

- **📊 Live telemetry**
  - **CPU**: total and per-core utilisation from `/proc/stat`, plus 1/5/15m load averages.
  - **Memory**: used, available, buffers/cache and swap from `/proc/meminfo`.
  - **Thermals**: every zone exposed under `/sys/class/thermal`.
  - **Network**: per-interface throughput from `/proc/net/dev`, with the busiest physical link promoted.
  - Rolling sparklines backed by an in-memory ring buffer, sampled on a fixed cadence.

- **💽 Storage**
  - Every real filesystem from `/proc/mounts` (pseudo-filesystems filtered out), with true device and fs type.
  - Thresholded status: healthy below 80% used, *filling up* at 80%, *low space* at 90%.

- **🧹 Docker reclaimable storage**
  - Reads `docker system df` and surfaces reclaimable image and volume space.
  - One-click prune of **dangling images only** — running containers and tagged images are untouched.

- **🩺 HTTP health prober**
  - Probes configured endpoints on a 60-second cycle with a 3-second timeout.
  - Reports latency and distinguishes `2xx`, redirects, `401`/`403`, other client errors and server errors.

- **⚡ Low footprint**
  - **Memory**: ~35–45 MB (capped at 128 MB in the sample compose).
  - **CPU**: negligible between samples.
  - **Live push**: Server-Sent Events with heartbeats, not aggressive polling.

> **Running off-host?** Without `/proc`, `/sys` or the Docker socket, Guardian serves clearly-labelled sample data and tells you which source it could not reach. It never presents synthesized values as real measurements.

---

## 🚀 Quick Start & Deployment

### Option A: add to an existing `docker-compose.yml`

```yaml
services:
  guardian:
    image: guardian:latest
    build:
      context: /path/to/Guardian
      dockerfile: Dockerfile
    container_name: guardian
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      # Container auto-discovery & stats
      - /var/run/docker.sock:/var/run/docker.sock:ro
      # Host telemetry
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro
      # Storage monitoring — mount whatever you want measured
      - /:/host/root:ro
      - /mnt/nas:/host/mnt/nas:ro
      # Persisted icons, categories and bookmarks
      - guardian_data:/data
    environment:
      - HOST_PROC=/host/proc
      - HOST_SYS=/host/sys
      - HOST_ETC=/host/etc
      - HOST_ROOT=/host/root
      - HOST_NAS=/host/mnt/nas
      # Optional: extra mount points to watch, comma separated
      # - HOST_MOUNTS=/host/mnt/backup,/host/srv
      # Optional: pre-seed the launch targets offered in the UI
      - SERVER_IP=192.168.1.10
      - TAILSCALE_IP=100.100.100.100
      - PORT=3001
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.50'

volumes:
  guardian_data:
```

Deploy with:

```bash
docker compose up -d --build guardian
```

### Option B: standalone

```bash
docker compose up -d --build
```

Then open `http://<your-server-ip>:3001`.

---

## ⚙️ Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP listen port |
| `BIND_HOST` | `0.0.0.0` | Listen address |
| `HOST_PROC` | `/proc` | procfs mount point |
| `HOST_SYS` | `/sys` | sysfs mount point |
| `HOST_ETC` | `/etc` | Used to read `os-release` for the distro name |
| `HOST_ROOT` | `/` | Root filesystem to measure |
| `HOST_NAS` | `/mnt/nas` | Additional volume to measure |
| `HOST_MOUNTS` | — | Comma-separated extra mount points |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker daemon socket |
| `DATA_DIR` | `/data` | Where `guardian.json` is written |
| `SERVER_IP` | — | Seeds the LAN launch target |
| `TAILSCALE_IP` | — | Seeds the Tailscale launch target |

Launch targets, dashboard title and the telemetry sample interval (5–300s) are all editable in **Settings** at runtime.

---

## 🔌 API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, SSE client count, last sample time |
| `GET` | `/api/status` | Current telemetry snapshot |
| `GET` | `/api/live` | SSE stream of snapshots |
| `GET` | `/api/config` | Full persisted config (backup) |
| `POST` | `/api/config/settings` | Update settings |
| `POST` | `/api/containers/:name/custom` | Per-container overrides |
| `POST` | `/api/custom-apps` | Create or update a bookmark |
| `DELETE` | `/api/custom-apps/:id` | Delete a bookmark |
| `POST` | `/api/docker/prune` | Prune dangling images |
| `POST` | `/api/probes/refresh` | Force a health-probe cycle |

---

## 🛠️ Local Development

```bash
# Install dependencies in root, client and server
npm install && (cd client && npm install) && (cd server && npm install)

# Run client (5173) and server (3001) together with hot reload
npm run dev

# Or build and serve the production bundle from the server
npm run build && npm run start
```

Open [http://localhost:3001](http://localhost:3001). On a non-Linux machine the host and Docker collectors fall back to sample data, and the dashboard says so.

---

## 📁 Project Structure

```
Guardian/
├── Dockerfile                    # Multi-stage production image
├── docker-compose.yml            # Sample host compose configuration
├── package.json                  # Root monorepo workspace scripts
├── server/                       # Backend (Node / TypeScript / Express / SSE)
│   ├── src/
│   │   ├── collectors/
│   │   │   ├── host.ts           # /proc & /sys parser (CPU, RAM, temps, net)
│   │   │   ├── disk.ts           # Filesystem discovery via /proc/mounts
│   │   │   └── docker.ts         # Unix-socket client for the Docker daemon
│   │   ├── prober.ts             # HTTP health & latency prober
│   │   ├── store.ts              # Persistent store + payload sanitisation
│   │   ├── ringbuffer.ts         # In-memory telemetry time series
│   │   ├── types.ts              # Shared TypeScript definitions
│   │   └── index.ts              # Sampling loop, SSE broadcaster, API routes
├── client/                       # Frontend (React 18, Vite, Tailwind, Lucide)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/               # Card, Button, Dialog, Input, Badge, Progress, Tabs
│   │   │   ├── layout/           # Header, PruneAdvisorBanner, SettingsModal
│   │   │   ├── metrics/          # MetricCard, HostStatsBar, StorageGauges
│   │   │   ├── apps/             # AppGrid, AppCard, EditAppModal, AddAppModal
│   │   │   ├── services/         # ServicesTable
│   │   │   └── charts/           # LiveSparkline
│   │   ├── hooks/                # useLiveTelemetry (SSE + fallback polling)
│   │   ├── lib/                  # iconPresets, formatters, severity helpers
│   │   ├── App.tsx               # Dashboard composition
│   │   └── index.css             # Design tokens, surfaces, themes
```

---

## 🎨 Design

Guardian uses a token-driven design system: a neutral ramp carries the interface, a single brand hue marks interactive affordances, and three status hues (ok / warn / critical) are reserved for state. A metric is only coloured when it crosses a threshold — a healthy dashboard reads as calm monochrome, so anything coloured is worth looking at. Light and dark themes are both first-class and applied before first paint.
