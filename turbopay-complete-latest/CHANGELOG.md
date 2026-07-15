# Changelog

All notable changes to the TurboPay platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-07-04

### Added
- **International Payments**: Outbound transfer service + route, FX quote GET endpoint
- **WebAuthn Passkeys**: Full implementation (register, authenticate, manage) with server-side challenge storage
- **Analytics Service**: Cohort analysis, trend aggregation, provider performance, dashboard summary
- **Configuration Service**: Audit-trail diffing, bulk export, version history
- **Compliance**: STR filing workflow, sanctions screening interface
- **Fraud Detection**: Behavioral pattern matching with 8 risk factors
- **Savings**: Interest accrual, auto-save execution, goal tracking
- **Investments**: Duration parsing, liquidate route
- **Referrals**: Campaign linkage, lookup route
- **Admin Routes**: Savings, investments, virtual cards
- **Pagination Helper**: Standardized pagination for all list endpoints
- **Health Check**: Database, Redis, memory, uptime monitoring
- **Documentation**: Architecture docs, API docs, deployment guide

### Fixed
- **Prisma Datasource**: Changed from SQLite to PostgreSQL for production
- **Advisory Locks**: Added per-user PostgreSQL advisory locks for AML race condition
- **TrustDevice**: Added ownership check to prevent arbitrary device trust
- **OTP Verification**: Timing-safe comparison via otp-verify.ts
- **Password Complexity**: Aligned reset-password with registration requirements
- **BillSwift Fees**: Wired fee calculation into pay route
- **Investment Duration**: Parse duration strings instead of hardcoded 90 days
- **MFA Token Return**: Gated on NODE_ENV for production security
- **Max Sessions**: Enforced 10 active sessions per user
- **Challenge Storage**: WebAuthn challenges stored server-side with TTL

### Security
- 9 auth hardening fixes (trustDevice, OTP timing, password complexity, rate limiting, etc.)
- WebAuthn passkeys for second-factor and passwordless authentication
- Per-user advisory locks preventing AML velocity check race conditions
- Timing-safe OTP comparison across all verification routes

### Infrastructure
- PostgreSQL migration support
- Docker Compose with 3 app replicas
- Redis shared state for rate limiting and caching
- Caddy reverse proxy with automatic TLS
- Cron job leader election via database locks

## [0.2.0] - 2026-06-29

### Added
- Initial codebase with all core domains
- Provider abstraction layer with 11 contracts
- Double-entry ledger engine
- Payment orchestrator (hold-confirm-reverse)
- BillSwift integration with Baxi adapter
- Virtual card system with encrypted PAN/CVV
- Savings and investment products
- Referral and voucher system
- Admin platform with 20+ modules
- Comprehensive test suite (153 tests)

### Security
- Session management with access + refresh tokens
- MFA with TOTP and backup codes
- Transaction PIN with brute-force lockout
- Rate limiting (Redis + in-memory fallback)
- CSRF protection
- Webhook HMAC verification
- PII encryption (AES-256-GCM)
- Comprehensive audit logging

## [0.1.0] - 2026-06-01

### Added
- Initial project setup
- Next.js 16 with App Router
- Prisma schema with 60+ models
- Provider interfaces and mock adapters
- Basic authentication flow
