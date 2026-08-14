#!/usr/bin/env bash
# ============================================================================
# TurboPay — Isolated Test Database Teardown
# ============================================================================
#
# Stops the dedicated local test cluster (port 5433) created by setup.sh.
# Data is preserved in .testdb/pgdata (reuse on next run); delete the dir to
# reset from scratch. Does NOT touch any other PostgreSQL instance.
# ============================================================================

set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
PGDATA_DIR="$ROOT/.testdb/pgdata"
PGLOG="$ROOT/.testdb/postgres.log"

if [ ! -d "$PGDATA_DIR" ]; then
  echo "No isolated test cluster found (.testdb/pgdata missing) — nothing to stop."
  exit 0
fi

find_pg_ctl() {
  if [ -n "${PG_BIN:-}" ] && [ -x "$PG_BIN/pg_ctl" ]; then
    echo "$PG_BIN/pg_ctl"; return
  fi
  for base in "/c/Program Files/PostgreSQL/16/bin" "/c/PostgreSQL/16/bin" \
              "/usr/lib/postgresql/16/bin" "/opt/homebrew/opt/postgresql@16/bin"; do
    if [ -x "$base/pg_ctl" ]; then
      echo "$base/pg_ctl"; return
    fi
  done
  if command -v pg_ctl >/dev/null 2>&1; then
    command -v pg_ctl
    return
  fi
  echo ""
}

PG_CTL="$(find_pg_ctl)"
if [ -z "$PG_CTL" ]; then
  echo "pg_ctl not found — cannot stop the test cluster. Stop it manually if running."
  exit 0
fi

if "$PG_CTL" -D "$PGDATA_DIR" status >/dev/null 2>&1; then
  "$PG_CTL" -D "$PGDATA_DIR" -m fast stop >/dev/null 2>&1 && echo "Isolated test cluster stopped."
else
  echo "Isolated test cluster is not running."
fi
