# Operations Runbook

## Overview

This runbook provides procedures for operating the TurboPay platform in production.

## Service Architecture

| Service | Replicas | Port | Purpose |
|---------|----------|------|---------|
| turbopay | 3 | 3000 | Application server |
| postgres | 1 | 5432 | PostgreSQL database |
| redis | 1 | 6379 | Cache, rate limiting, sessions |
| caddy | 1 | 80, 443 | Reverse proxy + load balancer |

## Common Procedures

### Restart Services

```bash
# Restart all services
docker compose restart

# Restart specific service
docker compose restart turbopay
docker compose restart postgres
docker compose restart redis

# Force rebuild and restart
docker compose up --build -d
```

### Scale Application

```bash
# Scale to 5 instances
docker compose up --scale turbopay=5

# Scale down to 2 instances
docker compose up --scale turbopay=2
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f turbopay

# Last 100 lines
docker compose logs --tail 100 turbopay
```

## Database Operations

### Backup

```bash
# Manual backup
docker compose exec postgres pg_dump -U turbopay turbopay > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup
docker compose exec postgres pg_dump -U turbopay turbopay | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Restore

```bash
# Restore from backup
docker compose exec -T postgres psql -U turbopay turbopay < backup.sql

# Restore from compressed backup
docker compose exec -T postgres psql -U turbopay turbopay < backup.sql.gz
```

### Run Migrations

```bash
# Deploy pending migrations
docker compose exec turbopay npx prisma migrate deploy

# Create new migration (development)
docker compose exec turbopay npx prisma migrate dev --name <migration_name>
```

### Reset Database (Development Only)

```bash
# WARNING: This destroys all data
docker compose exec turbopay npx prisma migrate reset
```

## Monitoring

### Health Check

```bash
# Check application health
curl http://localhost:3000/api/health

# Check with verbose output
curl -v http://localhost:3000/api/health
```

### Database Health

```bash
# Check PostgreSQL is running
docker compose exec postgres pg_isready -U turbopay

# Check active connections
docker compose exec postgres psql -U turbopay turbopay -c "SELECT count(*) FROM pg_stat_activity;"
```

### Redis Health

```bash
# Check Redis is running
docker compose exec redis redis-cli ping

# Check memory usage
docker compose exec redis redis-cli info memory

# Check connected clients
docker compose exec redis redis-cli info clients
```

### Application Metrics

```bash
# Check container resource usage
docker stats

# Check specific container
docker stats turbopay-turbopay-1
```

## Incident Response

### Service Down

1. Check health endpoint: `curl http://localhost:3000/api/health`
2. Check container status: `docker compose ps`
3. Check logs: `docker compose logs --tail 100 turbopay`
4. If container is restarting, check memory: `docker stats`
5. If OOM, increase memory limit in `docker-compose.yml`

### Database Connection Issues

1. Check PostgreSQL: `docker compose exec postgres pg_isready -U turbopay`
2. Check connection pool: `docker compose exec postgres psql -U turbopay turbopay -c "SELECT count(*) FROM pg_stat_activity;"`
3. If pool exhausted, check for long-running queries
4. Restart PostgreSQL if needed: `docker compose restart postgres`

### High Latency

1. Check health endpoint response time
2. Check database query performance
3. Check Redis hit rate
4. Check container CPU/memory usage
5. Review slow query logs

### Memory Issues

1. Check container memory: `docker stats`
2. Check heap usage in health endpoint
3. Look for memory leaks in logs
4. Restart affected containers

## Backup Strategy

### Daily Backup (Automated)

Add to crontab:
```bash
0 2 * * * docker compose exec -T postgres pg_dump -U turbopay turbopay | gzip > /backups/turbopay_$(date +\%Y\%m\%d).sql.gz
```

### Retention Policy

- Keep daily backups for 7 days
- Keep weekly backups for 4 weeks
- Keep monthly backups for 12 months

### Off-site Backup

```bash
# Upload to S3 (example)
aws s3 cp backup_$(date +%Y%m%d).sql.gz s3://turbopay-backups/
```

## Rollback Procedures

### Application Rollback

```bash
# Checkout previous version
git checkout <previous_commit>

# Rebuild and restart
docker compose up --build -d
```

### Database Rollback

```bash
# Create rollback migration
npx prisma migrate dev --name rollback_<feature>

# Or restore from backup
docker compose exec -T postgres psql -U turbopay turbopay < backup.sql
```

## Escalation Matrix

| Severity | Response Time | Escalation |
|----------|--------------|------------|
| Critical (service down) | 15 minutes | Engineering lead |
| High (major feature broken) | 1 hour | Engineering lead |
| Medium (minor feature broken) | 4 hours | Team lead |
| Low (cosmetic issue) | 24 hours | Assigned engineer |

## Contact Information

- **Engineering Lead**: [Name] - [Phone] - [Email]
- **DevOps**: [Name] - [Phone] - [Email]
- **Database Admin**: [Name] - [Phone] - [Email]
