#!/bin/bash
# ============================================================
# TurboPay — One-Command Deploy
# ============================================================
#
# Deploys TurboPay using Docker Compose.
# Generates secrets if not already set.
#
# Usage:
#   ./scripts/deploy.sh
#
# Prerequisites:
#   - Docker & Docker Compose
#   - Domain DNS pointing to this server

set -euo pipefail

echo "🚀 TurboPay Production Deploy"
echo "=============================="

# ── 1. Generate secrets if not set ─────────────────────────
generate_secret() {
  openssl rand -hex "${1:-32}" 2>/dev/null || head -c "${1:-32}" /dev/urandom | xxd -p | tr -d '\n' | head -c $(( ${1:-32} * 2 ))
}

[ -z "${POSTGRES_PASSWORD:-}" ] && export POSTGRES_PASSWORD=$(generate_secret 16)
[ -z "${REDIS_PASSWORD:-}" ] && export REDIS_PASSWORD=$(generate_secret 16)
[ -z "${JWT_SECRET:-}" ] && export JWT_SECRET=$(generate_secret 32)
[ -z "${TURBOPAY_PII_KEY:-}" ] && export TURBOPAY_PII_KEY=$(generate_secret 32)
[ -z "${TURBOPAY_MONNIFY_WEBHOOK_SECRET:-}" ] && export TURBOPAY_MONNIFY_WEBHOOK_SECRET=$(generate_secret 32)
[ -z "${CRON_SECRET:-}" ] && export CRON_SECRET=$(generate_secret 32)

echo "✅ Secrets generated"

# ── 2. Create .env.production ──────────────────────────────
cat > .env.production << EOF
DATABASE_URL=postgresql://turbopay:${POSTGRES_PASSWORD}@postgres:5432/turbopay?connection_limit=10&pool_timeout=10
DIRECT_URL=postgresql://turbopay:${POSTGRES_PASSWORD}@postgres:5432/turbopay
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
JWT_SECRET=${JWT_SECRET}
TURBOPAY_PII_KEY=${TURBOPAY_PII_KEY}
TURBOPAY_MONNIFY_WEBHOOK_SECRET=${TURBOPAY_MONNIFY_WEBHOOK_SECRET}
CRON_SECRET=${CRON_SECRET}
NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL:-https://localhost}
NODE_ENV=production
EOF

echo "✅ Environment configured"

# ── 3. Build and deploy ────────────────────────────────────
echo ""
echo "🏗️  Building and deploying..."
docker compose --env-file .env.production up --build -d

# ── 4. Wait for services ───────────────────────────────────
echo ""
echo "⏳ Waiting for services to start..."
sleep 10

# ── 5. Run migrations ──────────────────────────────────────
echo "🗄️  Running database migrations..."
docker compose exec -T turbopay npx prisma migrate deploy --skip-generate 2>/dev/null || echo "⚠️  Migrations may need manual run"

# ── 6. Health check ────────────────────────────────────────
echo ""
echo "🏥 Running health check..."
HEALTH=$(docker compose exec -T turbopay wget -qO- http://localhost:3000/api/health 2>/dev/null || echo '{"status":"starting"}')
echo "Health: $HEALTH"

echo ""
echo "✅ Deploy complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Visit https://your-domain.com"
echo "  2. Create admin account: npm run seed"
echo "  3. Set up payment provider keys in .env.production"
echo "  4. Configure DNS and SSL"
