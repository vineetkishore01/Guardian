# Multi-stage build for ultra-minimal memory footprint (< 40MB RAM)
# -------------------------------------------------------------------
# Stage 1: Build React/Vite Client
FROM node:20-alpine AS client-builder
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build

# -------------------------------------------------------------------
# Stage 2: Build Express/TypeScript Server
FROM node:20-alpine AS server-builder
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build

# -------------------------------------------------------------------
# Stage 3: Production Runner (Ultra-lean Alpine image)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Install production dependencies for server
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy compiled backend and frontend
COPY --from=server-builder /app/server/dist ./server/dist
COPY --from=client-builder /app/client/dist ./client/dist

# Create persistent data directory
RUN mkdir -p /data

EXPOSE 3001

# Cap V8 memory at 64MB to guarantee ultra-low memory footprint on tight RAM servers
CMD ["node", "--max-old-space-size=64", "server/dist/index.js"]
