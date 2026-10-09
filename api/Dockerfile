# Two stages: the first compiles TypeScript (needs dev tools), the second is
# the small image that actually runs, with only production dependencies.

# --- Stage 1: build ---
FROM node:22-alpine AS build
WORKDIR /app
# Copy the package files first: Docker caches this layer, so `npm ci` only
# re-runs when dependencies change, not on every code edit.
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: run ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Don't run as root inside the container (least privilege).
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
