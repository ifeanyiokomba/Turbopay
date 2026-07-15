#!/bin/bash
# ============================================================
# TurboPay — Neon Database Setup
# ============================================================
#
# Run this after creating your Neon project.
# It will: generate secrets, create .env.local, run migrations.
#
# Usage:
#   ./scripts/setup-neon.sh "postgresql://neondb_owner:xxxx@ep-xxx.neon.tech/dbname?sslmode=require"

set -euo pipefail

DATABASE_URL="${1:?Usage: ./scripts/setup-neon.sh 'DATABASE_URL'}"

# Extract direct URL (replace pooler host with direct host)
DIRECT_URL=$(echo "$DATABASE_URL" | sed 's/@ep-/-direct.ep-/g')

echo "🗄️  TurboPay Neon Setup"
echo "======================="
echo ""
echo "Pooled URL: ${DATABASE_URL:0:50}..."
echo "Direct URL: ${DIRECT_URL:0:50}..."
echo ""

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
PII_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
MONNIFY_WEBHOOK=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
CRON_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
ADMIN_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p | tr -d '\n')

# Create .env.local
cat > .env.local << EOF
# TurboPay Environment — Generated $(date +%Y-%m-%d)
DATABASE_URL=$DATABASE_URL
DIRECT_URL=$DIRECT_URL
JWT_SECRET=$JWT_SECRET
TURBOPAY_PII_KEY=$PII_KEY
TURBOPAY_MONNIFY_WEBHOOK_SECRET=$MONNIFY_WEBHOOK_SECRET
CRON_SECRET=$CRON_SECRET
MASTER_ADMIN_EMAIL=admin@turbopay.ng
MASTER_ADMIN_PASSWORD=$ADMIN_PASSWORD
NODE_ENV=development
EOF

echo "✅ .env.local created"
echo ""

# Run Prisma
echo "📦 Generating Prisma client..."
npx prisma generate

echo "🗄️  Pushing schema to database..."
npx prisma db push --accept-data-loss

echo ""
echo "✅ Database ready!"
echo ""
echo "🔑 Your secrets (save these for Vercel):"
echo "=========================================="
echo "JWT_SECRET=$JWT_SECRET"
echo "TURBOPAY_PII_KEY=$PII_KEY"
echo "TURBOPAY_MONNIFY_WEBHOOK_SECRET=$MONNIFY_WEBHOOK"
echo "CRON_SECRET=$CRON_SECRET"
echo "MASTER_ADMIN_EMAIL=admin@turbopay.ng"
echo "MASTER_ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo "DATABASE_URL=$DATABASE_URL"
echo "DIRECT_URL=$DIRECT_URL"
echo ""
echo "🚀 Next: npm run dev"
