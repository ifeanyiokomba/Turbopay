# TurboPay Deployment Guide

## Deployment Strategy

### Primary: Vercel (recommended for startups)

Vercel is the primary deployment target. It requires zero DevOps — push to `main` and Vercel builds, deploys, and serves your app with automatic SSL, preview deployments on PRs, and edge caching.

**What Vercel handles:** App hosting, serverless functions, cron jobs (via `vercel.json`), automatic SSL, preview environments, GitHub integration.

**What you provide externally:**

| Service | Recommended | Free tier |
|---------|------------|-----------|
| PostgreSQL | Neon or Supabase | Yes |
| Redis | Upstash (serverless) | Yes |
| Email | Resend | Yes (100/day) |
| SMS | Termii | Pay-as-you-go |

**Environment variables on Vercel:**
Set these in the Vercel dashboard under Settings → Environment Variables. Use Vercel's encrypted storage — never commit secrets to git.

**When to outgrow Vercel:** If you need persistent WebSocket connections, background workers that run longer than Vercel's execution limits, or custom infrastructure (e.g., a dedicated Redis cluster for high-throughput rate limiting), migrate to the Docker path below.

### Alternative: Self-Hosted (Docker)

Available when you outgrow Vercel or need full infrastructure control.

- Docker Compose with app replicas, PostgreSQL, Redis, Caddy
- Horizontal scaling via `docker compose up --scale turbopay=N`
- Kubernetes manifests available in `k8s/` directory
- Automated backup/rollback/deploy scripts in `scripts/`

**Decision:** Start on Vercel. Migrate to Docker only when you have the users and revenue to justify the ops overhead.

## Prerequisites

- Docker & Docker Compose
- PostgreSQL 16 (or Docker)
- Redis 7 (optional for dev, required for production)
- Node.js 18+ or Bun

## Quick Start (Docker)

```bash
# Clone the repository
git clone https://github.com/ifeanyiokomba/Turbocore.git
cd Turbocore

# Set required environment variables
export TURBOPAY_PII_KEY=$(openssl rand -hex 32)
export TURBOPAY_MONNIFY_WEBHOOK_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)
export REDIS_URL=redis://redis:6379

# Start all services
docker compose up --build -d

# Run database migrations
docker compose exec turbopay npx prisma migrate deploy

# Verify health
curl http://localhost:3000/api/health
```

## Services

| Service | Port | Purpose |
|---------|------|---------|
| turbopay | 3000 | Application server (3 replicas) |
| postgres | 5432 | PostgreSQL database |
| redis | 6379 | Cache, rate limiting, sessions |
| caddy | 80, 443 | Reverse proxy + load balancer |

## CDN & Security

### CDN Strategy (Vercel)

TurboPay uses Vercel's built-in Edge Network for CDN:

- **Static assets** (JS, CSS, images): Automatically cached at the edge with immutable headers (`/_next/static/*`).
- **Server-rendered pages**: Cached via ISR (Incremental Static Regeneration) where applicable.
- **API routes**: NOT cached by default — dynamic by nature. Add `Cache-Control` headers explicitly for cacheable API responses.
- **Edge middleware**: Runs at the edge before hitting the origin, providing low-latency auth/CSRF checks.

For the Docker path, Caddy handles static asset serving and can be configured with cache headers.

### CORS Policy

TurboPay is a **same-origin application** — the frontend and API share the same domain. Cross-origin requests are not needed for normal operation.

**Policy:**
- No `Access-Control-Allow-Origin` headers are set (not needed for same-origin).
- CSRF protection is enforced via origin validation in middleware on all state-changing API requests (`POST`, `PUT`, `PATCH`, `DELETE`).
- Bearer-token requests are exempt from CSRF (inherently immune — tokens aren't auto-sent by browsers).
- Webhook routes use HMAC signatures, not cookies — CSRF doesn't apply.
- If you need to expose API endpoints to a separate frontend (e.g., a mobile app), add CORS headers in `next.config.ts` or at the reverse proxy level, restricting to known origins.

### HTTPS Enforcement

- **Vercel**: Automatic SSL via Let's Encrypt. No configuration needed.
- **Docker (Caddy)**: Caddy auto-provisions TLS when listening on port 443 with a valid domain.
- **HSTS**: Production enforces `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2 years).
- **Dev**: HSTS is disabled to allow HTTP on localhost.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `DIRECT_URL` | Direct PostgreSQL URL (bypasses PgBouncer) |
| `TURBOPAY_PII_KEY` | AES-256-GCM key for PII encryption (>= 16 chars) |
| `CRON_SECRET` | Secret for cron job authentication |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection string | In-memory fallback |
| `WEBAUTHN_RP_ID` | WebAuthn relying party ID | `localhost` |
| `WEBAUTHN_ORIGIN` | WebAuthn origin URL | `https://{RP_ID}` |
| `NEXT_PUBLIC_APP_URL` | Public app URL for CSRF | `http://localhost:3000` |
| `SENTRY_ORG` | Sentry organization | - |
| `SENTRY_PROJECT` | Sentry project name | `turbopay` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | - |
| `MAINTENANCE_MODE` | Set to `true` to block non-admin traffic | `false` |
| `BLOCKED_IPS` | Comma-separated IPs to reject | - |
| `ALLOWED_IPS` | Comma-separated IPs that bypass all checks | - |

## Database Setup

### Initial Setup

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Seed default data (optional)
bun run scripts/seed.ts
```

### Migrations

```bash
# Create a new migration
npx prisma migrate dev --name <migration_name>

# Deploy migrations
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

## Scaling

### Horizontal Scaling

```bash
# Scale app instances
docker compose up --scale turbopay=5

# Or modify docker-compose.yml
deploy:
  replicas: 5
```

### Database Connection Pooling

The application uses Prisma's built-in connection pool. Configure via `DATABASE_URL`:

```
DATABASE_URL=postgresql://user:pass@host:5432/db?connection_limit=10&pool_timeout=10
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/api/health
```

Returns:
- Database connectivity + latency
- Redis connectivity (if configured)
- Memory usage
- Uptime

### Structured Logging

All logs are JSON-formatted to stdout/stderr:

```json
{
  "ts": "2026-07-04T12:00:00Z",
  "level": "info",
  "msg": "USER_LOGIN",
  "meta": { "userId": "...", "ip": "..." },
  "requestId": "..."
}
```

### Sentry Integration

Set `SENTRY_ORG` and `SENTRY_PROJECT` for error tracking. Source maps are uploaded and deleted from build output.

## Backup Strategy

### Automated Backups

```bash
# Run automated backup
./scripts/backup.sh

# Run backup with verification and S3 upload
./scripts/backup.sh --full

# Apply retention policy only
./scripts/backup.sh --retention
```

### Manual Backups

```bash
# Daily backup
docker compose exec postgres pg_dump -U turbopay turbopay > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T postgres psql -U turbopay turbopay < backup.sql
```

### Redis Backups

```bash
# Trigger BGSAVE
docker compose exec redis redis-cli BGSAVE
```

## Rollback Procedures

### Automated Rollback

```bash
# Rollback to previous commit
./scripts/rollback.sh

# Rollback to specific commit
./scripts/rollback.sh --commit <hash>

# Rollback database only
./scripts/rollback.sh --database

# Full rollback (app + database)
./scripts/rollback.sh --full
```

### Manual Rollback

```bash
# Rollback to previous version
git checkout <previous_commit>
docker compose up --build -d
```

### Database Rollback

```bash
# Create a rollback migration
npx prisma migrate dev --name rollback_<feature>

# Or restore from backup
docker compose exec -T postgres psql -U turbopay turbopay < backup.sql
```

## Security Checklist

- [ ] `TURBOPAY_PII_KEY` is set and >= 16 characters
- [ ] `CRON_SECRET` is set
- [ ] `NEXT_PUBLIC_APP_URL` is set for production
- [ ] Redis is configured for multi-instance deployments
- [ ] HTTPS is enabled via Caddy
- [ ] Database connections use SSL
- [ ] Environment variables are not committed to git
- [ ] `.env` is in `.gitignore`

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL is running
docker compose exec postgres pg_isready -U turbopay

# Check connection
docker compose exec postgres psql -U turbopay turbopay -c "SELECT 1"
```

### Redis Connection Issues

```bash
# Check Redis is running
docker compose exec redis redis-cli ping

# Check memory usage
docker compose exec redis redis-cli info memory
```

### Application Issues

```bash
# Check app logs
docker compose logs turbopay

# Check health endpoint
curl http://localhost:3000/api/health
```

---

## Founder Action Checklist

Everything that must be completed **outside the codebase** before launch. Ordered by dependency — do each step before moving to the next.

### Phase 1: Infrastructure (Week 1)

| # | Action | Where | Est. Time | Dependencies |
|---|--------|-------|-----------|--------------|
| 1 | **Create Vercel account** and connect GitHub repo | [vercel.com](https://vercel.com) | 15 min | GitHub repo |
| 2 | **Provision PostgreSQL** — Neon or Supabase (free tier) | [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com) | 15 min | — |
| 3 | **Provision Redis** — Upstash (serverless, free tier) | [upstash.com](https://upstash.com) | 10 min | — |
| 4 | **Set all environment variables** in Vercel dashboard | Vercel → Settings → Environment Variables | 30 min | Steps 1-3 |
| 5 | **Run Prisma migrations** against production DB | `npx prisma migrate deploy` | 5 min | Steps 2, 4 |
| 6 | **Deploy to Vercel** — push to `main` branch | Automatic on push | 5 min | Steps 1-4 |

### Phase 2: Authentication (Week 1)

| # | Action | Where | Est. Time | Dependencies |
|---|--------|-------|-----------|--------------|
| 7 | **Set up Google OAuth** — see guide below | Google Cloud Console | 30 min | Step 1 (domain) |
| 8 | **Generate encryption key** — `openssl rand -hex 32` | Terminal | 2 min | — |
| 9 | **Set TURBOPAY_PII_KEY** in Vercel | Vercel dashboard | 2 min | Step 8 |

### Phase 3: Payment Providers (Week 2)

| # | Action | Where | Est. Time | Dependencies |
|---|--------|-------|-----------|--------------|
| 10 | **Register with Monnify** — virtual accounts + wallet funding | [monnify.com](https://monnify.com) | 1-2 weeks | Business registration |
| 11 | **Register with Paystack** — local transfers (NIP) | [paystack.com](https://paystack.com) | 1-2 weeks | Business registration |
| 12 | **Register with Baxi** — bill payments | [baxi.africa](https://baxi.africa) | 1-2 weeks | Business registration |
| 13 | **Register with Dojah** — KYC (NIN/BVN verification) | [dojah.io](https://dojah.io) | 3-5 days | — |
| 14 | **Register with Termii** — SMS (OTP, notifications) | [termii.com](https://termii.com) | 3-5 days | — |
| 15 | **Register with Resend** — transactional email | [resend.com](https://resend.com) | 5 min | — |
| 16 | **Set webhook secrets** in Vercel for each provider | Vercel dashboard | 15 min | Steps 10-15 |

### Phase 4: Business & Compliance (Weeks 2-4)

| # | Action | Where | Est. Time | Dependencies |
|---|--------|-------|-----------|--------------|
| 17 | **Register business** — CAC (Corporate Affairs Commission) | [cac.gov.ng](https://cac.gov.ng) | 2-4 weeks | — |
| 18 | **Open business bank account** | Your bank | 1-2 weeks | Step 17 |
| 19 | **Apply for NIBSS e-BillsPay** — for Remita/Quickteller | [nibss-plc.com.ng](https://nibss-plc.com.ng) | 4-8 weeks | Step 17 |
| 20 | **Register for NDPR** — Nigeria Data Protection Regulation | [ndpc.gov.ng](https://ndpc.gov.ng) | 2-4 weeks | Step 17 |
| 21 | **Set up privacy policy** — update `/privacy` page with real business info | In-app | 2 hours | Step 17 |

### Phase 5: Domain & DNS (Week 1)

| # | Action | Where | Est. Time | Dependencies |
|---|--------|-------|-----------|--------------|
| 22 | **Buy domain** (e.g., turbopay.ng) | Namecheap, Whogohost, or GoDaddy | 10 min | — |
| 23 | **Configure DNS** — point to Vercel | Domain registrar DNS panel | 15 min | Steps 1, 22 |
| 24 | **Verify domain** in Vercel | Vercel → Settings → Domains | 5 min | Step 23 |

### Phase 6: Monitoring (Week 1)

| # | Action | Where | Est. Time | Dependencies |
|---|--------|-------|-----------|--------------|
| 25 | **Create Sentry account** — error tracking | [sentry.io](https://sentry.io) | 10 min | — |
| 26 | **Set SENTRY_ORG and SENTRY_PROJECT** in Vercel | Vercel dashboard | 5 min | Step 25 |
| 27 | **Set up UptimeRobot** — uptime monitoring | [uptimerobot.com](https://uptimerobot.com) | 10 min | Step 24 |

---

## Google OAuth Production Setup

### Step 1: Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable **Google+ API** and **People API**
4. Go to **APIs & Services → Credentials**
5. Create **OAuth 2.0 Client ID** (Web application)
6. Set **Authorized redirect URIs**:
   - `https://turbopay.okomba.com/api/auth/google` (production)
   - `http://localhost:3000/api/auth/google` (development)
7. Copy the **Client ID**

### Step 2: Vercel Environment Variables

| Variable | Value | Environment |
|----------|-------|-------------|
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Your Client ID from step 1 | Production, Preview |
| `GOOGLE_CLIENT_ID` | Same Client ID | Production |

### Step 3: DNS Configuration

For Vercel, add these DNS records at your registrar:

| Type | Name | Value |
|------|------|-------|
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |
| CNAME | api | cname.vercel-dns.com |

### Step 4: Custom Domain on Vercel

1. Vercel → Your project → Settings → Domains
2. Add `turbopay.okomba.com`
3. Vercel provisions SSL automatically (Let's Encrypt)
4. Verify DNS propagation: `dig turbopay.okomba.com`
