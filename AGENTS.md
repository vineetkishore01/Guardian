# Guardian Agent Memory & Engineering Reference (AGENTS.md)

This document provides a comprehensive operational memory, architectural record, and changelog of all work performed on **Guardian**. Future AI agents and engineers working on this repository should consult this file before making modifications.

---

## 1. Project Overview & Architecture

**Guardian** is an ultra-lightweight, self-hosted server & Docker dashboard + app launcher designed to run with minimal CPU and memory overhead on home servers, homelabs, VPSs, Raspberry Pis, and enterprise Linux hosts.

### Core Stack
- **Backend (`server/`)**: Node.js (v20+ / v22), TypeScript (`NodeNext`), Express, CORS.
  - Custom zero-overhead collectors for system telemetry (CPU, Memory, Disk, Network, Processes).
  - Docker daemon integration via standard `/var/run/docker.sock` Unix socket using direct Docker REST API calls (no heavy CLI wrappers).
  - Config persistence in JSON (`data/apps.json`, `data/settings.json`).
- **Frontend (`client/`)**: React 18, TypeScript, Vite, Tailwind CSS, Lucide icons, glassmorphic dark UI design system.
- **Packaging (`Dockerfile`, `docker-compose.yml`)**: Multi-stage Alpine container (`node:22-alpine`) supporting multi-architecture targets (`linux/amd64`, `linux/arm64/v8`). Published to GitHub Container Registry (GHCR):
  ```
  ghcr.io/vineetkishore01/guardian:latest
  ```

---

## 2. Key System Components & Collectors

### A. Host Telemetry (`server/src/collectors/`)
- **Host Metrics Fallback**: When running inside a Docker container, host metrics are extracted from mounted `/host/proc`, `/host/sys`, and `/host/etc/os-release` paths configured via environment variables:
  - `HOST_PROC=/host/proc`
  - `HOST_SYS=/host/sys`
  - `HOST_ETC=/host/etc`
- **Linux Distribution Genericity**: Designed and verified to work seamlessly across:
  - Debian, Ubuntu, Proxmox VE
  - TrueNAS SCALE, Unraid
  - Arch Linux, Alpine Linux
  - Raspberry Pi OS & ARM64 SBCs
- **Mount Propagation**: Uses `:ro,rslave` on host mounts (`/`, `/proc`, `/sys`) in `docker-compose.yml.example` to ensure dynamic host mount changes (such as plugging in external storage or new mountpoints) propagate into the container without throwing permission or stale handle errors.

### B. Docker Collector (`server/src/collectors/docker.ts`)
- Communicates directly with `/var/run/docker.sock`.
- Auto-detects running containers, health status, exposed ports, IP bindings, and resource usage.
- Enables 1-click web launcher mapping: automatically derives external URLs from port bindings or Docker labels (e.g. `guardian.url`, `traefik.http.routers.*`).

### C. Process Monitor (`server/src/collectors/processes.ts`)
- Reads `/proc` directly on Linux hosts or `/host/proc` when containerized.
- Extracts PID, process name, state, CPU utilization %, and RSS memory usage with zero dependencies.
- Gracefully handles non-Linux host platforms (e.g. Darwin/macOS local dev) by falling back to standard Node child process calls.

### D. Endpoint Health Checker (`server/src/collectors/endpoints.ts`)
- Configurable URL pinging for external / LAN services with latency tracking and status badge indication.

---

## 3. Repository Branch Structure & Protection

### `main` Branch
- Contains only the application source code, configs, and container definitions:
  - `server/`: Backend TypeScript code.
  - `client/`: Frontend React application.
  - `Dockerfile`: Multi-stage build for application images.
  - `docker-compose.yml`: Local production testing.
  - `docker-compose.yml.example`: User-facing deployment template.
  - `README.md`: Project documentation.
- **Website Code Protection**:
  - The showcase landing page code is **explicitly excluded** from `main` so that anyone cloning the public repo receives a clean, focused application codebase.
  - `.gitignore` includes:
    ```gitignore
    # Website code lives on gh-pages branch only
    docs/*.html
    docs/*.css
    docs/*.js
    ```

### `gh-pages` Branch
- An isolated branch dedicated strictly to the public showcase landing page served at:
  - **Live URL**: `https://vineetkishore01.github.io/Guardian/`
- Contains:
  - `index.html`: Hero section, feature breakdown, live interactive installer, telemetry simulator, and screenshot gallery.
  - `styles.css`: Custom vanilla CSS with glassmorphic cards, radiant purple/cyan gradients, and responsive layouts.
  - `app.js`: Tab switching logic, copy-to-clipboard for the 1-line install command, animated telemetry preview, and Cloudflare visit tracking beacon.
  - 5 Retina high-resolution screenshots highlighting the real application UI.

---

## 4. Personal Visitor Analytics & Telemetry (Cloudflare Worker + KV)

To monitor traffic and virality on the public showcase website without heavy third-party trackers (like Google Analytics), a custom serverless Cloudflare Worker with KV storage was built and deployed.

### Worker Details
- **Worker Name**: `guardian-counterstill-sun-e8de`
- **Public URL**: `https://guardian-counterstill-sun-e8de.vineetkishore01.workers.dev`
- **KV Namespace**: `guardian_stats` (`dfe569263e6142f4a944fb48c339ba30`)
- **Cloudflare Account**: Configured and deployed using user's logged-in session via `ego-browser`.

### API Endpoints
1. **Hit Beacon (`GET /hit`)**:
   - Called asynchronously by `app.js` on `https://vineetkishore01.github.io/Guardian/` upon page load.
   - Computes an anonymized daily hash from `CF-Connecting-IP` + `User-Agent` + date.
   - Atomically increments total pageviews, records daily unique visitors, updates geographic distribution (country code from `cf.country`), and appends to a rolling 50-item audit log.
   - Sets permissive CORS headers (`Access-Control-Allow-Origin: *`).
2. **Executive Dashboard (`GET /`)**:
   - Access directly in a browser: `https://guardian-counterstill-sun-e8de.vineetkishore01.workers.dev/`
   - Returns a real-time dark-mode HTML dashboard displaying:
     - Total Pageviews
     - Unique Visitors
     - Top Visitor Countries
     - Recent Visitor Timeline (timestamps, anonymized hashes, countries)

---

## 5. Local Development & Build Commands

### Initial Setup
```bash
# Root dependencies (concurrently dev runner)
npm install

# Server dependencies (Express, TypeScript, @types/node)
cd server && npm install

# Client dependencies (React, Vite, Tailwind CSS)
cd client && npm install
```

### Type Checking & Linting
Always ensure both workspaces compile with zero errors:
```bash
# Verify backend TypeScript compilation
./server/node_modules/.bin/tsc --project server/tsconfig.json --noEmit

# Verify frontend TypeScript compilation
./client/node_modules/.bin/tsc --project client/tsconfig.json --noEmit
```

### Running Locally
```bash
# Start both client and server concurrently
npm run dev

# Or start individually:
npm run dev:server   # Starts server with tsx watch on :3001
npm run dev:client   # Starts Vite dev server on :5173
```

### Building for Production
```bash
# Builds client into client/dist and server into server/dist
npm run build
```

---

## 6. Docker Deployment & Quick Install

### One-Line Install Command (Featured on Website)
```bash
curl -fsSL https://raw.githubusercontent.com/vineetkishore01/Guardian/main/docker-compose.yml.example -o docker-compose.yml && docker compose up -d
```

### Reference `docker-compose.yml.example`
```yaml
services:
  guardian:
    image: ghcr.io/vineetkishore01/guardian:latest
    container_name: guardian
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - HOST_PROC=/host/proc
      - HOST_SYS=/host/sys
      - HOST_ETC=/host/etc
    volumes:
      # Docker socket for container control and metrics
      - /var/run/docker.sock:/var/run/docker.sock:ro
      # Host telemetry filesystem mounts with rslave propagation
      - /proc:/host/proc:ro,rslave
      - /sys:/host/sys:ro,rslave
      - /etc/os-release:/host/etc/os-release:ro
      # Persistent storage for custom pinned apps and user settings
      - guardian_data:/app/data

volumes:
  guardian_data:
    driver: local
```

---

## 7. Operational Guidelines for Future Agents

1. **Keep Website Code Out of `main`**:
   Never commit HTML/CSS/JS files intended for the showcase site to `main`. If making updates to the showcase website, checkout or work on `gh-pages` branch, commit, push to `origin gh-pages`, and switch back to `main`.
2. **Never Break Linux Distro Genericity**:
   When updating collectors in `server/src/collectors/`, always respect the `HOST_PROC`, `HOST_SYS`, and `HOST_ETC` environment variables and check for file existence before reading paths. Avoid distro-specific assumptions.
3. **Preserve Type Declarations**:
   Ensure `server/package.json` contains `@types/node` and that `./server/node_modules/.bin/tsc --noEmit` exits with 0 before completing any backend modifications.
4. **Cloudflare Worker Updates**:
   The worker script source is maintained in the Cloudflare Dashboard under `guardian-counterstill-sun-e8de`. If modifications are needed, test changes using `ego-browser` or the Cloudflare API.
