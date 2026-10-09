FROM node:24-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# This target applies Prisma migrations using the runtime DATABASE_URL supplied by Coolify.
FROM deps AS migrator
COPY prisma ./prisma
COPY prisma.config.ts ./
ENV NODE_ENV=production
CMD ["./node_modules/.bin/prisma", "migrate", "deploy"]

FROM deps AS builder
COPY . .

# The Turnstile site key is public and must be embedded when Next.js builds the client bundle.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

# Build-only placeholders let Prisma generate its client without putting production secrets in image layers.
ENV NODE_ENV=production \
    DATABASE_URL=mysql://build:build@127.0.0.1:3306/checkinhub \
    AUTH_SECRET=build-only-not-a-real-secret \
    AUTH_TRUST_HOST=true \
    APP_BASE_URL=https://checkinhub.tech \
    UPLOAD_DIR=/tmp/checkinhub-uploads

RUN npx prisma generate \
  && npm run build

FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs \
  && mkdir -p /app/uploads \
  && chown nextjs:nodejs /app/uploads

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@next/env ./node_modules/@next/env
COPY --from=builder --chown=nextjs:nodejs /app/scripts/create-admin.mjs ./scripts/create-admin.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-pending-holds.mjs ./scripts/run-pending-holds.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-notifications.mjs ./scripts/run-notifications.mjs
COPY --from=builder --chown=nextjs:nodejs /app/scripts/run-retention.mjs ./scripts/run-retention.mjs

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
