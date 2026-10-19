from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory, stream_with_context

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
WEB_DIST = PROJECT_ROOT / "web" / "dist"
PATCH_FILE = PROJECT_ROOT / "headless.patch.yml"
SKILLS_DIR = PROJECT_ROOT / "skills"
RS_SERVICE_BASE = os.environ.get("RS_SERVICE_BASE", "http://127.0.0.1:8766/api/v1")

from sdk_runtime import manager  # noqa: E402  (项目根模块)
_RS_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))

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


def _tool_events(events: list[dict]) -> list[dict]:
    calls: dict[str, dict] = {}
    order: list[str] = []
    for event in events:
        if event.get("type") == "tool_call":
            call_id = str(event.get("callId") or "")
            calls[call_id] = {
                "callId": call_id,
                "tool": event.get("tool"),
                "input": event.get("input"),
            }
            order.append(call_id)
        elif event.get("type") == "tool_result":
            call_id = str(event.get("callId") or "")
            if call_id in calls:
                calls[call_id]["status"] = event.get("status")
                calls[call_id]["result"] = event.get("result")
    return [calls[call_id] for call_id in order]


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
    if (WEB_DIST / "index.html").is_file():
        return send_from_directory(WEB_DIST, "index.html")
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/rs/<path:subpath>")
def rs_proxy(subpath: str):
    """把浏览器请求反代到本机 RS-Service；浏览器不直连 8766。"""
    query = request.query_string.decode()
    url = f"{RS_SERVICE_BASE}/{subpath}" + (f"?{query}" if query else "")
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    for attempt in range(2):
        try:
            with _RS_OPENER.open(req, timeout=30) as resp:
                return Response(
                    resp.read(),
                    status=resp.status,
                    content_type=resp.headers.get("Content-Type", "application/json"),
                )
        except urllib.error.HTTPError as exc:
            if exc.code >= 500 and attempt == 0:
                time.sleep(0.15)
                continue
            return Response(
                exc.read(),
                status=exc.code,
                content_type=exc.headers.get("Content-Type", "application/json"),
            )
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 0:
                time.sleep(0.15)
                continue
            app.logger.warning("RS-Service proxy failed for %s: %s", subpath, exc)
            return jsonify({"ok": False, "error": f"RS-Service 不可达：{exc}"}), 502


@app.get("/<path:filename>")
def frontend_files(filename: str):
    if (WEB_DIST / filename).is_file():
        return send_from_directory(WEB_DIST, filename)
    if (STATIC_DIR / filename).is_file():
        return send_from_directory(STATIC_DIR, filename)
    if (WEB_DIST / "index.html").is_file():
        return send_from_directory(WEB_DIST, "index.html")
    return jsonify({"ok": False, "error": "not found"}), 404


_BALANCE_CACHE: dict[str, object] = {"at": 0.0, "payload": None}


def _read_deepseek_key() -> str | None:
    env = os.environ.get("DEEPSEEK_API_KEY")
    if env:
        return env.strip()
    for path in (
        PROJECT_ROOT / ".credentials.yaml",
        Path.home() / ".dsh-siriagent" / ".credentials.yaml",
        Path.home() / ".dsh" / ".credentials.yaml",
    ):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"^\s*DEEPSEEK_API_KEY:\s*(\S+)\s*$", text, re.MULTILINE)
        if match:
            return match.group(1).strip()
    return None


def _fetch_balance() -> dict:
    key = _read_deepseek_key()
    if not key:
        return {"ok": False, "error": "missing_api_key"}
    request = urllib.request.Request(
        "https://api.deepseek.com/user/balance",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    try:
        with _RS_OPENER.open(request, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        return {"ok": False, "error": f"http_{exc.code}"}
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {"ok": False, "error": type(exc).__name__}
    infos = data.get("balance_infos") or []
    if not infos:
        return {"ok": False, "error": "empty_balance"}
    info = infos[0]
    return {
        "ok": True,
        "available": bool(data.get("is_available")),
        "currency": info.get("currency", "CNY"),
        "total": info.get("total_balance"),
        "granted": info.get("granted_balance"),
        "topped_up": info.get("topped_up_balance"),
        "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _skill_meta(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8", errors="ignore")
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    meta: dict[str, str] = {}
    for line in parts[1].splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    if not meta.get("name"):
        return None
    return {
        "name": meta["name"],
        "description": meta.get("description", ""),
        "when_to_use": meta.get("when-to-use") or meta.get("when_to_use", ""),
        "path": str(path.relative_to(PROJECT_ROOT)),
    }


@app.get("/api/balance")
def balance() -> Response:
    refresh = request.args.get("refresh") == "1"
    now = time.time()
    cached = _BALANCE_CACHE.get("payload")
    if not refresh and cached and now - float(_BALANCE_CACHE.get("at") or 0) < 60:
        return jsonify(cached)
    payload = _fetch_balance()
    _BALANCE_CACHE["at"] = now
    _BALANCE_CACHE["payload"] = payload
    return jsonify(payload)


@app.get("/api/skills")
def skills() -> Response:
    items = []
    if SKILLS_DIR.is_dir():
        for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
            meta = _skill_meta(path)
            if meta:
                items.append(meta)
    return jsonify({"items": items})


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
            "frontend": "web/dist" if (WEB_DIST / "index.html").is_file() else "static",
            "rs_service": RS_SERVICE_BASE,
            "timeout_seconds": DSH_TIMEOUT,
        }
    )


@app.post("/api/chat/stream")
def chat_stream():
    """SDK 事件流：tool_call / tool_result / text / done，直接以 SSE 返回。"""
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

    def generate():
        events: queue.Queue[dict | None] = queue.Queue()

        def pump() -> None:
            try:
                for item in manager.stream(message, session_id):
                    events.put(item)
            except Exception as exc:  # noqa: BLE001 - 转成 SSE error
                events.put({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
            finally:
                events.put(None)

        threading.Thread(target=pump, name="sse-pump", daemon=True).start()
        yield "retry: 3000\n\n"
        while True:
            try:
                event = events.get(timeout=10)
            except queue.Empty:
                yield ": keep-alive\n\n"
                continue
            if event is None:
                break
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
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
            "tool_calls": _tool_events(events),
            "elapsed_ms": int((time.time() - started) * 1000),
            "events": len(events),
        }
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), threaded=True)
