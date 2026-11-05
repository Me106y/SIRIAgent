from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file, send_from_directory, stream_with_context

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_DIR = PROJECT_ROOT / "static"
WEB_DIST = PROJECT_ROOT / "web" / "dist"
PATCH_FILE = PROJECT_ROOT / "headless.patch.yml"
SKILLS_DIR = PROJECT_ROOT / "skills"
RS_SERVICE_BASE = os.environ.get("RS_SERVICE_BASE", "http://127.0.0.1:8766/api/v1")

from sdk_runtime import Turn, TurnBusy, manager  # noqa: E402  (项目根模块)
_RS_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _cache_policy(subpath: str) -> str:
    """按数据新鲜度分层缓存：目录/详情日更，轨迹/过境/位置是秒级动态数据。"""
    if subpath == "positions":
        return "no-store"
    if subpath.startswith("satellites/"):
        if subpath.endswith("/track") or subpath.endswith("/passes"):
            return "no-store"
        return "public, max-age=300"
    if subpath == "satellites":
        return "public, max-age=300"
    if subpath.startswith("aoi/"):
        return "public, max-age=3600"
    if subpath == "sync/status":
        return "public, max-age=60"
    return "no-store"


def _with_cache(response: Response, policy: str, body: bytes | None = None) -> Response:
    """写入 Cache-Control；可缓存响应带 ETag，命中 If-None-Match 时回 304。"""
    response.headers["Cache-Control"] = policy
    if policy != "no-store" and body is not None:
        response.set_etag(hashlib.sha256(body).hexdigest()[:32])
        response = response.make_conditional(request)
    return response

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
# gunicorn 只把 WARNING 以上的 root 日志放出来；回合/答复日志是排查依据，显式开到 INFO。
app.logger.setLevel(logging.INFO)
logging.getLogger("siriagent.turns").setLevel(logging.INFO)


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
                body = resp.read()
                return _with_cache(
                    Response(
                        body,
                        status=resp.status,
                        content_type=resp.headers.get("Content-Type", "application/json"),
                    ),
                    _cache_policy(subpath),
                    body,
                )
        except urllib.error.HTTPError as exc:
            if exc.code >= 500 and attempt == 0:
                time.sleep(0.15)
                continue
            error = Response(
                exc.read(),
                status=exc.code,
                content_type=exc.headers.get("Content-Type", "application/json"),
            )
            error.headers["Cache-Control"] = "no-store"
            return error
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == 0:
                time.sleep(0.15)
                continue
            app.logger.warning("RS-Service proxy failed for %s: %s", subpath, exc)
            return jsonify({"ok": False, "error": f"RS-Service 不可达：{exc}"}), 502


def _rs_json(subpath: str) -> dict:
    """服务端直连 RS-Service 取 JSON（供 bootstrap 合并首屏请求）。"""
    url = f"{RS_SERVICE_BASE}/{subpath}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with _RS_OPENER.open(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


@app.get("/sw")
def service_worker():
    """无扩展名路径：Cloudflare 不按静态资源缓存，SW 更新能立即生效。"""
    response = send_from_directory(WEB_DIST, "sw.js")
    response.headers["Cache-Control"] = "no-cache, max-age=0"
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.get("/<path:filename>")
def frontend_files(filename: str):
    if (WEB_DIST / filename).is_file():
        response = send_from_directory(WEB_DIST, filename)
    elif (STATIC_DIR / filename).is_file():
        response = send_from_directory(STATIC_DIR, filename)
    elif (WEB_DIST / "index.html").is_file():
        response = send_from_directory(WEB_DIST, "index.html")
    else:
        return jsonify({"ok": False, "error": "not found"}), 404
    if filename.startswith("assets/"):
        # Vite 产物带内容哈希：下载一次后长期复用，升级时 URL 自然变化。
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif filename.startswith("cesium/"):
        # Cesium 资源没有内容哈希，保守缓存 7 天；升级版本时再清一次。
        response.headers["Cache-Control"] = "public, max-age=604800"
    elif filename in ("sw.js", "index.html"):
        response.headers["Cache-Control"] = "no-cache"
    return response


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
        payload = cached
    else:
        payload = _fetch_balance()
        _BALANCE_CACHE["at"] = now
        _BALANCE_CACHE["payload"] = payload
    body = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    policy = "no-store" if refresh else "public, max-age=60"
    return _with_cache(jsonify(payload), policy, body)


@app.get("/api/bootstrap")
def bootstrap() -> Response:
    """首屏一次拿齐目录、星历与余额，少 3 个往返；星历是秒级数据，不缓存。"""
    try:
        satellites = _rs_json("satellites?limit=200")
        positions = _rs_json("positions")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, ValueError) as exc:
        return jsonify({"ok": False, "error": f"RS-Service 不可达：{exc}"}), 502
    response = jsonify(
        {
            "ok": True,
            "satellites": satellites,
            "positions": positions,
            "balance": _fetch_balance(),
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/skills")
def skills() -> Response:
    items = []
    if SKILLS_DIR.is_dir():
        for path in sorted(SKILLS_DIR.glob("*/SKILL.md")):
            meta = _skill_meta(path)
            if meta:
                items.append(meta)
    payload = {"items": items}
    body = json.dumps(payload, ensure_ascii=False).encode()
    return _with_cache(jsonify(payload), "public, max-age=3600", body)


@app.post("/api/question/answer")
def question_answer() -> Response:
    """前端答复 ask_user_question：{callId, answers:[{id, selected, custom?}]}。"""
    body = request.get_json(silent=True) or {}
    call_id = str(body.get("callId") or "").strip()
    answers = body.get("answers")
    if not call_id or not isinstance(answers, list):
        return jsonify({"ok": False, "error": "callId 与 answers 必填"}), 400
    ok = manager.answer(call_id, answers)
    if ok:
        app.logger.info("answer ok call_id=%s items=%d", call_id, len(answers))
    else:
        app.logger.warning("answer miss call_id=%s items=%d", call_id, len(answers))
    return jsonify({"ok": ok})


@app.post("/api/chat/cancel")
def chat_cancel() -> Response:
    """中止当前一轮：取消未答问题并重建 runtime，释放单轮锁。"""
    app.logger.info("turn cancel requested")
    manager.abort()
    return jsonify({"ok": True})


@app.get("/api/files")
def serve_generated_file() -> Response:
    """把模型生成的文件（报告等）安全地提供给前端点击打开。"""
    raw = (request.args.get("path") or "").strip()
    if not raw:
        return jsonify({"error": "missing path"}), 400
    candidate = Path(raw).expanduser()
    if not candidate.is_absolute():
        candidate = PROJECT_ROOT / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except (OSError, RuntimeError):
        return jsonify({"error": "not found"}), 404
    if not resolved.is_relative_to(PROJECT_ROOT):
        return jsonify({"error": "forbidden"}), 403
    if not resolved.is_file():
        return jsonify({"error": "not found"}), 404
    response = send_file(resolved, as_attachment=False, download_name=resolved.name)
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/config")
def public_config() -> Response:
    """前端可用的公开配置（高德 key 是客户端 key，不落仓库）。"""
    response = jsonify(
        {
            "amap_js_key": os.environ.get("AMAP_JS_KEY", ""),
            "amap_security_code": os.environ.get("AMAP_SECURITY_CODE", ""),
        }
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    ready = DSH_CLI.is_file() and PATCH_FILE.is_file() and Path(NODE_BIN).is_file()
    response = jsonify(
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
    response.headers["Cache-Control"] = "no-store"
    return response


def _sse_response(turn: Turn, cursor: int) -> Response:
    """把回合事件按游标以 SSE 推给浏览器；客户端断开只 detach，不终止回合。"""

    def generate():
        yield "retry: 3000\n\n"
        for item in manager.attach(turn, cursor):
            if item is None:
                yield ": keep-alive\n\n"
                continue
            seq, event = item
            yield f"id: {seq}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
            "X-Turn-Id": turn.id,
        },
    )


def _turn_cursor() -> int:
    """断线重连游标：优先 ?cursor=，其次 SSE 标准的 Last-Event-ID。"""
    raw = request.args.get("cursor")
    if raw is not None:
        try:
            return max(0, int(raw))
        except ValueError:
            return 0
    last = request.headers.get("Last-Event-ID")
    if last and last.isdigit():
        return int(last) + 1
    return 0


@app.post("/api/chat/turns")
def chat_turn_start():
    """开一轮对话，立刻返回 turn_id；事件走 SSE，断线可用 cursor 续读。"""
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
    try:
        turn = manager.start(message, session_id)
    except TurnBusy as exc:
        return jsonify({"ok": False, "busy": True, "error": str(exc)}), 409

    response = jsonify(
        {"ok": True, "turn_id": turn.id, "session_id": turn.session_id}
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/chat/turns/<turn_id>/events")
def chat_turn_events(turn_id: str):
    """续读某轮事件。浏览器断线后带 cursor 重连即可补发，不会打断模型。"""
    turn = manager.turn(turn_id)
    if turn is None:
        app.logger.warning("turn miss %s (events)", turn_id)
        return jsonify({"ok": False, "error": "turn_not_found", "turn_id": turn_id}), 404
    cursor = _turn_cursor()
    if cursor:
        app.logger.info("turn resume %s cursor=%d", turn_id, cursor)
    return _sse_response(turn, cursor)


@app.post("/api/chat/stream")
def chat_stream():
    """兼容旧入口：开一轮并直接 SSE 返回（新前端走 /api/chat/turns + 续读）。"""
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
    try:
        turn = manager.start(message, session_id)
    except TurnBusy as exc:
        return jsonify({"ok": False, "busy": True, "error": str(exc)}), 409
    return _sse_response(turn, 0)


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
