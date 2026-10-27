#!/usr/bin/env bash
# Spins up a throwaway Postgres 16, loads the Supabase stub + migrations, runs the security & billing tests.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BIN=/usr/lib/postgresql/16/bin
PORT=${DB_TEST_PORT:-$((54000 + RANDOM % 900))}
DATA=$(mktemp -d)
chown postgres "$DATA"
su postgres -c "$BIN/initdb -D $DATA -A trust -U postgres >/dev/null"
su postgres -c "$BIN/pg_ctl -D $DATA -o '-k /tmp -p $PORT' -l $DATA/log start >/dev/null"
trap 'su postgres -c "$BIN/pg_ctl -D $DATA stop -m fast >/dev/null"; rm -rf $DATA' EXIT
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "create database styile" >/dev/null
$PSQL -d styile -f "$HERE/supabase_stub.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do $PSQL -d styile -f "$f" >/dev/null; done
$PSQL -d styile -f "$ROOT/supabase/seed.sql" >/dev/null 2>&1 || true
$PSQL -d styile -f "$HERE/tests.sql" 2>&1 | grep -E "ok  |FAIL|ERROR|PASSED|^invoice" | sed "s/^.*NOTICE:  /  /"
