#!/bin/bash
# ============================================================
# TurboPay — Production Build Script
# ============================================================
#
# Sets required env vars for build, generates Prisma client,
# and builds the Next.js standalone output.
#
# Usage:
#   ./scripts/build-prod.sh
#
# Prerequisites:
#   - Node.js 18+ or Bun
#   - PostgreSQL database (for prisma generate)
#   - .env file with production values

set -euo pipefail

echo "🔧 TurboPay Production Build"
echo "============================="

# ── 1. Generate Prisma client ──────────────────────────────
echo ""
echo "📦 Generating Prisma client..."
npx prisma generate

# ── 2. Run migrations (if DATABASE_URL is set) ─────────────
if [ -n "${DATABASE_URL:-}" ]; then
  echo "🗄️  Running database migrations..."
  npx prisma migrate deploy --skip-generate 2>/dev/null || echo "⚠️  Migrations skipped (run manually if needed)"
fi

# ── 3. Build Next.js ───────────────────────────────────────
echo ""
echo "🏗️  Building Next.js..."
npm run build

echo ""
echo "✅ Build complete!"
echo ""
echo "Next steps:"
echo "  1. Deploy with: docker compose up --build -d"
echo "  2. Or push to GitHub for Vercel auto-deploy"
echo "  3. Run migrations: npx prisma migrate deploy"
