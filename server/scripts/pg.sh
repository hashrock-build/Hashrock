#!/usr/bin/env bash
# Manage the local (no-sudo) Postgres cluster used by the HASHROCK server.
# Usage: ./scripts/pg.sh [start|stop|status|psql]
# The cluster lives in ~/.local/hashrock-pgdata and listens on 127.0.0.1:5433.
set -euo pipefail
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
PGDATA="$HOME/.local/hashrock-pgdata"
PORT=5433

case "${1:-start}" in
  start)
    if [ ! -d "$PGDATA/base" ]; then
      "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth-local=trust --auth-host=trust
    fi
    "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp" -l "$PGDATA/server.log" start
    sleep 1
    "$PGBIN/createdb" -h 127.0.0.1 -p $PORT -U postgres hashrock 2>/dev/null || true
    "$PGBIN/pg_isready" -h 127.0.0.1 -p $PORT ;;
  stop)   "$PGBIN/pg_ctl" -D "$PGDATA" stop ;;
  status) "$PGBIN/pg_isready" -h 127.0.0.1 -p $PORT ;;
  psql)   "$PGBIN/psql" -h 127.0.0.1 -p $PORT -U postgres -d hashrock ;;
  *) echo "usage: $0 [start|stop|status|psql]"; exit 1 ;;
esac
