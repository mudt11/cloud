# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && \
    rm -f migrations/*.js migrations/*.d.ts migrations/*.js.map && \
    npx tsc migrations/*.ts --outDir migrations --module commonjs --target ES2022 --esModuleInterop --declaration false --skipLibCheck

FROM node:22-alpine AS runner
WORKDIR /app

ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3004 \
    SERVICE_NAME=notification \
    TZ=UTC

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations/*.js ./migrations/

RUN chown -R node:node /app
USER node

EXPOSE 3004

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3004) + '/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
