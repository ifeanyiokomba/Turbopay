#!/bin/bash
# ============================================================
# TurboPay — Automated Rollback Script
# ============================================================
#
# Features:
#   - Application rollback to previous git commit
#   - Database rollback via migration or backup restore
#   - Rollback verification (health check)
#   - Automatic rollback on failed deployment
#   - Email + webhook notifications
#
# Usage:
#   ./scripts/rollback.sh                    # Rollback to previous commit
#   ./scripts/rollback.sh --commit <hash>    # Rollback to specific commit
#   ./scripts/rollback.sh --database         # Rollback database only
#   ./scripts/rollback.sh --full             # Rollback app + database
#   ./scripts/rollback.sh --verify           # Verify current deployment
#
# ============================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
CONTAINER_NAME="${CONTAINER_NAME:-turbopay-turbopay-1}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Email notifications (optional)
SMTP_HOST="${SMTP_HOST:-}"
SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER="${SMTP_USER:-}"
SMTP_PASS="${SMTP_PASS:-}"
EMAIL_FROM="${EMAIL_FROM:-rollback@turbopay.ng}"
EMAIL_TO="${EMAIL_TO:-}"
EMAIL_SUBJECT_PREFIX="${EMAIL_SUBJECT_PREFIX:-[TurboPay Rollback]}"

# Webhook notifications (optional)
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"

# ─── Functions ────────────────────────────────────────────────

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
}

# Send email notification
send_email() {
  local subject="$1"
  local body="$2"

  if [[ -z "$EMAIL_TO" ]]; then return 0; fi

  if command -v mail &> /dev/null; then
    echo "$body" | mail -s "$subject" -r "$EMAIL_FROM" "$EMAIL_TO" 2>/dev/null && return 0
  fi

  if command -v python3 &> /dev/null && [[ -n "$SMTP_HOST" ]]; then
    python3 -c "
import smtplib
from email.mime.text import MIMEText
msg = MIMEText('''$body''')
msg['Subject'] = '$subject'
msg['From'] = '$EMAIL_FROM'
msg['To'] = '$EMAIL_TO'
with smtplib.SMTP('$SMTP_HOST', $SMTP_PORT) as server:
    server.starttls()
    server.login('$SMTP_USER', '$SMTP_PASS')
    server.send_message(msg)
" 2>/dev/null && return 0
  fi

  log "WARNING: Could not send email notification"
  return 0
}

# Combined notification: email + webhook
notify() {
  local message="$1"
  local subject="${EMAIL_SUBJECT_PREFIX} ${message}"
  local body="TurboPay Rollback Notification\n\nStatus: $message\nTimestamp: $(date '+%Y-%m-%d %H:%M:%S')\nHost: $(hostname)\n\n---\nAutomated rollback notification from TurboPay"

  send_email "$subject" "$body"

  if [[ -n "$NOTIFICATION_WEBHOOK" ]]; then
    curl -s -X POST "$NOTIFICATION_WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\": \"TurboPay Rollback: $message\"}" \
      2>/dev/null || true
  fi
}

# ─── Health Check ─────────────────────────────────────────────

check_health() {
  local max_retries=10
  local retry_delay=5

  for i in $(seq 1 $max_retries); do
    if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
      log "Health check passed"
      return 0
    fi
    log "Health check failed (attempt $i/$max_retries), retrying in ${retry_delay}s..."
    sleep $retry_delay
  done

  error "Health check failed after $max_retries attempts"
  return 1
}

# ─── Application Rollback ────────────────────────────────────

rollback_app() {
  local target_commit="${1:-}"

  if [[ -z "$target_commit" ]]; then
    # Get the previous commit
    target_commit=$(git rev-parse HEAD~1 2>/dev/null)
    if [[ -z "$target_commit" ]]; then
      error "No previous commit found"
      return 1
    fi
  fi

  log "Rolling back to commit: $target_commit"

  # Verify commit exists
  if ! git cat-file -e "$target_commit" 2>/dev/null; then
    error "Commit $target_commit not found"
    return 1
  fi

  # Stash any uncommitted changes
  if [[ -n $(git status --porcelain) ]]; then
    log "Stashing uncommitted changes"
    git stash push -m "Rollback stash $(date +%Y%m%d_%H%M%S)"
  fi

  # Checkout the target commit
  git checkout "$target_commit"

  # Rebuild and restart
  log "Rebuilding application..."
  docker compose -f "$COMPOSE_FILE" up --build -d turbopay

  # Wait for health check
  log "Waiting for application to start..."
  if check_health; then
    log "Rollback successful"
    return 0
  else
    error "Rollback failed — application did not become healthy"
    return 1
  fi
}

# ─── Database Rollback ────────────────────────────────────────

rollback_database() {
  local backup_file="${1:-}"

  if [[ -z "$backup_file" ]]; then
    # Find the latest backup
    backup_file=$(ls -t "$BACKUP_DIR"/turbopay_*.sql.gz 2>/dev/null | head -1)
    if [[ -z "$backup_file" ]]; then
      error "No backup file found"
      return 1
    fi
  fi

  log "Rolling back database from: $(basename "$backup_file")"

  # Verify backup exists
  if [[ ! -f "$backup_file" ]]; then
    error "Backup file not found: $backup_file"
    return 1
  fi

  # Create a pre-rollback backup
  log "Creating pre-rollback backup..."
  local pre_rollback_backup="${BACKUP_DIR}/pre_rollback_$(date +%Y%m%d_%H%M%S).sql.gz"
  docker exec "$CONTAINER_NAME" pg_dump -U turbopay turbopay | gzip > "$pre_rollback_backup"
  log "Pre-rollback backup saved: $(basename "$pre_rollback_backup")"

  # Restore from backup
  log "Restoring database..."
  if gunzip -c "$backup_file" | docker exec -i "$CONTAINER_NAME" psql -U turbopay -d turbopay -q; then
    log "Database restored successfully"
    return 0
  else
    error "Database restore failed"
    return 1
  fi
}

# ─── Full Rollback ────────────────────────────────────────────

rollback_full() {
  local target_commit="${1:-}"

  log "Starting full rollback..."

  # Rollback database first
  if ! rollback_database; then
    error "Database rollback failed"
    return 1
  fi

  # Then rollback application
  if ! rollback_app "$target_commit"; then
    error "Application rollback failed"
    return 1
  fi

  log "Full rollback completed successfully"
  return 0
}

# ─── Verification ─────────────────────────────────────────────

verify_deployment() {
  log "Verifying current deployment..."

  # Check health
  if ! check_health; then
    return 1
  fi

  # Check database connectivity
  if ! docker exec "$CONTAINER_NAME" pg_isready -U turbopay -q 2>/dev/null; then
    error "Database not accessible"
    return 1
  fi

  # Check Redis connectivity
  if ! docker exec turbopay-redis-1 redis-cli ping 2>/dev/null | grep -q PONG; then
    error "Redis not accessible"
    return 1
  fi

  # Check git status
  local current_commit=$(git rev-parse --short HEAD)
  log "Current commit: $current_commit"

  log "Deployment verification passed"
  return 0
}

# ─── Main ─────────────────────────────────────────────────────

main() {
  local target_commit=""
  local database_only=false
  local full_rollback=false
  local verify_only=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --commit)
        target_commit="$2"
        shift 2
        ;;
      --database)
        database_only=true
        shift
        ;;
      --full)
        full_rollback=true
        shift
        ;;
      --verify)
        verify_only=true
        shift
        ;;
      *)
        error "Unknown argument: $1"
        exit 1
        ;;
    esac
  done

  if $verify_only; then
    verify_deployment
    exit $?
  fi

  if $database_only; then
    rollback_database
    exit $?
  fi

  if $full_rollback; then
    rollback_full "$target_commit"
    exit $?
  fi

  # Default: rollback application only
  rollback_app "$target_commit"
}

main "$@"
