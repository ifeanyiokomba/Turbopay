#!/usr/bin/env bash
# ============================================================================
# TurboPay — Isolated Test Database Setup
# ============================================================================
#
# Resolves a SAFE test database and applies migrations. Never touches a
# production/staging/dev database.
#
# Resolution order:
#   1. $DATABASE_URL_TEST already in the environment (explicit, trusted) →
#      apply migrations, done.
#   2. $DATABASE_URL pointing at a LOCALHOST host that is TCP-reachable
#      (e.g. a CI postgres service container on 5432) → use it as the test
#      URL, apply migrations, done.
#   3. Otherwise → provision a DEDICATED isolated cluster:
#        • own data dir:  <project>/.testdb/pgdata
#        • own port:      5433 (never 5432, the dev/prod cluster)
#        • trust auth, bound to 127.0.0.1 only
#      writes .env.test (DATABASE_URL_TEST) and applies migrations.
#
# Idempotent — safe to run on every `npm test`.
#
# Prerequisites for case 3: PostgreSQL 16 binaries. Located via (in order):
#   1. $PG_BIN env var (e.g. /usr/lib/postgresql/16/bin)
#   2. Common Windows install path (C:\Program Files\PostgreSQL\16\bin)
#   3. `initdb` / `pg_ctl` already on PATH
# ============================================================================

set -euo pipefail

cd "$(dirname "$0")/../.." # project root (turbopay-complete-latest)
ROOT="$(pwd)"

TEST_PORT="${TEST_PORT:-5433}"
TEST_DB="${TEST_DB:-turbopay_test}"
TEST_SUPERUSER="${TEST_SUPERUSER:-postgres}"
PGDATA_DIR="$ROOT/.testdb/pgdata"
PGLOG="$ROOT/.testdb/postgres.log"
ENV_TEST_FILE="$ROOT/.env.test"

# ── 0. Reuse an explicit DATABASE_URL_TEST if provided ───────────────────
if [ -n "${DATABASE_URL_TEST:-}" ]; then
  echo "→ Using DATABASE_URL_TEST from environment (explicit test database)."
  DATABASE_URL="$DATABASE_URL_TEST" DIRECT_URL="${DIRECT_URL_TEST:-$DATABASE_URL_TEST}" npx prisma migrate deploy
  echo "✅ Test database ready: $DATABASE_URL_TEST"
  exit 0
fi

# ── 1. Reuse a LOCALHOST DATABASE_URL (CI service container) ─────────────
# NOTE: the node probes read process.env.DATABASE_URL directly (not a bash
# variable) — bash vars are NOT exported to child processes, so passing
# $DB_URL through would always yield empty and the CI service container
# would never be detected.
DB_URL="${DATABASE_URL:-}"
DB_HOST=""
if [ -n "$DB_URL" ]; then
  DB_HOST="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).hostname)}catch{console.log('')}" 2>/dev/null || true)"
fi
if [ "$DB_HOST" = "localhost" ] || [ "$DB_HOST" = "127.0.0.1" ] || [ "$DB_HOST" = "::1" ]; then
  # TCP reachability probe (node — always available; no psql dependency).
  PORT_NUM="$(node -e "try{console.log(new URL(process.env.DATABASE_URL).port||'5432')}catch{console.log('')}" 2>/dev/null || true)"
  if node -e "
    const net=require('net');
    const s=net.connect(${PORT_NUM:-5432}, '127.0.0.1');
    s.on('connect',()=>process.exit(0));
    s.on('error',()=>process.exit(1));
    setTimeout(()=>process.exit(1), 3000);
  " 2>/dev/null; then
    echo "→ Using localhost DATABASE_URL (host $DB_HOST:$PORT_NUM) as the test database."
    DIRECT_URL="${DIRECT_URL:-$DB_URL}" npx prisma migrate deploy
    echo "✅ Test database ready: $DB_URL"
    exit 0
  fi
  echo "→ Localhost DATABASE_URL is not reachable — falling through to isolated cluster."
fi

# ── 2. Locate PostgreSQL binaries for the isolated cluster ───────────────
find_pg_bin() {
  if [ -n "${PG_BIN:-}" ] && [ -x "$PG_BIN/initdb" ]; then
    echo "$PG_BIN"; return
  fi
  for base in "/c/Program Files/PostgreSQL/16/bin" "/c/PostgreSQL/16/bin" \
              "/usr/lib/postgresql/16/bin" "/opt/homebrew/opt/postgresql@16/bin"; do
    if [ -x "$base/initdb" ]; then
      echo "$base"; return
    fi
  done
  if command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
    dirname "$(command -v initdb)"
    return
  fi
  echo ""
}

PG_BIN="$(find_pg_bin)"
if [ -z "$PG_BIN" ]; then
  echo "❌ No isolated test database available AND PostgreSQL 16 binaries not found." >&2
  echo "   Install PostgreSQL 16 (or set PG_BIN=/path/to/postgres/bin), or export" >&2
  echo "   DATABASE_URL_TEST=<isolated test database URL>." >&2
  exit 1
fi
INITDB="$PG_BIN/initdb"
PG_CTL="$PG_BIN/pg_ctl"
CREATEDB="$PG_BIN/createdb"
PSQL="$PG_BIN/psql"

TEST_URL="postgresql://$TEST_SUPERUSER@127.0.0.1:$TEST_PORT/$TEST_DB"
mkdir -p "$ROOT/.testdb"

# ── 3. Initialize the cluster (first run only) ────────────────────────────
if [ ! -f "$PGDATA_DIR/PG_VERSION" ]; then
  echo "→ Initializing isolated test cluster at .testdb/pgdata (port $TEST_PORT)…"
  "$INITDB" -D "$PGDATA_DIR" -U "$TEST_SUPERUSER" --auth=trust --encoding=UTF8 >/dev/null 2>&1 \
    || { echo "❌ initdb failed — see error above. Remove .testdb/ and retry." >&2; exit 1; }
  echo "listen_addresses = '127.0.0.1'" >> "$PGDATA_DIR/postgresql.conf"
fi

# ── 4. Start the cluster if it isn't already running ──────────────────────
if ! "$PG_CTL" -D "$PGDATA_DIR" status >/dev/null 2>&1; then
  echo "→ Starting isolated test cluster on port $TEST_PORT…"
  "$PG_CTL" -D "$PGDATA_DIR" -l "$PGLOG" -o "-p $TEST_PORT" start >/dev/null 2>&1 \
    || { echo "❌ pg_ctl start failed. Check $PGLOG" >&2; exit 1; }
  for _ in $(seq 1 20); do
    if "$PSQL" -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_SUPERUSER" -d postgres -c "SELECT 1" >/dev/null 2>&1; then
      break
    fi
    sleep 0.5
  done
fi

# ── 5. Create the test database (idempotent) ──────────────────────────────
if ! "$PSQL" -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_SUPERUSER" -d postgres -tAc \
     "SELECT 1 FROM pg_database WHERE datname='$TEST_DB'" | grep -q 1; then
  echo "→ Creating database '$TEST_DB'…"
  "$CREATEDB" -h 127.0.0.1 -p "$TEST_PORT" -U "$TEST_SUPERUSER" "$TEST_DB"
fi

# ── 6. Write .env.test (never committed — .gitignore has .env*) ──────────
cat > "$ENV_TEST_FILE" <<EOF
# Auto-generated by scripts/test-db/setup.sh — isolated LOCAL test database.
# Loaded by vitest.setup.ts BEFORE .env.local so tests can never reach the
# production DATABASE_URL.
DATABASE_URL_TEST=$TEST_URL
DIRECT_URL_TEST=$TEST_URL
EOF
echo "→ Wrote .env.test (DATABASE_URL_TEST=$TEST_URL)"

# ── 7. Apply migrations ───────────────────────────────────────────────────
echo "→ Applying Prisma migrations…"
DATABASE_URL="$TEST_URL" DIRECT_URL="$TEST_URL" npx prisma migrate deploy

echo "✅ Test database ready: $TEST_URL"
