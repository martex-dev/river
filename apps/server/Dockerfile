# River server image. Build from the repository root:
#   docker build -f apps/server/Dockerfile -t river-server .
# Debian (glibc) because libsignal ships prebuilt binaries for glibc only.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/crypto/package.json packages/crypto/
COPY packages/release/package.json packages/release/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --omit=dev --workspace @river/server --include-workspace-root=false --ignore-scripts \
  && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    RIVER_HOST=0.0.0.0 \
    RIVER_PORT=8787 \
    RIVER_DATABASE_URL=sqlite:/data/river.sqlite \
    RIVER_ATTACHMENT_DIR=/data/attachments
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/protocol ./packages/protocol
COPY packages/crypto ./packages/crypto
COPY apps/server/package.json ./apps/server/package.json
COPY apps/server/src ./apps/server/src
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.RIVER_PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/src/main.ts"]
