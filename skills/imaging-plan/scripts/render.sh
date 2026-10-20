#!/usr/bin/env bash
# 固定用项目 venv 渲染，避免 Agent 在不同解释器间找 jinja2。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../.." && pwd)"
PY="$ROOT/.venv/bin/python"
if [ ! -x "$PY" ]; then
  PY="$(command -v python3)"
fi
exec "$PY" "$DIR/render.py" "$@"
