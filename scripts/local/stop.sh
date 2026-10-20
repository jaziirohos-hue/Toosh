#!/usr/bin/env bash
# Stops the Toosh API. Add --with-db to also stop the local PostgreSQL cluster.
set -uo pipefail
cd "$(dirname "$0")/../.."
if [ -f .run/server.pid ]; then
  pid=$(cat .run/server.pid)
  # npm runs node as a child: stop the whole process group started by start.sh.
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for i in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  rm -f .run/server.pid; echo "Toosh API stopped"
else echo "Toosh API was not running"; fi
if [ "${1:-}" = "--with-db" ]; then
  su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D ${TOOSH_PGDATA:-/var/lib/postgresql/toosh-data} stop -m fast" && echo "PostgreSQL stopped"
fi
