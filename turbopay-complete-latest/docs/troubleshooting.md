# Troubleshooting Guide

## Common Issues

### Application Won't Start

**Symptoms:** Server crashes on startup, EADDRINUSE, or module not found errors.

**Solutions:**

1. **Port already in use:**
   ```bash
   # Find process using port 3000
   lsof -i :3000
   # Kill the process
   kill -9 <PID>
   ```

2. **Missing environment variables:**
   ```bash
   # Check required variables
   echo $DATABASE_URL
   echo $TURBOPAY_PII_KEY
   ```

3. **Prisma client not generated:**
   ```bash
   npx prisma generate
   ```

### Database Connection Issues

**Symptoms:** "Can't reach database server" or connection timeout errors.

**Solutions:**

1. **PostgreSQL not running:**
   ```bash
   docker compose exec postgres pg_isready -U turbopay
   ```

2. **Wrong connection string:**
   ```bash
   # Check DATABASE_URL format
   echo $DATABASE_URL
   # Should be: postgresql://user:pass@host:5432/db
   ```

3. **Connection pool exhausted:**
   ```bash
   # Check active connections
   docker compose exec postgres psql -U turbopay turbopay -c "SELECT count(*) FROM pg_stat_activity;"
   ```

### Redis Connection Issues

**Symptoms:** Rate limiting not working, cache misses, session issues.

**Solutions:**

1. **Redis not running:**
   ```bash
   docker compose exec redis redis-cli ping
   # Should return: PONG
   ```

2. **Memory full:**
   ```bash
   docker compose exec redis redis-cli info memory
   ```

3. **Fallback to in-memory:**
   - Check if `REDIS_URL` is set
   - App will work but rate limiting won't be shared across instances

### Authentication Issues

**Symptoms:** 401 errors, session expired, can't login.

**Solutions:**

1. **Session expired:**
   - Access tokens expire after 24 hours
   - Client should call `/api/auth/refresh` with refresh token
   - Refresh tokens expire after 30 days

2. **Account locked:**
   - After 5 failed login attempts, account is locked for 15 minutes
   - Check `loginLockedUntil` on user record

3. **Email not verified:**
   - Users must verify email before login
   - Check `emailVerified` on user record

### Payment Issues

**Symptoms:** Payments failing, funds not received, duplicate transactions.

**Solutions:**

1. **Insufficient funds:**
   - Check wallet balance: `GET /api/wallet`
   - Verify ledger balance matches: `reconcileWallet()`

2. **Provider down:**
   - Check provider health: `GET /api/admin/provider-health`
   - Circuit breaker may be open — wait for cooldown
   - Check failover configuration

3. **Duplicate transaction:**
   - Check idempotency key
   - Verify webhook was processed (check `WebhookEvent` table)

### Webhook Issues

**Symptoms:** Webhooks not received, duplicate processing, signature validation failed.

**Solutions:**

1. **Webhook not received:**
   - Check webhook endpoint URL
   - Verify firewall rules
   - Check provider webhook logs

2. **Signature validation failed:**
   - Verify `TURBOPAY_MONNIFY_WEBHOOK_SECRET` matches provider
   - Check webhook payload format

3. **Duplicate processing:**
   - Check `WebhookEvent` table for duplicate `providerRef`
   - Idempotency should prevent double-processing

### Performance Issues

**Symptoms:** Slow response times, high CPU/memory usage.

**Solutions:**

1. **Slow database queries:**
   - Check for missing indexes
   - Review slow query logs
   - Consider connection pooling

2. **High memory usage:**
   - Check for memory leaks
   - Restart affected containers
   - Increase memory limits

3. **High CPU usage:**
   - Check for infinite loops
   - Review background job processing
   - Scale horizontally

### Cron Job Issues

**Symptoms:** Cron jobs not running, duplicate execution.

**Solutions:**

1. **Cron job not running:**
   - Check cron secret: `x-cron-secret` header
   - Verify cron schedule in `vercel.json` or systemd timer
   - Check `CronLock` table for stuck locks

2. **Duplicate execution:**
   - Leader election via `CronLock` should prevent this
   - Check if multiple instances are running
   - Verify lock TTL hasn't expired

### Error Codes Reference

| Code | Description | Solution |
|------|-------------|----------|
| `UNAUTHORIZED` | Not authenticated | Login again |
| `FORBIDDEN` | Insufficient permissions | Check user role |
| `VALIDATION` | Invalid input | Check request body |
| `RATE_LIMITED` | Too many requests | Wait and retry |
| `INSUFFICIENT_FUNDS` | Not enough balance | Fund wallet |
| `WALLET_FROZEN` | Wallet is frozen | Contact support |
| `PIN_REQUIRED` | Transaction PIN needed | Set PIN in settings |
| `PIN_LOCKED` | PIN locked due to failures | Wait 15 minutes |
| `AML_BLOCKED` | Blocked by risk monitoring | Contact support |
| `PROVIDER_ERROR` | External provider failed | Retry or use different provider |
| `FEATURE_DISABLED` | Feature not available | Check feature flags |

## Getting Help

If you can't resolve an issue:

1. Check the logs: `docker compose logs turbopay`
2. Review the health endpoint: `curl http://localhost:3000/api/health`
3. Check the audit log: `GET /api/admin/audit`
4. Contact the engineering team
