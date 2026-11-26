#!/bin/sh
set -e

if [ "$(id -u)" = "0" ]; then
  echo "Fixing permissions on /app/uploads..."
  chown -R node:node /app/uploads
  chmod -R 2777 /app/uploads

  if command -v su-exec >/dev/null 2>&1; then
    exec su-exec node "$0" "$@"
  elif command -v gosu >/dev/null 2>&1; then
    exec gosu node "$0" "$@"
  else
    echo "ERROR: su-exec or gosu not found!" >&2
    exit 1
  fi
else
  echo "WARNING: Container started as UID $(id -u) instead of root; skipping /app/uploads chown."
fi

echo "Running database migrations..."
npm run db:deploy

echo "Starting the application..."
exec "$@"