#!/usr/bin/env bash
cd "$(dirname "$0")/../.."
pg_isready -h 127.0.0.1 -p 5432 || true
if [ -f .run/server.pid ] && kill -0 "$(cat .run/server.pid)" 2>/dev/null; then echo "Toosh API running (pid $(cat .run/server.pid))"; else echo "Toosh API not running"; fi
curl -s -o /dev/null -w "GET http://localhost:8787/ -> %{http_code}\n" http://127.0.0.1:8787/ || true
