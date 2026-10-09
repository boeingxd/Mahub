# Caddy with the web app built in. Two stages:
# 1. Node builds the React app into plain files (web/dist).
# 2. The final image is just Caddy plus those files in /srv.
# Built from the repo root (see docker-compose.yml), so paths start with web/.

# --- Stage 1: build the web app ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: Caddy serving the files ---
FROM caddy:2
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /web/dist /srv
