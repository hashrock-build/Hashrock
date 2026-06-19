# Authoritative Colyseus game server. Build context = repo ROOT (it needs ../shared).
#   docker build -f server/Dockerfile -t hashrock-server .
FROM node:22-alpine
WORKDIR /app

# install deps first (layer cache) — tsx is the runtime, so dev deps stay in the image.
# npm install (not ci) so a slightly out-of-sync lockfile doesn't fail the build.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --no-audit --no-fund

# source: shared map-truth/items + server code (treasury secret is MOUNTED at runtime, never baked)
COPY shared/ ./shared/
COPY server/ ./server/

WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 2567
# tsx runs the TypeScript directly (top-level await + ESM + ../shared imports work as-is)
CMD ["npm", "start"]
