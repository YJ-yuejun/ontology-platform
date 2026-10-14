#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

APP_PORT="${ONTOLOGY_MANUAL_PORT:-8021}"
APP_HOST="${ONTOLOGY_MANUAL_HOST:-0.0.0.0}"

if [ ! -f "$PROJECT_DIR/frontend/dist/index.html" ]; then
  (cd "$PROJECT_DIR/frontend" && npm run build)
fi

cd "$PROJECT_DIR/backend"
exec "$PROJECT_DIR/.venv/bin/uvicorn" main:app --host "$APP_HOST" --port "$APP_PORT"
