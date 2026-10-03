#!/usr/bin/env bash
# Start the DocPilot visualiser locally. Backend + frontend, one command.
#   ./run.sh                      demo graph, no keys needed
#   ./run.sh ../output/foo_kg.h5  your real crawled graph
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
PY="$REPO/.venv/bin/python"
GRAPH="${1:-}"

[[ -x "$PY" ]] || { echo "no venv at $PY — run: uv venv .venv && uv pip install -r requirements.txt"; exit 1; }

cleanup() { echo; echo "stopping…"; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▸ backend  http://localhost:8000"
if [[ -n "$GRAPH" ]]; then
  echo "  graph: $GRAPH"
  ( cd "$HERE/backend" && DOCPILOT_GRAPH="$GRAPH" "$PY" -m uvicorn server:app --port 8000 --host 0.0.0.0 ) &
else
  echo "  graph: demo (pass a path to *_kg.h5 to use a real crawl)"
  ( cd "$HERE/backend" && "$PY" -m uvicorn server:app --port 8000 --host 0.0.0.0 ) &
fi

sleep 2
echo "▸ frontend http://localhost:5173"
LAN=$(ip -4 addr show scope global 2>/dev/null | grep -oP 'inet \K[\d.]+' | head -1 || true)
[[ -n "$LAN" ]] && echo "  on your phone: http://$LAN:5173"
echo
( cd "$HERE/frontend" && npm run dev -- --port 5173 --host 0.0.0.0 ) &

wait
