# Build from the repository root so the shared contracts package is in context:
#   docker build -f services/dispatch-optimizer-service/Dockerfile -t gridpulse-optimizer .

# ---- build: compile shared contracts and the optimiser ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY services/price-ingest-service/package.json services/price-ingest-service/
COPY services/dispatch-optimizer-service/package.json services/dispatch-optimizer-service/
COPY simulator/package.json simulator/
RUN npm ci -w @gridpulse/shared -w @gridpulse/dispatch-optimizer-service --no-audit --no-fund
COPY packages/shared packages/shared
COPY services/dispatch-optimizer-service services/dispatch-optimizer-service
RUN npm run build -w @gridpulse/shared -w @gridpulse/dispatch-optimizer-service

# ---- runtime: production dependencies and compiled output only ----
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY services/price-ingest-service/package.json services/price-ingest-service/
COPY services/dispatch-optimizer-service/package.json services/dispatch-optimizer-service/
COPY simulator/package.json simulator/
RUN npm ci -w @gridpulse/shared -w @gridpulse/dispatch-optimizer-service --omit=dev --no-audit --no-fund
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/services/dispatch-optimizer-service/dist services/dispatch-optimizer-service/dist
USER node
CMD ["node", "services/dispatch-optimizer-service/dist/index.js"]
