FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY apps/scheduler/package.json ./apps/scheduler/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN --mount=type=cache,id=yoyo-pnpm,target=/pnpm/store pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
COPY tests ./tests
COPY contracts ./contracts
COPY tsconfig.json prisma.config.ts ./
RUN pnpm build

FROM node:24.14.1-bookworm-slim@sha256:b506e7321f176aae77317f99d67a24b272c1f09f1d10f1761f2773447d8da26c
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
USER node
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/apps/api/src/main.js"]
