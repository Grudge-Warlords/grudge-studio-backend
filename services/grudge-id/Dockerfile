# ═══════════════════════════════════════════════════════════════
# Grudge ID — Hardened Production Dockerfile
# Image: ~60MB (vs ~250MB before), non-root, zero npm/yarn bloat
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: Install deps (thrown away after) ─────────────────
FROM node:20-alpine AS deps
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# ── Stage 2: Development (optional, for local docker-compose) ─
FROM node:20-alpine AS development
WORKDIR /app/grudge-id
COPY package.json package-lock.json* ./
RUN npm install && ln -s /app/grudge-id/node_modules /app/node_modules
COPY shared ./shared
COPY src ./src
COPY public ./public
EXPOSE 3001
CMD ["npx", "nodemon", "src/index.js"]

# ── Stage 3: Production (final image) ─────────────────────────
FROM node:20-alpine AS production

# Security: update Alpine packages to patch CVEs (zlib etc)
RUN apk upgrade --no-cache \
    # Remove npm, yarn, corepack — not needed at runtime
    && npm uninstall -g npm yarn corepack 2>/dev/null; \
       rm -rf /usr/local/lib/node_modules/npm \
              /usr/local/lib/node_modules/corepack \
              /opt/yarn* \
              /usr/local/bin/npm /usr/local/bin/npx \
              /usr/local/bin/yarn /usr/local/bin/yarnpkg \
              /usr/local/bin/corepack \
              /tmp/* /root/.npm /root/.node-gyp

# Non-root user (node user is pre-created in node:alpine)
WORKDIR /app/grudge-id

# Copy only production node_modules from deps stage
COPY --from=deps --chown=node:node /build/node_modules ./node_modules

# Copy application code
COPY --chown=node:node shared ./shared
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node package.json ./

# Symlink for shared imports
RUN ln -s /app/grudge-id/node_modules /app/node_modules 2>/dev/null || true

# Run as non-root
USER node

# Healthcheck — Coolify/Docker uses this for container health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

EXPOSE 3001
CMD ["node", "src/index.js"]
