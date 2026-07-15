# TurboPay — Production Deployment Guide

## Quick Deploy (Vercel — Recommended)

### Step 1: Push to GitHub

```bash
cd turbopay-complete-latest
git init
git add .
git commit -m "Initial TurboPay deployment"
git remote add origin https://github.com/your-org/turbopay.git
git push -u origin main
```

### Step 2: Connect to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Import your GitHub repository
3. Framework: **Next.js** (auto-detected)
4. Root directory: `turbopay-complete-latest`
5. Click **Deploy**

### Step 3: Set Environment Variables

In Vercel Dashboard → Settings → Environment Variables, add:

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | Production |
| `DIRECT_URL` | `postgresql://user:pass@host:5432/db` | Production |
| `JWT_SECRET` | `openssl rand -hex 32` | Production |
| `TURBOPAY_PII_KEY` | `openssl rand -hex 32` | Production |
| `TURBOPAY_MONNIFY_WEBHOOK_SECRET` | `openssl rand -hex 32` | Production |
| `CRON_SECRET` | `openssl rand -hex 32` | Production |
| `NEXT_PUBLIC_APP_URL` | `https://your-domain.com` | Production |
| `REDIS_URL` | `redis://:password@host:6379` | Production |

### Step 4: Set Up Database

```bash
# Using Neon, Supabase, or any PostgreSQL provider
# Run migrations
npx prisma migrate deploy

# Seed admin user
npm run seed
```

### Step 5: Configure Domain

1. In Vercel → Settings → Domains, add your custom domain
2. Update `NEXT_PUBLIC_APP_URL` to match
3. SSL is automatic

---

## Docker Deploy (Self-Hosted)

### Prerequisites

- Docker & Docker Compose
- Domain with DNS pointing to your server

### Step 1: Generate Secrets

```bash
export POSTGRES_PASSWORD=$(openssl rand -hex 16)
export REDIS_PASSWORD=$(openssl rand -hex 16)
export TURBOPAY_PII_KEY=$(openssl rand -hex 32)
export TURBOPAY_MONNIFY_WEBHOOK_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)
export JWT_SECRET=$(openssl rand -hex 32)
```

### Step 2: Create `.env.production`

```bash
cat > .env.production << EOF
DATABASE_URL=postgresql://turbopay:${POSTGRES_PASSWORD}@postgres:5432/turbopay?connection_limit=10&pool_timeout=10
DIRECT_URL=postgresql://turbopay:${POSTGRES_PASSWORD}@postgres:5432/turbopay
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
JWT_SECRET=${JWT_SECRET}
TURBOPAY_PII_KEY=${TURBOPAY_PII_KEY}
TURBOPAY_MONNIFY_WEBHOOK_SECRET=${TURBOPAY_MONNIFY_WEBHOOK_SECRET}
CRON_SECRET=${CRON_SECRET}
NEXT_PUBLIC_APP_URL=https://your-domain.com
NODE_ENV=production
EOF
```

### Step 3: Update Caddyfile

```bash
cat > Caddyfile << 'EOF'
your-domain.com {
  encode gzip zstd
  reverse_proxy turbopay:3000 {
    header_up Host {host}
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto {scheme}
    header_up X-Real-IP {remote_host}
  }
}
EOF
```

### Step 4: Deploy

```bash
docker compose --env-file .env.production up --build -d
```

### Step 5: Initialize Database

```bash
# Run migrations inside the container
docker compose exec turbopay npx prisma migrate deploy

# Seed data
docker compose exec turbopay bun run scripts/seed.ts
```

### Step 6: Verify

```bash
# Check health
curl https://your-domain.com/api/health

# Check logs
docker compose logs -f turbopay
```

---

## Post-Deployment Checklist

- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Admin login works with seeded credentials
- [ ] Customer registration works
- [ ] Test a payment flow end-to-end
- [ ] Webhook endpoints are accessible
- [ ] Sentry error tracking is receiving events
- [ ] Monitoring dashboards are set up
- [ ] Backup strategy is configured for PostgreSQL

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `DIRECT_URL` | Yes | — | Direct PostgreSQL URL (bypasses pooler) |
| `JWT_SECRET` | Yes | — | JWT signing secret |
| `TURBOPAY_PII_KEY` | Prod | — | AES-256-GCM key for PII encryption |
| `TURBOPAY_MONNIFY_WEBHOOK_SECRET` | Prod | — | Monnify webhook HMAC secret |
| `CRON_SECRET` | Prod | — | Cron job authentication secret |
| `REDIS_URL` | Prod | — | Redis connection string |
| `NEXT_PUBLIC_APP_URL` | Yes | — | Public URL of the application |
| `NODE_ENV` | — | `development` | `production` for live |
| `PORT` | — | `3000` | Server port |
| `HOST` | — | `0.0.0.0` | Server host |

### Payment Provider Keys (Optional)

| Variable | Provider |
|----------|----------|
| `PAYSTACK_SECRET_KEY` | Paystack |
| `PAYSTACK_PUBLIC_KEY` | Paystack |
| `FLUTTERWAVE_CLIENT_ID` | Flutterwave |
| `FLUTTERWAVE_CLIENT_SECRET` | Flutterwave |
| `MONNIFY_API_KEY` | Monnify |
| `MONNIFY_API_SECRET` | Monnify |

---

## Troubleshooting

### Build fails with env validation error

Set required env vars before building:
```bash
export DATABASE_URL="postgresql://..."
export JWT_SECRET="$(openssl rand -hex 32)"
npm run build
```

### Database connection refused

Ensure PostgreSQL is running and accessible:
```bash
docker compose ps postgres
docker compose logs postgres
```

### Health check returns 503

Check database connectivity:
```bash
docker compose exec turbopay npx prisma db push --accept-data-loss
```
