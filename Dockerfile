# ---- Stage 1: Base ----
FROM node:22-alpine AS base

RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app

# ---- Stage 2: Dependencies ----
FROM base AS deps

# Native build tools for sharp, @napi-rs/canvas, better-sqlite3
RUN apk add --no-cache python3 build-base g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/

# Phase 5a: better-sqlite3 needs build scripts approved in onlyBuiltDependencies
RUN pnpm install --frozen-lockfile

# ---- Stage 3: Builder ----
FROM base AS builder

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .

RUN pnpm build

# ---- Stage 4: Runner ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3001

# Runtime deps: libc6-compat for Node, Cairo for images, libstdc++ for better-sqlite3
RUN apk add --no-cache libc6-compat cairo pango jpeg giflib librsvg libstdc++

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Phase 5a: Copy better-sqlite3 native addon from deps stage.
# serverExternalPackages includes it in standalone output but not the .node file.
# The pnpm virtual store path includes the exact version.
COPY --from=deps /app/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node /tmp/better_sqlite3.node
RUN BSQLITE3_DIR=$(find /app/node_modules/.pnpm -maxdepth 1 -name 'better-sqlite3@*' -type d | head -1)/node_modules/better-sqlite3/build/Release && \
    mkdir -p "$BSQLITE3_DIR" && \
    cp /tmp/better_sqlite3.node "$BSQLITE3_DIR/" && \
    chown -R nextjs:nodejs "$(find /app/node_modules/.pnpm -maxdepth 1 -name 'better-sqlite3@*' -type d | head -1)"

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
