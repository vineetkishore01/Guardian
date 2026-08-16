# 🛡️ Guardian — Ultra-Lightweight Server Dashboard & App Launcher

> A unified, high-performance, self-hosted server telemetry dashboard and CasaOS-style application launcher designed for Debian 13 homelabs. Tailored for tight resource constraints (< 45MB RAM footprint).

---

## ✨ Key Features

- **🏠 CasaOS-Style App Launcher (The Centerpiece)**:
  - Automatically discovers all existing (16+) and future Docker containers via `/var/run/docker.sock`.
  - **One-Click Launch**: Clicking any app tile opens `http://<server_ip>:<port>` in a new tab.
  - **Intelligent Host Resolution**: Automatically switches base URLs between **LAN (`192.168.0.26`)**, **Tailscale (`100.94.238.9`)**, or current browser hostname.
  - **Custom Icons**: Paste any direct image/SVG link, or pick from **60+ built-in homelab presets** (Jellyfin, Sonarr, Radarr, Seerr, qBittorrent, Home Assistant, VS Code, etc.).
  - **Custom URLs**: Override with custom subdomains or paths (supports `{host}`, `{lan}`, `{tailscale}` placeholders).
  - **Category Tabs & Search**: Filter by *Media, Downloads, Automation, AI & Tools, Productivity, System, Pinned*.
  - **Custom External Bookmarks**: Add non-Docker web shortcuts (CasaOS host portal on port 3000, router admin, Proxmox, etc.).
  - **Persistence**: All custom icons and URLs are saved in `/data/guardian.json` and persist across container updates.

- **📊 Live System Telemetry**:
  - **CPU & Load**: Utilization %, 8-thread breakdown, 1m/5m/15m load averages, and real-time SVG sparklines.
  - **RAM & Swap**: Detailed breakdown (3.7 GiB total, used, available, buffers/cache, and 3.0 GiB swap usage).
  - **Thermals**: Real-time readings from `/sys/class/thermal` (`x86_pkg_temp` ~47°C, `pch_cannonlake` ~46°C, `B0D4` ~48°C).
  - **Network I/O**: Real-time throughput (rx/tx KB/s and MB/s) on `eno1` and `tailscale0`.

- **💽 Critical Storage Gauges**:
  - **`/mnt/nas` Pool Alert**: Prominent glowing visual gauge for the critical **94% used (190 GB free)** NAS pool (including `/export/RamSetu`).
  - **System Root (`/`)**: 18% used (183 GB free) covering Docker layers and system configs.

- **🧹 Docker Reclaimable Storage Advisor**:
  - Automatically analyzes `docker system df` and highlights the **16.4 GB of reclaimable image/volume space**.
  - Includes a safe 1-click **"Prune Unused Images"** action with instant space reclamation feedback.

- **🩺 Non-Intrusive HTTP Health Prober**:
  - Probes unhealthchecked web endpoints (CasaOS on 3000, ZenNotes on 8001, Pelagica on 8002, Cleanuparr on 11011, Trawl on 8191, llm-wiki on 8080, Prowlarr on 9696, Bazarr on 6767, code-server on 8443) on a gentle **60-second cycle** (3-second timeout).
  - Distinguishes between `200 OK`, `401 Auth`, `403 Forbidden`, `302 Redirect`, and unreachable services.

- **⚡ Ultra-Low Resource Footprint**:
  - **Memory**: Runs comfortably in **~35–45 MB RAM** (capped at 128 MB limit).
  - **CPU**: Negligible (< 0.3% CPU usage).
  - **Live Push**: Uses Server-Sent Events (SSE) instead of aggressive polling.

---

## 🚀 Quick Start & Deployment

### Option A: Add to `/opt/media_stack/docker-compose.yml`

Simply append the Guardian service block to your existing compose file:

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
      # Docker socket for container auto-discovery & stats
      - /var/run/docker.sock:/var/run/docker.sock:ro
      # Host telemetry
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      # Storage monitoring
      - /:/host/root:ro
      - /mnt/nas:/host/mnt/nas:ro
      # Persistent icons and URLs config
      - guardian_data:/data
    environment:
      - HOST_PROC=/host/proc
      - HOST_SYS=/host/sys
      - HOST_ROOT=/host/root
      - HOST_NAS=/host/mnt/nas
      - SERVER_IP=192.168.0.26
      - TAILSCALE_IP=100.94.238.9
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

---

### Option B: Standalone Docker Compose

In this directory:
```bash
docker compose up -d --build
```

Access the dashboard:
- **LAN**: [http://192.168.0.26:3001](http://192.168.0.26:3001)
- **Tailscale**: [http://100.94.238.9:3001](http://100.94.238.9:3001)

---

## 🛠️ Local Development

To run locally outside Docker:

```bash
# Install root, client, and server dependencies
npm run build

# Start server
npm run start
```
Open [http://localhost:3001](http://localhost:3001).

---

## 📁 Project Structure

```
Guardian/
├── Dockerfile                    # Multi-stage ultra-light production image
├── docker-compose.yml            # Debian 13 host compose configuration
├── package.json                  # Root monorepo workspace scripts
├── server/                       # Backend (Node/TypeScript/Express/SSE)
│   ├── src/
│   │   ├── collectors/
│   │   │   ├── host.ts           # /proc & /sys parser (CPU, RAM, Temps, Net)
│   │   │   ├── disk.ts           # Storage pool monitor (/ & /mnt/nas)
│   │   │   └── docker.ts         # Unix socket client for Docker daemon
│   │   ├── prober.ts             # 60s HTTP health & latency prober
│   │   ├── store.ts              # /data/guardian.json persistent store
│   │   ├── ringbuffer.ts         # In-memory telemetry time series
│   │   ├── types.ts              # Shared TypeScript definitions
│   │   └── index.ts              # Server entry, SSE broadcaster, API routes
├── client/                       # Frontend (React 18, Vite, Tailwind CSS, Lucide)
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/               # Card, Button, Dialog, Input, Badge, Progress, Tabs
│   │   │   ├── layout/           # Header, PruneAdvisorBanner, SettingsModal
│   │   │   ├── metrics/          # HostStatsBar, StorageGauges
│   │   │   ├── apps/             # AppGrid, AppCard, EditAppModal, AddAppModal
│   │   │   ├── services/         # ServicesTable
│   │   │   └── charts/           # LiveSparkline
│   │   ├── hooks/                # useLiveTelemetry (SSE + optimistic state)
│   │   ├── lib/                  # iconPresets (60+ icons), formatters, utils
│   │   ├── App.tsx               # Main dashboard UI
│   │   └── index.css             # Glassmorphism & custom dark theme
```
