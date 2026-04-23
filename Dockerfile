# syntax=docker/dockerfile:1.7

# ---- Builder ----
# Node 20 alpine is small; we only need OS build deps for the builder
# stage, not the runner.
FROM node:20-alpine AS builder
WORKDIR /app

# Install build-time OS deps (openssl needed by Prisma on alpine)
RUN apk add --no-cache openssl libc6-compat

# Copy manifests first so Docker caches the install layer whenever
# package-lock.json doesn't change.
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Full install (incl. devDeps) so `next build` has typescript etc.
RUN npm ci

# Generate the Prisma client into node_modules
RUN npx prisma generate

# Copy the source and build the standalone bundle
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- Runner ----
# poppler-utils ships pdftoppm, which we shell out to for the GPT-4o
# Vision PDF fallback. alpine's poppler-utils is ~8 MB.
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat poppler-utils tini \
    && addgroup -S reos && adduser -S reos -G reos

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Cloud Run injects PORT; default to 3000 for local `docker run`.
ENV PORT=3000

# The standalone output is a self-contained server.js + its own
# node_modules (only the bits Next determined it needs).
COPY --from=builder --chown=reos:reos /app/.next/standalone ./
COPY --from=builder --chown=reos:reos /app/.next/static ./.next/static
COPY --from=builder --chown=reos:reos /app/public ./public

# Prisma query engine binary — the standalone copier doesn't always
# pick these up correctly, so we drop them in explicitly.
COPY --from=builder --chown=reos:reos /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=reos:reos /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER reos
EXPOSE 3000

# tini reaps zombie pdftoppm children cleanly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
