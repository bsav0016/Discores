#!/usr/bin/env bash
# Runs the SQL tests: builds a scratch database, applies every migration in order, then each *.test.sql file.
#   Needs a PostgreSQL server (any recent version) and the standard PG* variables (PGHOST, PGPORT, PGUSER, PGPASSWORD).
#   The scratch database is dropped and recreated each time; point it at a throwaway server, never a real project.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
db="${SQL_TEST_DB:-discores_sql_test}"

psql -v ON_ERROR_STOP=1 -qAt -d postgres -c "drop database if exists \"$db\" with (force)" -c "create database \"$db\""
export PGDATABASE="$db"

psql -v ON_ERROR_STOP=1 -q -f "$here/stubs.sql"
for f in "$here"/../migrations/*.sql; do
  echo "applying $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done
for f in "$here"/*.test.sql; do
  echo "running $(basename "$f")"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
