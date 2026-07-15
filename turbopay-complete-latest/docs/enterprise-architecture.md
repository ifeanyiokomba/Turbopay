# TurboCore Enterprise Architecture

## Executive Summary

TurboCore is evolving from a fintech application into a **financial infrastructure platform** capable of powering multiple financial products across multiple countries. The architecture follows the modular monolith pattern — a single deployable unit with clear domain boundaries — rather than premature microservices.

### Current Maturity: 75% Production-Ready

**Strengths:**
- Double-entry ledger with atomic transactions and reconciliation
- Provider abstraction with 10 contracts and 8 adapters
- Circuit breakers, health tracking, and failover routing
- Comprehensive RBAC with 40+ permissions
- Full audit trail and AML monitoring
- Docker/K8s deployment with CI pipeline

**Gaps Being Addressed:**
- Provider plugin framework (formalized capability declarations)
- Payment orchestration engine (configurable routing policies)
- Event-driven architecture (domain event bus)
- Test coverage for API routes
- Production monitoring and observability

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                      CLIENT LAYER                       │
│  Web App (Next.js) │ Mobile App │ API Consumers         │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    API GATEWAY                           │
│  Rate Limiting │ CSRF │ Auth │ Input Validation          │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                 APPLICATION SERVICES                     │
│  Identity │ Wallet │ Payments │ Bills │ Cards │ Savings  │
│  Investments │ Referrals │ Vouchers │ Support │ Admin    │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│              PAYMENT ORCHESTRATION ENGINE                 │
│  Provider Selection │ Routing │ Cost Optimization        │
│  Failover │ Retry │ Circuit Breaker │ Traffic Splitting  │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                 PROVIDER PLUGIN REGISTRY                  │
│  Monnify │ Paystack │ Baxi │ Dojah │ Termii │ Resend    │
│  Wise │ Stripe │ Sandbox │ Mock                          │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    EVENT BUS                              │
│  Domain Events │ Outbox Pattern │ Async Processing       │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                  DATA LAYER                              │
│  PostgreSQL (primary) │ Redis (cache/sessions)           │
│  Double-Entry Ledger │ Immutable Entries                 │
└─────────────────────────────────────────────────────────┘
```

---

## Domain Boundaries

### Identity Domain
- **Responsibility:** User registration, authentication, sessions, MFA, KYC
- **Key Models:** User, Session, Passkey, LoginHistory, RecoveryToken
- **Boundaries:** Owns user identity; never exposes password hashes or MFA secrets

### Wallet Domain
- **Responsibility:** Balance management, funding, debit/credit operations
- **Key Models:** Wallet, VirtualAccount
- **Boundaries:** Wallet balance is a CACHE; ledger is source of truth

### Ledger Domain
- **Responsibility:** Double-entry accounting, balance derivation, reconciliation
- **Key Models:** LedgerEntry, Transaction, ReconciliationRun
- **Boundaries:** Immutable entries; corrections via REVERSAL only

### Payments Domain
- **Responsibility:** Transfer orchestration, bill payments, international transfers
- **Key Models:** Transaction, BillPayment, AirtimeDataPurchase, InternationalTransfer
- **Boundaries:** Never calls providers directly; uses orchestration engine

### Provider Domain
- **Responsibility:** Provider plugin management, routing, health monitoring
- **Key Models:** ProviderConfig, ProviderRoute, ProviderHealthCheck, WebhookEndpoint
- **Boundaries:** Business logic never depends on provider implementations

### Compliance Domain
- **Responsibility:** KYC verification, AML monitoring, fraud detection
- **Key Models:** KycVerification, AmlFlag, ComplianceCase, SecurityEvent
- **Boundaries:** Can freeze wallets and block transactions; audited decisions

### Audit Domain
- **Responsibility:** Immutable audit trail for all security-relevant actions
- **Key Models:** AuditLog, ConfigVersion
- **Boundaries:** Append-only; never modified or deleted

---

## Provider Plugin Framework

### Design Principles
1. Providers are plugins — adding one requires zero business code changes
2. Each plugin declares capabilities (what it CAN do)
3. The orchestration engine matches capabilities to operations
4. Plugins are versioned, health-checked, and circuit-broken

### Plugin Interface
```typescript
interface ProviderPlugin {
  id: string;
  displayName: string;
  version: string;
  capabilities: ProviderCapability[];
  costProfile: ProviderCostProfile;
  initialize(credentials: Record<string, string>): Promise<void>;
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  estimateFee(operation: string, amountMinor: number, currency: string): Promise<number | null>;
}
```

### Adding a New Provider
1. Implement `ProviderPlugin` interface
2. Declare capabilities (e.g., `["local_transfer:send", "local_transfer:status"]`)
3. Register with `pluginRegistry.register(plugin)`
4. Configure credentials in admin dashboard
5. No business code changes required

---

## Payment Orchestration Engine

### Routing Policy
Configurable via the admin dashboard. Policies replace hardcoded routing logic:

```typescript
{
  name: "cost-optimized",
  providerOrder: ["paystack", "flutterwave"],
  maxRetries: 3,
  retryBaseDelayMs: 1000,
  costOptimization: true,  // pick cheapest first
  latencyOptimization: false,
  geoRouting: {
    countryProviderMap: { "NG": "paystack", "KE": "flutterwave" }
  }
}
```

### Failover Strategy
1. Try first provider (circuit breaker check)
2. On failure: record in circuit breaker, exponential backoff
3. Try next provider in priority order
4. After maxRetries: return error with full attempt history

---

## Event Architecture

### Current: In-Process Event Bus
Synchronous pub/sub within the same Node.js process. Sufficient for a modular monolith.

### Future: Message Broker Migration Path
The `EventBus` interface is transport-agnostic. When horizontal scaling requires cross-process events:
1. Replace `EventBusImpl` with a Kafka/NATS-backed implementation
2. Business code (publishers/subscribers) unchanged
3. Outbox pattern ensures at-least-once delivery

### Event Types
- Wallet: `wallet.credited`, `wallet.debited`, `wallet.frozen`
- Transfer: `transfer.created`, `transfer.completed`, `transfer.failed`
- Provider: `provider.unavailable`, `provider.recovered`
- Compliance: `aml.flag_created`, `aml.wallet_frozen`

---

## Financial Integrity

### Ledger Principles
- **Double-entry:** Every movement posts DEBIT + CREDIT
- **Immutable:** Entries never edited; corrections via REVERSAL
- **Atomic:** All paths run in `db.$transaction()` with conditional updates
- **Idempotent:** `IdempotencyRecord` prevents duplicate operations
- **Reconcilable:** Daily cron compares wallet cache against ledger sum

### Balance Model
```
Wallet.balanceKobo = CACHE (optimized for reads)
Ledger.getLedgerBalance() = SOURCE OF TRUTH (computed from entries)
```

---

## Security Architecture

### Authentication
- Access tokens (24h) in HttpOnly cookies
- Refresh tokens (30d) in separate HttpOnly cookie
- Short-lived iframe tokens (5min) for cross-site contexts
- WebAuthn passkeys for passwordless/2FA

### Authorization
- RBAC with 40+ granular permissions
- Role-based access with database-backed roles
- Feature flag system for gradual rollouts

### Data Protection
- AES-256-GCM for PII (BVN, NIN, TOTP secrets, card PANs)
- Scrypt for passwords and PINs
- CSPRNG for tokens and OTPs
- Timing-safe comparisons everywhere

---

## Deployment Architecture

### Docker Compose (Development/Staging)
- 3 app instances (load-balanced by Caddy)
- PostgreSQL 16 with connection pooling
- Redis 7 for sessions, rate limiting, circuit breakers
- Caddy reverse proxy with automatic TLS

### Kubernetes (Production)
- Horizontal pod autoscaling
- CronJobs for background processing
- ConfigMaps and Secrets for configuration
- Network policies for service isolation

### CI/CD Pipeline
- GitHub Actions: lint → typecheck → test → build
- Prisma schema validation
- Production build with standalone output
- Automated database migrations

---

## Migration Roadmap

### Phase 1: Stabilize (Current)
- Fix test failures ✅
- Prisma migration baseline ✅
- Performance indexes ✅
- Provider plugin framework ✅

### Phase 2: Orchestration
- Payment orchestration engine ✅
- Configurable routing policies
- Cost-aware provider selection

### Phase 3: Event-Driven
- In-process event bus ✅
- Domain event publishers
- Async notification processing

### Phase 4: Production Hardening
- API route test coverage
- E2E test suite
- Load testing
- Monitoring dashboards

### Phase 5: Scale
- Message broker integration (Kafka/NATS)
- Read replicas for analytics
- Multi-region deployment
- CQRS for high-read domains

### Phase 6: Enterprise
- Multi-country support
- White-label infrastructure
- Enterprise API
- PCI DSS compliance
