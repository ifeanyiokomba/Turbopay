# syntax=docker/dockerfile:1.6

# ============================================================
# TURBOPAY — Production Docker image (multi-stage, standalone)
# ============================================================

# ---- Builder ----
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app

# Install dependencies first (cached layer).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source and build.
COPY . .
RUN bun run db:generate
RUN bun run build

# ---- Runner ----
FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Non-root user for security.
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone build output.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

# Health check via the /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["bun", "server.js"]
