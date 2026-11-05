#!/usr/bin/env bash
# Cloudflare 隧道健康检查：HA 连接归零且 15 秒内未恢复时重启 cloudflared。
# 由 cloudflared-healthcheck.timer 每分钟调用；日志写入 journal（tag: tunnel-healthcheck）。
set -uo pipefail

PUBLIC_URL="${PUBLIC_URL:-https://siriagent.dpdns.org/}"
METRICS_PORTS="${METRICS_PORTS:-20241 20242 20243 20244 20245}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/siriagent"
LOG_FILE="$STATE_DIR/tunnel-healthcheck.log"

mkdir -p "$STATE_DIR"

log() {
  local line
  line="$(date -Is) $*"
  echo "$line"
  logger -t tunnel-healthcheck -- "$*" 2>/dev/null || true
  printf '%s\n' "$line" >>"$LOG_FILE"
  tail -n 500 "$LOG_FILE" >"$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
}

read_connections() {
  local port value
  for port in $METRICS_PORTS; do
    value="$(curl -fsS --max-time 3 "http://127.0.0.1:${port}/metrics" 2>/dev/null \
      | awk '/^cloudflared_tunnel_ha_connections /{print $2; exit}')"
    if [[ -n "${value}" ]]; then
      printf '%s\n' "$value"
      return 0
    fi
  done
  return 1
}

connections="$(read_connections || true)"
if [[ -z "${connections}" ]]; then
  http="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$PUBLIC_URL" 2>/dev/null || true)"
  log "metrics 不可读，公网入口 http=${http:-000}"
  # metrics 不可读且公网 5xx：隧道或进程可能已异常，15 秒后复查再重启。
  if [[ "${http:-000}" =~ ^5[0-9][0-9]$ ]]; then
    sleep 15
    connections="$(read_connections || true)"
    if [[ -z "${connections}" ]]; then
      log "复查仍不可读，重启 cloudflared"
      systemctl --user restart cloudflared
      sleep 5
      log "重启后 HA 连接=$(read_connections || echo '?')"
    fi
  fi
  exit 0
fi

if (( connections == 0 )); then
  log "HA 连接为 0（Cloudflare 会返回 1033），15 秒后复查"
  sleep 15
  connections="$(read_connections || true)"
  if [[ -z "${connections}" || "${connections}" == "0" ]]; then
    log "复查仍为 0，重启 cloudflared"
    systemctl --user restart cloudflared
    sleep 5
    log "重启后 HA 连接=$(read_connections || echo '?')"
  else
    log "已自愈，HA 连接=${connections}"
  fi
else
  log "HA 连接=${connections}"
fi
