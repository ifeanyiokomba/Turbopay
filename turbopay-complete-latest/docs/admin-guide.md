# TurboPay Administrator Guide

## Overview

The TurboPay admin portal provides comprehensive management capabilities for all platform operations. All admin routes require ADMIN role authentication.

## Access

### Authentication
- Login with admin credentials
- Session management via `/api/auth/sessions`
- MFA recommended for all admin accounts

### Admin Routes
All admin routes are under `/api/admin/` and require:
1. Authenticated session (cookie or Bearer token)
2. ADMIN role (`requireAdmin()` check)

## User Management

### View Users
```
GET /api/admin/customers
Query: ?page=1&limit=50&status=ACTIVE&search=john
```

### User Actions
- **View Details**: `GET /api/admin/customers/:id`
- **Update Status**: `PATCH /api/admin/customers/:id/status`
- **Add Notes**: `POST /api/admin/customers/:id/notes`
- **Freeze Wallet**: `POST /api/admin/customers/:id/wallet/freeze`
- **Unfreeze Wallet**: `POST /api/admin/customers/:id/wallet/unfreeze`
- **Deactivate**: `PATCH /api/admin/customers/:id/deactivate`

## Transaction Management

### View Transactions
```
GET /api/admin/transactions
Query: ?page=1&limit=50&type=TRANSFER&status=SUCCESS
```

### Transaction Actions
- **View Details**: `GET /api/admin/transactions/:id`
- **Reverse Transaction**: `POST /api/admin/transactions/:id/reverse`
- **Generate Receipt**: `GET /api/admin/transactions/:id/receipt`

## Provider Management

### View Providers
```
GET /api/admin/providers
```

### Provider Actions
- **View Health Dashboard**: `GET /api/admin/provider-health/dashboard`
- **Update Configuration**: `PATCH /api/admin/providers/:id`
- **Manage Credentials**: `POST /api/admin/provider-credentials`
- **Configure Routing**: `POST /api/admin/provider-routing`
- **Reset Circuit Breaker**: `POST /api/admin/providers/:id/reset-breaker`

### Provider Health
- Real-time health status per provider
- Circuit breaker states across instances
- Success rates and latency metrics
- Recent health check history (24h)

## Financial Management

### Fee Configuration
```
GET /api/admin/fees                    # List all fee configs
POST /api/admin/fees                   # Create fee config
PATCH /api/admin/fees/:id              # Update fee config
```

### FX Configuration
```
GET /api/admin/fx                      # List FX configs
POST /api/admin/fx                     # Create FX config
PATCH /api/admin/fx/:pair              # Update FX config
```

### KYC Limits
```
GET /api/admin/kyc-limits             # View tier limits
PATCH /api/admin/kyc-limits           # Update limits
```

### AML Policy
```
GET /api/admin/aml-policy             # View active policy
POST /api/admin/aml-policy            # Create/update policy
```

## Bill Management

### View Bills
```
GET /api/admin/bills
Query: ?category=ELECTRICITY&status=SUCCESS
```

### BillSwift Bulk Jobs
- Monitor bulk processing status
- View individual item results
- Retry failed items

## Savings & Investments

### View Savings
```
GET /api/admin/savings
Query: ?status=ACTIVE&type=GOAL
```

### View Investments
```
GET /api/admin/investments
Query: ?status=ACTIVE
```

### Virtual Cards
```
GET /api/admin/virtual-cards
Query: ?status=ACTIVE
```

## Support & Disputes

### Support Tickets
```
GET /api/admin/support/tickets
Query: ?status=OPEN&priority=HIGH
```

### Disputes
```
GET /api/admin/disputes
Query: ?status=OPEN&priority=URGENT
```

### Knowledge Base
```
GET /api/admin/support/knowledge-base
POST /api/admin/support/knowledge-base
```

## Compliance

### KYC Queue
```
GET /api/admin/kyc/queue
PATCH /api/admin/kyc/:id/review
```

### AML Flags
```
GET /api/admin/aml-flags
Query: ?resolved=false&severity=HIGH
```

### Compliance Cases
```
GET /api/admin/compliance/cases
PATCH /api/admin/compliance/cases/:id
```

## Analytics & Reports

### Dashboard
```
GET /api/admin/analytics
Query: ?from=2026-01-01&to=2026-07-01&section=user-growth
```

**Sections:** `user-growth`, `transaction-volume`, `revenue`, `wallets`, `providers`, `kyc`, `support`, `aml`

### Audit Reports
```
GET /api/admin/audit/reports
Query: ?from=2026-01-01&to=2026-07-01&category=AUTH&severity=WARN
```

### Finance Reports
```
GET /api/admin/finance/summary
GET /api/admin/finance/float
GET /api/admin/finance/reconciliation/report
```

## Configuration Management

### Feature Flags
```
GET /api/admin/feature-flags
POST /api/admin/feature-flags
PATCH /api/admin/feature-flags/:id
```

### Service Flags
```
GET /api/admin/services
PATCH /api/admin/services/:id
```

### Configuration Rollback
```
POST /api/admin/config/rollback
Body: { entityType, entityId, targetVersion, reason }
```

### Configuration History
```
GET /api/admin/config-history
Query: ?entityType=fee&entityId=xxx
```

## System Health

### Health Dashboard
```
GET /api/admin/system/health
```

### Provider Health
```
GET /api/admin/provider-health/dashboard
```

### Secrets Status
```
GET /api/admin/secrets-status
```

### Security Headers
```
GET /api/admin/security/headers
```

## Notifications

### Broadcast
```
POST /api/admin/notifications/broadcast
Body: { channel, template, recipients, variables }
```

### Retry Failed
```
POST /api/admin/notifications/:id/retry
```

## Referrals & Vouchers

### Referrals
```
GET /api/admin/referrals
```

### Vouchers
```
GET /api/admin/vouchers
POST /api/admin/vouchers
PATCH /api/admin/vouchers/:id
```

## Scheduled Payments
```
GET /api/admin/scheduled-payments
```

## Team Management
```
GET /api/admin/team
POST /api/admin/team/invite
PATCH /api/admin/team/:id
PATCH /api/admin/team/:id/deactivate
```
