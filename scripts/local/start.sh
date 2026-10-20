#!/usr/bin/env bash
# Starts the local Toosh stack: PostgreSQL (if not running) and the API + web app on http://localhost:8787.
set -euo pipefail
cd "$(dirname "$0")/../.."
RUN=.run; mkdir -p "$RUN"
PGDATA=${TOOSH_PGDATA:-/var/lib/postgresql/toosh-data}
PGBIN=${TOOSH_PGBIN:-/usr/lib/postgresql/16/bin}
mkdir -p /var/run/postgresql && chown postgres:postgres /var/run/postgresql 2>/dev/null || true
if ! su postgres -s /bin/bash -c "$PGBIN/pg_ctl -D $PGDATA status" >/dev/null 2>&1; then
  su postgres -s /bin/bash -c "setsid $PGBIN/pg_ctl -D $PGDATA -o '-k /var/run/postgresql' -l $PGDATA/log start" >/dev/null
fi
for i in $(seq 1 30); do pg_isready -q -h 127.0.0.1 -p 5432 && break; sleep 1; done
pg_isready -q -h 127.0.0.1 -p 5432 || { echo "PostgreSQL did not start (see $PGDATA/log)"; exit 1; }
if [ -f "$RUN/server.pid" ] && kill -0 "$(cat "$RUN/server.pid")" 2>/dev/null; then echo "Toosh API already running (pid $(cat "$RUN/server.pid"))"; exit 0; fi
setsid nohup npm run start -w server >> "$RUN/server.log" 2>&1 < /dev/null &
echo $! > "$RUN/server.pid"
for i in $(seq 1 30); do curl -sf http://127.0.0.1:8787/api/v1/health >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8787/api/v1/health >/dev/null || { echo "Toosh API did not start; last log lines:"; tail -n 20 "$RUN/server.log"; exit 1; }
echo "Toosh is running on http://localhost:8787 (pid $(cat "$RUN/server.pid"), log $RUN/server.log)"
