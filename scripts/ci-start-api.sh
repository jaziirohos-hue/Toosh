#!/usr/bin/env bash
# CI helper: create a normal (non-superuser, no BYPASSRLS) database role and start the API on :8787.
set -euo pipefail
ADMIN=${TEST_ADMIN_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}
psql "$ADMIN" -v ON_ERROR_STOP=1 -c "CREATE ROLE toosh LOGIN PASSWORD 'toosh' NOSUPERUSER NOBYPASSRLS" -c "CREATE DATABASE toosh OWNER toosh"
export DATABASE_URL=postgres://toosh:toosh@localhost:5432/toosh
export WEB_DIST=${WEB_DIST:-$PWD/app/dist} COOKIE_SECURE=false AUTH_RATE_LIMIT=1000 RATE_LIMIT=100000 HOST=0.0.0.0 PORT=8787 LOG_LEVEL=warn
nohup npm run start -w server > server.log 2>&1 &
for i in $(seq 1 60); do curl -sf localhost:8787/api/v1/health && exit 0; sleep 1; done
cat server.log; exit 1
