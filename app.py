from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
PATCH_FILE = PROJECT_ROOT / "headless.patch.yml"

DSH_ROOT = Path(
    os.environ.get(
        "DSH_ROOT",
        "/home/siri/Documents/Qoder/2026-10-18/146d1f32/deepseek-harness",
    )
)
DSH_CLI = Path(os.environ.get("DSH_CLI", str(DSH_ROOT / "apps" / "cli" / "lib" / "bin.js")))
NODE_BIN = os.environ.get(
    "NODE_BIN",
    shutil.which("node") or "/home/siri/local/node-v22.20.0-linux-x64/bin/node",
)
DSH_TIMEOUT = int(os.environ.get("DSH_TIMEOUT", "240"))
MAX_MESSAGE_CHARS = int(os.environ.get("MAX_MESSAGE_CHARS", "12000"))

app = Flask(__name__, static_folder=None)


def _event_text(events: list[dict], event_type: str) -> str:
    parts = [
        str(event.get("text", ""))
        for event in events
        if event.get("type") == event_type and event.get("text")
    ]
    return "\n".join(parts).strip()


def _last_usage(events: list[dict]) -> dict | None:
    for event in reversed(events):
        if event.get("type") == "status" and isinstance(event.get("usage"), dict):
            return event["usage"]
    return None


def _error_message(events: list[dict], stderr: str, returncode: int) -> str:
    for event in reversed(events):
        if event.get("type") == "error":
            message = event.get("message") or event.get("error")
            if message:
                return str(message)
    lines = [line.strip() for line in stderr.splitlines() if line.strip()]
    if lines:
        return lines[-1]
    return f"DSH 退出码 {returncode}，没有返回可用的错误信息。"


def _dsh_env() -> dict[str, str]:
    env = os.environ.copy()
    # DSH 的 Go 侧只接受 HTTP(S) 代理；SOCKS 的 all_proxy 会触发告警。
    for key in ("ALL_PROXY", "all_proxy"):
        env.pop(key, None)
    env.setdefault("NO_PROXY", "localhost,127.0.0.1,::1")
    env.setdefault("NO_PROXY".lower(), env["NO_PROXY"])
    proxy = os.environ.get("DSH_PROXY")
    if proxy:
        env["HTTPS_PROXY"] = proxy
        env["HTTP_PROXY"] = proxy
        env["https_proxy"] = proxy
        env["http_proxy"] = proxy
    return env


def _chat_command(message: str, session_id: str | None) -> list[str]:
    command = [
        NODE_BIN,
        str(DSH_CLI),
        "--profile",
        "headless",
        "--patch",
        str(PATCH_FILE),
        "--json",
    ]
    if session_id:
        command.extend(["--session-id", session_id])
    command.append(message)
    return command


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/health")
def health():
    ready = DSH_CLI.is_file() and PATCH_FILE.is_file() and Path(NODE_BIN).is_file()
    return jsonify(
        {
            "ok": True,
            "dsh_ready": ready,
            "dsh_cli": str(DSH_CLI),
            "dsh_patch": str(PATCH_FILE),
            "node": NODE_BIN,
            "cwd": str(PROJECT_ROOT),
            "timeout_seconds": DSH_TIMEOUT,
        }
    )


@app.post("/api/chat")
def chat():
    body = request.get_json(silent=True) or {}
    message = str(body.get("message", "")).strip()
    session_id = str(body.get("session_id") or "").strip() or None

    if not message:
        return jsonify({"ok": False, "error": "消息不能为空。"}), 400
    if len(message) > MAX_MESSAGE_CHARS:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"消息太长（{len(message)} 字符），上限 {MAX_MESSAGE_CHARS}。",
                }
            ),
            413,
        )
    if not DSH_CLI.is_file():
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"找不到 DSH CLI：{DSH_CLI}。请设置 DSH_ROOT 或 DSH_CLI。",
                }
            ),
            503,
        )
    if not PATCH_FILE.is_file():
        return jsonify({"ok": False, "error": f"找不到 headless patch：{PATCH_FILE}。"}), 503
    if not Path(NODE_BIN).is_file():
        return jsonify({"ok": False, "error": f"找不到 node：{NODE_BIN}。"}), 503

    started = time.time()
    try:
        process = subprocess.run(
            _chat_command(message, session_id),
            cwd=str(PROJECT_ROOT),
            env=_dsh_env(),
            text=True,
            capture_output=True,
            timeout=DSH_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": f"DSH 在 {DSH_TIMEOUT} 秒内没有完成。可以缩短问题或稍后重试。",
                    "session_id": session_id,
                }
            ),
            504,
        )
    except OSError as exc:
        return jsonify({"ok": False, "error": f"启动 DSH 失败：{exc}"}), 500

    events: list[dict] = []
    for line in process.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            events.append(payload)

    session_event = next((event for event in events if event.get("type") == "session"), None)
    returned_session_id = (session_event or {}).get("sessionId") or session_id
    final_event = next((event for event in reversed(events) if event.get("type") == "final"), None)
    final_text = str((final_event or {}).get("text") or "").strip()
    if not final_text:
        final_text = _event_text(events, "text")

    if process.returncode != 0:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": _error_message(events, process.stderr, process.returncode),
                    "session_id": returned_session_id,
                }
            ),
            502,
        )

    return jsonify(
        {
            "ok": True,
            "session_id": returned_session_id,
            "text": final_text or "（DSH 没有返回文本。）",
            "thinking": _event_text(events, "thinking"),
            "usage": _last_usage(events),
            "elapsed_ms": int((time.time() - started) * 1000),
            "events": len(events),
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), threaded=True)
