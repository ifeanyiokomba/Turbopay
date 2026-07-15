# TurboPay Database Strategy

## Overview

TurboPay uses PostgreSQL 16 as its primary database with Prisma ORM. The database schema contains 80+ models covering all financial and operational domains.

## Connection Management

### Connection Pooling

```typescript
// src/lib/db.ts
DATABASE_URL=postgresql://...?connection_limit=10&pool_timeout=10
```

- **connection_limit=10**: Max 10 connections per app instance
- **pool_timeout=10**: Wait max 10s for a connection from the pool
- **PgBouncer**: Use for Supabase/cloud deployments with PgBouncer

### Read Replicas

For analytics/reporting queries that don't need strong consistency:

```typescript
// src/lib/db-read.ts (optional)
import { PrismaClient } from "@prisma/client";

export const dbRead = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL_REPLICA ?? process.env.DATABASE_URL,
    },
  },
});
```

Use `dbRead` for:
- Analytics dashboards
- Report generation
- Audit log queries
- Historical data lookups

Never use `dbRead` for:
- Financial transactions
- Wallet balance updates
- Payment processing
- Any write operation

## Table Partitioning Strategy

For high-volume tables that grow unbounded, implement PostgreSQL native partitioning.

### Recommended Partitioning

| Table | Partition Key | Strategy | Rationale |
|-------|--------------|----------|-----------|
| `Transaction` | `createdAt` | Monthly range | Highest volume table; queries typically filter by date range |
| `LedgerEntry` | `createdAt` | Monthly range | Financial entries grow with every transaction |
| `AuditLog` | `createdAt` | Monthly range | Audit logs are append-only, queried by date |
| `WebhookEvent` | `receivedAt` | Monthly range | Webhook events are processed and archived |
| `NotificationLog` | `createdAt` | Monthly range | Notification history grows indefinitely |

### Partitioning Implementation

PostgreSQL 16 supports native declarative partitioning. To partition a table:

```sql
-- Example: Partition Transaction table by month
CREATE TABLE "Transaction" (
  -- ... columns ...
) PARTITION BY RANGE ("createdAt");

-- Create partitions
CREATE TABLE "Transaction_2026_01" PARTITION OF "Transaction"
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE "Transaction_2026_02" PARTITION OF "Transaction"
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- etc.
```

### Prisma Considerations

Prisma does not natively support partitioned tables. Options:

1. **Use raw SQL for partition management** — Create partitions via `db.$executeRaw`
2. **Use pg_partman extension** — Automated partition management
3. **Application-level partitioning** — Shard by userId or date in the application

### Recommended Approach

For TurboPay, use **application-level monthly partitioning** via a cron job:

```typescript
// src/lib/turbocore/partition/index.ts
export async function ensurePartitions() {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7); // "2026-07"
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    .toISOString().slice(0, 7); // "2026-08"

  // Create next month's partition if it doesn't exist
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Transaction_${nextMonth.replace("-", "_")}"
    PARTITION OF "Transaction"
    FOR VALUES FROM ('${nextMonth}-01') TO ('${new Date(now.getFullYear(), now.getMonth() + 2, 1).toISOString().slice(0, 10)}')
  `);
}
```

### Data Retention

Implement automated data lifecycle management:

| Data Type | Hot (Query) | Warm (Archive) | Cold (Delete) |
|-----------|-------------|----------------|---------------|
| Transactions | 90 days | 1 year | After 7 years |
| Ledger entries | 90 days | 1 year | After 7 years |
| Audit logs | 90 days | 2 years | After 5 years |
| Webhook events | 30 days | 90 days | After 6 months |
| Notifications | 30 days | 90 days | After 6 months |
| Sessions | 7 days | - | After 7 days |

## Indexing Strategy

### Current Indexes (from schema.prisma)

Key composite indexes for high-traffic queries:

```sql
-- Transaction queries
@@index([userId])
@@index([walletId])
@@index([type])
@@index([status])
@@index([state])
@@index([createdAt])
@@index([userId, direction, status, createdAt])  -- AML velocity
@@index([userId, type, createdAt])                -- User history

-- Ledger entries
@@index([walletId])
@@index([walletId, entryType])
@@index([refType, refId])

-- Audit logs
@@index([userId])
@@index([category])
@@index([severity])
@@index([createdAt])
@@index([userId, category, createdAt])
```

### Recommended Additional Indexes

```sql
-- For provider health queries
CREATE INDEX idx_provider_health_recent
  ON "ProviderHealthCheck" ("providerConfigId", "checkedAt" DESC);

-- For reconciliation queries
CREATE INDEX idx_wallet_active
  ON "Wallet" ("status") WHERE "status" = 'ACTIVE';

-- For scheduled payment execution
CREATE INDEX idx_scheduled_payment_due
  ON "ScheduledPayment" ("status", "nextExecutionAt")
  WHERE "status" = 'ACTIVE';
```

## Caching Strategy

### Cache Layers

1. **Application Cache** (`cache.ts`): Redis with in-memory fallback
   - Provider config: 60s TTL
   - Circuit breaker state: 60s TTL
   - Rate limit counters: sliding window

2. **Database Query Cache**: Prisma's built-in query cache
   - Connection pooling reduces query latency
   - Prepared statements cached by Prisma

3. **CDN Cache**: Static assets via Caddy/CDN
   - API responses: No cache (financial data)
   - Static assets: Long cache (immutable hashes)

### Cache Invalidation

- **Provider config**: Invalidate on admin update
- **Feature flags**: Invalidate on toggle
- **Rate limits**: No invalidation (sliding window)
- **Circuit breaker**: Auto-expire via TTL

## Backup Strategy

### Automated Backups

```bash
# Daily backup via cron
./scripts/backup.sh --full

# Verify backup integrity
./scripts/backup.sh --verify

# Upload to S3 for off-site storage
./scripts/backup.sh --upload
```

### Point-in-Time Recovery

PostgreSQL supports PITR via WAL archiving:

```bash
# Enable WAL archiving in postgresql.conf
archive_mode = on
archive_command = 'cp %p /path/to/wal_archive/%f'
```

### Restore Procedures

```bash
# Restore from backup
./scripts/rollback.sh --database

# Or manual restore
gunzip -c backup.sql.gz | docker exec -i postgres psql -U turbopay
```

## Performance Tuning

### Query Optimization

1. **Use EXPLAIN ANALYZE** for slow queries
2. **Add missing indexes** based on query patterns
3. **Avoid N+1 queries** — use Prisma's `include` for related data
4. **Use `select`** to limit returned columns
5. **Paginate large result sets** — max 100 rows per page

### Connection Pool Tuning

```typescript
// Optimal settings for 3 app instances
DATABASE_URL=postgresql://...?connection_limit=10&pool_timeout=10

// For PgBouncer (Supabase)
DATABASE_URL=postgresql://...?pgbouncer=true&connection_limit=1
```

### Memory Management

- **Prisma connection pool**: 10 connections per instance
- **Redis maxmemory**: 512MB with allkeys-lru eviction
- **PostgreSQL shared_buffers**: 25% of system RAM
- **PostgreSQL work_mem**: 256MB for complex queries

## Monitoring Queries

### Slow Query Detection

```sql
-- Find queries taking > 1 second
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
WHERE mean_exec_time > 1000
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### Table Size Monitoring

```sql
-- Check table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### Index Usage

```sql
-- Find unused indexes
SELECT indexrelname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC;
```
