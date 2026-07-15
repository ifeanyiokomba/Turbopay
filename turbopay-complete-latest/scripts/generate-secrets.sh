#!/bin/bash
# Generate all required secrets for TurboPay deployment

echo "🔐 TurboPay Secret Generator"
echo "============================="
echo ""

# Generate secrets
JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
PII_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
MONNIFY_WEBHOOK=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
CRON_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
ADMIN_PASSWORD=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p | tr -d '\n')

echo "Generated secrets (copy these to Vercel):"
echo ""
echo "JWT_SECRET=$JWT_SECRET"
echo "TURBOPAY_PII_KEY=$PII_KEY"
echo "TURBOPAY_MONNIFY_WEBHOOK_SECRET=$MONNIFY_WEBHOOK"
echo "CRON_SECRET=$CRON_SECRET"
echo "MASTER_ADMIN_EMAIL=admin@turbopay.ng"
echo "MASTER_ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo ""
echo "⚠️  Save these somewhere safe — they won't be shown again!"
