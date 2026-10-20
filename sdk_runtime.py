from __future__ import annotations

import atexit
import json
import os
import queue
import shutil
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

try:
    from deepseek_harness import DeepSeekHarness
except ImportError:  # 允许未安装 SDK 时仍启动 Flask
    DeepSeekHarness = None  # type: ignore[assignment,misc]

PROJECT_ROOT = Path(__file__).resolve().parent
PATCH_FILE = PROJECT_ROOT / "headless.patch.yml"
DSH_HOME = Path(os.environ.get("SDK_DSH_HOME", str(Path.home() / ".dsh-siriagent")))
DSH_ROOT = Path(
    os.environ.get(
        "DSH_ROOT",
        "/home/siri/Documents/Qoder/2026-10-18/146d1f32/deepseek-harness",
    )
)
DSH_BIN = Path(os.environ.get("DSH_CLI", str(DSH_ROOT / "apps" / "cli" / "lib" / "bin.js")))
NODE_DIR = Path(os.environ.get("NODE_BIN", "/home/siri/local/node-v22.20.0-linux-x64/bin/node")).parent
PROVIDER = os.environ.get("DSH_PROVIDER", "deepseek-official")
MODEL = os.environ.get("DSH_MODEL", "deepseek-flash")


class HarnessManager:
    """一个常驻 SDK runtime；同一时刻只跑一轮，事件通过队列流出。"""

    def __init__(self) -> None:
        self._harness: DeepSeekHarness | None = None
        self._lock = threading.Lock()
        self._events: queue.Queue[dict[str, Any] | None] | None = None
        self._questions: dict[str, tuple[threading.Event, dict[str, Any]]] = {}
        self._questions_lock = threading.Lock()
        self._pump: threading.Thread | None = None

    def _ensure_home(self) -> None:
        DSH_HOME.mkdir(parents=True, exist_ok=True)
        credentials = DSH_HOME / ".credentials.yaml"
        source = Path.home() / ".dsh" / ".credentials.yaml"
        if not credentials.exists() and source.exists():
            shutil.copy2(source, credentials)

    def _ensure(self) -> DeepSeekHarness:
        if self._harness is not None:
            return self._harness
        if DeepSeekHarness is None:
            raise RuntimeError(
                "未安装 deepseek-harness-sdk；见 README 的 SDK 流式安装命令"
            )
        if not DSH_BIN.is_file():
            raise RuntimeError(f"找不到 DSH CLI：{DSH_BIN}")
        self._ensure_home()
        env = os.environ.copy()
        env.pop("ALL_PROXY", None)
        env.pop("all_proxy", None)
        env["PATH"] = f"{NODE_DIR}:{env.get('PATH', '')}"
        env.setdefault("NO_PROXY", "localhost,127.0.0.1,::1")
        self._harness = DeepSeekHarness(
            dsh_home=str(DSH_HOME),
            cwd=str(PROJECT_ROOT),
            dsh_bin=str(DSH_BIN),
            patches=(str(PATCH_FILE),),
            provider=PROVIDER,
            model=MODEL,
            env=env,
        )
        self._start_pump()
        return self._harness

    def _start_pump(self) -> None:
        if self._pump is not None or self._harness is None:
            return
        self._pump = threading.Thread(
            target=self._pump_requests, name="dsh-sdk-requests", daemon=True
        )
        self._pump.start()

    def _pump_requests(self) -> None:
        """消费运行时发来的 JSON-RPC 请求：目前只有 userQuestion/ask。"""
        harness = self._harness
        if harness is None:
            return
        client = harness.client
        while True:
            try:
                request = client.next_request()
            except Exception:  # noqa: BLE001 - 运行时关闭
                if self._pump is threading.current_thread():
                    self._pump = None
                return
            if request.method == "userQuestion/ask":
                self._answer_question(client, request)
            else:
                try:
                    client.respond_error(
                        request.id, code=-32601, message=f"unsupported method: {request.method}"
                    )
                except Exception:  # noqa: BLE001
                    return

    def _answer_question(self, client: Any, request: Any) -> None:
        payload = request.payload or {}
        call_id = str(payload.get("callId") or uuid.uuid4())
        waiter = threading.Event()
        box: dict[str, Any] = {}
        with self._questions_lock:
            self._questions[call_id] = (waiter, box)
        stream = self._events
        if stream is not None:
            stream.put(
                {
                    "type": "question",
                    "callId": call_id,
                    "questions": payload.get("questions") or [],
                }
            )
        # 没有超时：用户不回答就一直等，只有 SSE 断开（cancel_questions）
        # 或显式取消才释放这一轮。
        answered = waiter.wait()
        with self._questions_lock:
            self._questions.pop(call_id, None)
        try:
            answers = box.get("answers")
            if answered and isinstance(answers, list):
                client.respond(request.id, {"answers": answers})
            else:
                client.respond_error(
                    request.id, code=-32000, message="user did not answer the question"
                )
        except Exception:  # noqa: BLE001 - 运行时已关闭
            return

    def cancel_questions(self) -> None:
        """SSE 断开或用户取消时，让等待中的问题立即返回错误，避免占住单飞锁。"""
        with self._questions_lock:
            entries = list(self._questions.values())
        for waiter, box in entries:
            box.pop("answers", None)
            waiter.set()

    def abort(self) -> None:
        """取消未答问题并关闭当前 runtime，释放单轮锁。

        关闭走独立线程：worker 在 harness.run 期间持有 self._lock，
        这里不能去抢锁，否则会和正在等待的 run 互相卡死。
        """
        self.cancel_questions()
        harness = self._harness
        self._harness = None
        self._pump = None
        if harness is None:
            return


        def close() -> None:
            try:
                harness.close()
            except Exception:  # noqa: BLE001 - 关闭失败不影响下一轮重建
                pass

        threading.Thread(target=close, name="dsh-abort", daemon=True).start()

    def answer(self, call_id: str, answers: list[dict[str, Any]]) -> bool:
        with self._questions_lock:
            entry = self._questions.get(call_id)
        if entry is None:
            return False
        waiter, box = entry
        box["answers"] = answers
        waiter.set()
        return True

    def close(self) -> None:
        with self._lock:
            if self._harness is not None:
                self._harness.close()
                self._harness = None

    def stream(self, message: str, session_id: str | None = None) -> Iterator[dict[str, Any]]:
        # 新一轮开始前清掉上一轮遗留的未答问题，避免新消息排在锁后面无限等待。
        with self._questions_lock:
            has_pending = bool(self._questions)
        if has_pending:
            self.abort()
        # runtime 已被取消/重建时，旧 sessionId 在新进程里可能已持久化，
        # 继续复用会报 "session already exists"；此时开新会话。
        runtime_alive = self._harness is not None
        session = (
            session_id
            if runtime_alive and session_id
            else f"siriagent-{uuid.uuid4()}"
        )
        events: queue.Queue[dict[str, Any] | None] = queue.Queue()

        def push(payload: dict[str, Any]) -> None:
            events.put(payload)

        def on_notification(notification: Any) -> None:
            if notification.method != "session.event":
                return
            event = (notification.payload or {}).get("event") or {}
            mapped = _map_event(event)
            if isinstance(mapped, list):
                for item in mapped:
                    push(item)
            elif mapped:
                push(mapped)

        def worker() -> None:
            started = time.time()
            try:
                with self._lock:
                    harness = self._ensure()
                    result = harness.run(
                        message,
                        session_id=session,
                        on_notification=on_notification,
                    )
                push(
                    {
                        "type": "done",
                        "session_id": result.session_id or session,
                        "text": result.final_response,
                        "finish_reason": result.finish_reason,
                        "elapsed_ms": int((time.time() - started) * 1000),
                    }
                )
            except Exception as exc:  # noqa: BLE001 - 交给前端显示
                if type(exc).__name__ == "TransportClosedError":
                    push({"type": "notice", "message": "已取消本轮"})
                else:
                    push({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
            finally:
                if self._events is events:
                    self._events = None
                events.put(None)

        self._events = events
        push({"type": "session", "session_id": session})
        threading.Thread(target=worker, name="dsh-sdk-stream", daemon=True).start()
        while True:
            item = events.get()
            if item is None:
                break
            yield item


def _map_event(event: dict[str, Any]) -> dict[str, Any] | list[dict[str, Any]] | None:
    kind = event.get("type")
    data = event.get("data") or {}
    if kind == "tool/call":
        return {
            "type": "tool_call",
            "callId": data.get("callId"),
            "tool": data.get("name"),
            "input": _parse_json(data.get("arguments")),
        }
    if kind == "tool/result":
        message = data.get("message") or {}
        return {
            "type": "tool_result",
            "callId": message.get("toolCallId") or data.get("callId"),
            "status": "completed",
            "result": _content_text(message.get("content")),
        }
    if kind == "assistant/message":
        message = data.get("message") or {}
        blocks = message.get("content") or []
        mapped: list[dict[str, Any]] = []
        for block in blocks:
            block_type = block.get("type")
            text = str(block.get("text") or "").strip()
            if not text:
                continue
            if block_type == "reasoning":
                mapped.append({"type": "reasoning", "text": text})
            elif block_type == "text":
                mapped.append({"type": "text", "text": text, "replace": True})
        return mapped or None
    if kind == "turn/end":
        reason = (data.get("reason") or {}).get("kind")
        if reason and reason != "completed":
            return {"type": "notice", "message": f"turn ended: {reason}"}
    return None


def _parse_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


def _content_text(content: Any) -> str:
    if not isinstance(content, list):
        return "" if content is None else str(content)
    parts = [
        str(item.get("text") or "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text"
    ]
    return "\n".join(part for part in parts if part).strip()


manager = HarnessManager()
atexit.register(manager.close)
