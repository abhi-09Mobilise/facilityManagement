#!/usr/bin/env bash
# Start the floor-scan FastAPI service.
# Reads HOST/PORT from .env (loaded by the python-dotenv-style export below
# so uvicorn picks them up too).
set -euo pipefail
cd "$(dirname "$0")"

# Activate venv if present.
if [ -d ".venv" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

# Export .env keys to the current shell (skips blank lines + comments).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-5001}"

exec uvicorn app:app --host "$HOST" --port "$PORT" --workers 1
