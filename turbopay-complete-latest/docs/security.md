# TurboPay Security Guide

## Overview

TurboPay implements defense-in-depth security across authentication, authorization, data protection, and operational security. This guide documents all security measures and their configuration.

## Authentication

### Session Management
- **Access tokens**: 256-bit random, SHA-256 hashed at rest, 24h TTL
- **Refresh tokens**: 256-bit random, 30d TTL, rotated on use
- **Dual transport**: HttpOnly cookie (browser) + Bearer header (iframe/API)
- **Token invalidation**: Logout clears both access and refresh tokens

### Password Security
- **Algorithm**: scrypt (16-byte salt, 64-byte key)
- **Timing-safe comparison**: `crypto.timingSafeEqual` prevents timing attacks
- **Dummy hash**: Pre-computed hash for non-existent users prevents enumeration
- **Breach checking**: HaveIBeenPwned k-anonymity integration

### Transaction PIN
- 4-digit PIN required for every debit operation
- Scrypt hashed (same primitive as passwords)
- Brute-force lockout: 5 failures → 15-minute lock
- Weak PIN blocklist (sequential, repeated, common patterns)

### Multi-Factor Authentication (MFA)
- **TOTP**: RFC 6238, SHA1, 30s period, 6 digits
- **Replay prevention**: `mfaLastStep` tracking rejects reused codes
- **Backup codes**: 8 codes, scrypt-hashed, encrypted at rest
- **Setup flow**: Two-step (generate → prove enrollment)
- **Disable**: Accepts TOTP or backup code (last-resort recovery)

### WebAuthn Passkeys
- **Registration**: Server-side challenge with 5min TTL + one-time use
- **Authentication**: Both second-factor and passwordless modes
- **Counter tracking**: Detects cloned authenticators
- **Encrypted storage**: Credentials stored in database

## Authorization

### Role-Based Access Control (RBAC)
- **Roles**: USER, ADMIN (extensible via Role model)
- **Permissions**: JSON array per role, checked via `requirePermission()`
- **Route protection**: Middleware checks session presence, routes check roles

### Admin Access
- `requireAdmin()` function enforces ADMIN role
- All admin routes require authenticated session + ADMIN role
- Audit logging on every admin action

## Data Protection

### Encryption at Rest
- **PII**: AES-256-GCM for BVN, NIN, TOTP secrets, card PANs/CVV
- **Provider credentials**: AES-256-GCM, decrypted on-demand with 60s cache
- **Key management**: `TURBOPAY_PII_KEY` environment variable (>= 16 chars)
- **No hardcoded keys**: Fails closed in production if key is missing

### Password Hashing
- **Algorithm**: scrypt with 16-byte random salt
- **Format**: `scrypt$<salt>$<hash>`
- **Timing-safe**: `crypto.timingSafeEqual` for all comparisons

### Token Security
- **Generation**: `crypto.randomBytes(32)` (256-bit CSPRNG)
- **Storage**: SHA-256 hash in database
- **OTP generation**: `crypto.randomInt(100000, 1000000)` (CSPRNG)

## Network Security

### CSRF Protection
- Origin validation on all state-changing API requests
- Bearer-token requests exempt (inherently CSRF-immune)
- Webhook/cron routes exempt (use HMAC/secret)

### Rate Limiting
- Redis-backed sliding window (in-memory fallback)
- Per-IP, per-user, and per-identifier scoping
- RFC 6585 compliant (Retry-After header)

### Security Headers
- CSP: `default-src 'self'`, `frame-ancestors 'self'`, `base-uri 'self'`
- HSTS: 2-year max-age with preload
- X-Frame-Options: DENY (production)
- X-Content-Type-Options: nosniff

### Webhook Verification
- HMAC-SHA256 signature validation
- Provider-specific secret configuration
- Idempotent processing via WebhookEvent table

## Financial Security

### Advisory Locks
- Per-user PostgreSQL advisory locks (`pg_advisory_xact_lock`)
- Serializes concurrent debits to prevent AML velocity bypass
- Auto-released on transaction commit/rollback

### Circuit Breaker
- Distributed state via Redis (shared across instances)
- 5 consecutive failures → OPEN (30s cooldown)
- 2 successes in HALF_OPEN → CLOSED

### Transaction Safety
- Hold-Confirm-Reverse pattern for provider-backed debits
- Atomic database transactions with conditional updates
- Idempotent operations via IdempotencyRecord
- Reversals instead of edits

## Audit Trail

Every security-relevant action is logged to the `AuditLog` table:
- Authentication events (login, logout, MFA)
- Financial operations (debit, credit, transfer)
- Admin actions (config changes, user management)
- Security events (device trust, step-up, risk flags)

### Audit Log Indexes
- `@@index([userId])` — user activity
- `@@index([category])` — category filtering
- `@@index([severity])` — severity filtering
- `@@index([createdAt])` — time-range queries
- `@@index([userId, category, createdAt])` — composite queries

## Compliance

### KYC Tiers
| Tier | Single TX | Daily TX | Balance Cap |
|------|-----------|----------|-------------|
| 1 | ₦50,000 | ₦150,000 | ₦500,000 |
| 2 | ₦500,000 | ₦1,000,000 | ₦5,000,000 |
| 3 | ₦5,000,000 | ₦10,000,000 | Unlimited |

### AML Monitoring
- Velocity rules (configurable window + threshold)
- Large amount detection
- Rapid transfer detection
- Auto-freeze on HIGH severity
- Compliance case auto-creation

### STR Filing
- `complianceCases.fileSTR()` for suspicious transaction reports
- Full audit trail with indicators and metadata
- Admin dashboard for case management

## Security Configuration

### Required Environment Variables
```
TURBOPAY_PII_KEY=<64-char-hex>    # AES-256-GCM key for PII encryption
CRON_SECRET=<random-string>       # Cron job authentication
DATABASE_URL=postgresql://...     # Database connection
REDIS_URL=redis://...             # Distributed state (recommended)
```

### Optional Security Variables
```
TURBOPAY_MONNIFY_WEBHOOK_SECRET=<hex>  # Webhook HMAC secret
GOOGLE_CLIENT_ID=<string>              # Google OAuth
WEBAUTHN_RP_ID=<string>               # WebAuthn relying party
WEBAUTHN_ORIGIN=<string>              # WebAuthn origin URL
```

## Security Checklist

- [ ] `TURBOPAY_PII_KEY` set and >= 16 characters
- [ ] `CRON_SECRET` set
- [ ] `NEXT_PUBLIC_APP_URL` set for production
- [ ] Redis configured for multi-instance deployments
- [ ] HTTPS enabled via Caddy
- [ ] Database connections use SSL
- [ ] Environment variables not committed to git
- [ ] `.env` in `.gitignore`
- [ ] Webhook secrets configured per provider
- [ ] Admin accounts have strong passwords
- [ ] MFA enabled for admin accounts
