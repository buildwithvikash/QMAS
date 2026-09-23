# QMAS API + web app in one image (the API serves the built React app, as WRL Tool Report does).
# Build:  docker build -t qmas .
# Run migrations first (same image):  docker run --env-file prod.env qmas node backend/scripts/migrate.js

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY packages/shared packages/shared
COPY frontend frontend
RUN npm -w @qmas/frontend run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    SERVE_WEB_DIST=/app/frontend/dist \
    PORT=4000
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --omit=optional -w @qmas/backend -w @qmas/shared --include-workspace-root --no-audit --no-fund && npm cache clean --force
COPY packages/shared packages/shared
COPY backend/src backend/src
COPY backend/db backend/db
COPY backend/scripts/migrate.js backend/scripts/create-admin.js backend/scripts/
COPY --from=build /app/frontend/dist frontend/dist

USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "backend/src/server.js"]
