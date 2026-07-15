#!/usr/bin/env bash
# ============================================================
# TurboPay — Vercel Staging Setup Script
# ============================================================
#
# Prerequisites:
#   1. Vercel CLI installed: `bun add -g vercel`
#   2. Logged in: `vercel login`
#   3. Link to your Vercel project: `vercel link`
#
# Usage:
#   chmod +x scripts/setup-vercel.sh
#   ./scripts/setup-vercel.sh
#
# This script:
#   - Validates required environment variables
#   - Sets them on Vercel (preview environment)
#   - Runs initial deployment to verify everything works
# ============================================================

set -euo pipefail

echo "=== TurboPay Vercel Staging Setup ==="
echo ""

# ── Check prerequisites ──────────────────────────────────────
if ! command -v vercel &>/dev/null; then
  echo "ERROR: Vercel CLI not found. Install with: bun add -g vercel"
  exit 1
fi

if [ ! -f ".vercel/project.json" ]; then
  echo "ERROR: Not linked to a Vercel project. Run: vercel link"
  exit 1
fi

# ── Validate required env vars ───────────────────────────────
REQUIRED_VARS=(
  "DATABASE_URL"
  "DIRECT_URL"
  "TURBOPAY_PII_KEY"
  "TURBOPAY_MONNIFY_WEBHOOK_SECRET"
  "CRON_SECRET"
  "NEXT_PUBLIC_APP_URL"
)

echo "Checking required environment variables..."
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "ERROR: Missing required environment variables:"
  for var in "${MISSING[@]}"; do
    echo "  - $var"
  done
  echo ""
  echo "Set them in your shell or .env file before running this script."
  echo "See .env.staging.example for reference."
  exit 1
fi

echo "All required variables present."
echo ""

# ── Set environment variables on Vercel ──────────────────────
echo "Setting environment variables on Vercel (preview/staging)..."

# Database
vercel env add DATABASE_URL preview <<< "$DATABASE_URL"
vercel env add DIRECT_URL preview <<< "$DIRECT_URL"

# Redis (optional — set if using)
if [ -n "${REDIS_URL:-}" ]; then
  vercel env add REDIS_URL preview <<< "$REDIS_URL"
fi

# Security keys
vercel env add TURBOPAY_PII_KEY preview <<< "$TURBOPAY_PII_KEY"
vercel env add TURBOPAY_MONNIFY_WEBHOOK_SECRET preview <<< "$TURBOPAY_MONNIFY_WEBHOOK_SECRET"
vercel env add CRON_SECRET preview <<< "$CRON_SECRET"

# Application URL
vercel env add NEXT_PUBLIC_APP_URL preview <<< "$NEXT_PUBLIC_APP_URL"

# WebAuthn (optional)
if [ -n "${WEBAUTHN_RP_ID:-}" ]; then
  vercel env add WEBAUTHN_RP_ID preview <<< "$WEBAUTHN_RP_ID"
fi
if [ -n "${WEBAUTHN_ORIGIN:-}" ]; then
  vercel env add WEBAUTHN_ORIGIN preview <<< "$WEBAUTHN_ORIGIN"
fi

# Sentry (optional)
if [ -n "${SENTRY_ORG:-}" ]; then
  vercel env add SENTRY_ORG preview <<< "$SENTRY_ORG"
fi
if [ -n "${SENTRY_PROJECT:-}" ]; then
  vercel env add SENTRY_PROJECT preview <<< "$SENTRY_PROJECT"
fi

echo ""
echo "Environment variables set."
echo ""

# ── Deploy to staging ────────────────────────────────────────
echo "Deploying to Vercel (preview)..."
vercel --yes

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Check the deployment URL above"
echo "  2. Run database migrations: vercel env pull .env.local && bun run db:deploy"
echo "  3. Configure your custom domain in Vercel Dashboard → Settings → Domains"
echo "  4. Set up GitHub secrets for CI/CD:"
echo "     - VERCEL_TOKEN: https://vercel.com/account/tokens"
echo "     - VERCEL_ORG_ID: cat .vercel/project.json | jq .orgId"
echo "     - VERCEL_PROJECT_ID: cat .vercel/project.json | jq .projectId"
