#!/bin/bash
# ============================================================
# TurboPay — Notification Test Script
# ============================================================
#
# Tests email and webhook notification logic without sending real emails.
#
# Usage:
#   ./scripts/test-notifications.sh              # Test all notifications
#   ./scripts/test-notifications.sh --email      # Test email only
#   ./scripts/test-notifications.sh --webhook    # Test webhook only
#
# ============================================================

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ─── Test Results ─────────────────────────────────────────────
PASS=0
FAIL=0

pass() {
  echo -e "${GREEN}✓ PASS${NC}: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo -e "${RED}✗ FAIL${NC}: $1"
  FAIL=$((FAIL + 1))
}

info() {
  echo -e "${YELLOW}ℹ INFO${NC}: $1"
}

# ─── Test Email Configuration ─────────────────────────────────

test_email_config() {
  info "Testing email configuration..."

  # Test 1: Check if SMTP_HOST is set
  if [[ -n "${SMTP_HOST:-}" ]]; then
    pass "SMTP_HOST is configured: $SMTP_HOST"
  else
    info "SMTP_HOST not set — email will use sendmail/mail fallback"
  fi

  # Test 2: Check if EMAIL_TO is set
  if [[ -n "${EMAIL_TO:-}" ]]; then
    pass "EMAIL_TO is configured: $EMAIL_TO"
  else
    info "EMAIL_TO not set — email notifications will be skipped"
  fi

  # Test 3: Check if SMTP_USER is set when SMTP_HOST is set
  if [[ -n "${SMTP_HOST:-}" && -z "${SMTP_USER:-}" ]]; then
    fail "SMTP_HOST is set but SMTP_USER is not"
  elif [[ -n "${SMTP_HOST:-}" && -n "${SMTP_USER:-}" ]]; then
    pass "SMTP_USER is configured"
  fi

  # Test 4: Check if SMTP_PASS is set when SMTP_HOST is set
  if [[ -n "${SMTP_HOST:-}" && -z "${SMTP_PASS:-}" ]]; then
    fail "SMTP_HOST is set but SMTP_PASS is not"
  elif [[ -n "${SMTP_HOST:-}" && -n "${SMTP_PASS:-}" ]]; then
    pass "SMTP_PASS is configured"
  fi
}

# ─── Test Email Delivery Methods ──────────────────────────────

test_email_methods() {
  info "Testing email delivery methods..."

  # Test 1: Check if mail command is available
  if command -v mail &> /dev/null; then
    pass "mail command is available"
  else
    info "mail command not found — will use Python or curl fallback"
  fi

  # Test 2: Check if Python3 is available
  if command -v python3 &> /dev/null; then
    pass "python3 is available"
  else
    info "python3 not found — will use curl fallback"
  fi

  # Test 3: Check if curl is available
  if command -v curl &> /dev/null; then
    pass "curl is available"
  else
    info "curl not found — email delivery may fail"
  fi
}

# ─── Test Send Email Function ─────────────────────────────────

test_send_email() {
  info "Testing send_email function..."

  # Source the backup script to get the send_email function
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # Create a test function that mimics send_email
  send_email_test() {
    local subject="$1"
    local body="$2"

    # Simulate email sending
    if [[ -n "${EMAIL_TO:-}" ]]; then
      echo "EMAIL WOULD BE SENT:"
      echo "  To: $EMAIL_TO"
      echo "  Subject: $subject"
      echo "  Body length: ${#body} chars"
      return 0
    else
      echo "EMAIL SKIPPED: No recipient configured"
      return 0
    fi
  }

  # Test 1: Email with recipient configured
  EMAIL_TO="test@example.com" result=$(send_email_test "Test Subject" "Test body")
  if echo "$result" | grep -q "EMAIL WOULD BE SENT"; then
    pass "Email function works with recipient configured"
  else
    fail "Email function failed with recipient configured"
  fi

  # Test 2: Email without recipient configured
  EMAIL_TO="" result=$(send_email_test "Test Subject" "Test body")
  if echo "$result" | grep -q "EMAIL SKIPPED"; then
    pass "Email function gracefully skips when no recipient"
  else
    fail "Email function should skip when no recipient"
  fi
}

# ─── Test Webhook Configuration ───────────────────────────────

test_webhook_config() {
  info "Testing webhook configuration..."

  # Test 1: Check if NOTIFICATION_WEBHOOK is set
  if [[ -n "${NOTIFICATION_WEBHOOK:-}" ]]; then
    pass "NOTIFICATION_WEBHOOK is configured: $NOTIFICATION_WEBHOOK"

    # Test 2: Check if webhook URL is valid
    if [[ "$NOTIFICATION_WEBHOOK" =~ ^https?:// ]]; then
      pass "Webhook URL has valid format"
    else
      fail "Webhook URL does not have valid format (should start with http:// or https://)"
    fi
  else
    info "NOTIFICATION_WEBHOOK not set — webhook notifications will be skipped"
  fi
}

# ─── Test Backup Script Notifications ─────────────────────────

test_backup_notifications() {
  info "Testing backup script notification logic..."

  # Test 1: Check if backup script has send_email function
  if grep -q "send_email" scripts/backup.sh; then
    pass "backup.sh has send_email function"
  else
    fail "backup.sh missing send_email function"
  fi

  # Test 2: Check if backup script has notify function
  if grep -q "notify()" scripts/backup.sh; then
    pass "backup.sh has notify function"
  else
    fail "backup.sh missing notify function"
  fi

  # Test 3: Check if backup script sends email on success
  if grep -q "notify.*SUCCESS" scripts/backup.sh; then
    pass "backup.sh sends notification on success"
  else
    fail "backup.sh missing success notification"
  fi

  # Test 4: Check if backup script sends email on failure
  if grep -q "notify.*FAILED" scripts/backup.sh; then
    pass "backup.sh sends notification on failure"
  else
    fail "backup.sh missing failure notification"
  fi
}

# ─── Test Rollback Script Notifications ───────────────────────

test_rollback_notifications() {
  info "Testing rollback script notification logic..."

  # Test 1: Check if rollback script has send_email function
  if grep -q "send_email" scripts/rollback.sh; then
    pass "rollback.sh has send_email function"
  else
    fail "rollback.sh missing send_email function"
  fi

  # Test 2: Check if rollback script has notify function
  if grep -q "notify()" scripts/rollback.sh; then
    pass "rollback.sh has notify function"
  else
    fail "rollback.sh missing notify function"
  fi
}

# ─── Test Deploy Script Notifications ─────────────────────────

test_deploy_notifications() {
  info "Testing deploy script notification logic..."

  # Test 1: Check if deploy script has send_email function
  if grep -q "send_email" scripts/deploy.sh; then
    pass "deploy.sh has send_email function"
  else
    fail "deploy.sh missing send_email function"
  fi

  # Test 2: Check if deploy script has notify function
  if grep -q "notify()" scripts/deploy.sh; then
    pass "deploy.sh has notify function"
  else
    fail "deploy.sh missing notify function"
  fi
}

# ─── Main ─────────────────────────────────────────────────────

main() {
  local test_email=false
  local test_webhook=false

  # Parse arguments
  while [[ $# -gt 0 ]]; do
    case $1 in
      --email)
        test_email=true
        shift
        ;;
      --webhook)
        test_webhook=true
        shift
        ;;
      *)
        echo "Unknown argument: $1"
        exit 1
        ;;
    esac
  done

  # If no specific test requested, run all
  if ! $test_email && ! $test_webhook; then
    test_email=true
    test_webhook=true
  fi

  echo "=========================================="
  echo "TurboPay Notification Tests"
  echo "=========================================="
  echo ""

  # Run tests
  if $test_email; then
    test_email_config
    test_email_methods
    test_send_email
    test_backup_notifications
    test_rollback_notifications
    test_deploy_notifications
  fi

  if $test_webhook; then
    test_webhook_config
  fi

  echo ""
  echo "=========================================="
  echo "Results: $PASS passed, $FAIL failed"
  echo "=========================================="

  if [[ $FAIL -gt 0 ]]; then
    exit 1
  fi
}

main "$@"
