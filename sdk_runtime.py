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
        return self._harness

    def close(self) -> None:
        with self._lock:
            if self._harness is not None:
                self._harness.close()
                self._harness = None

    def stream(self, message: str, session_id: str | None = None) -> Iterator[dict[str, Any]]:
        session = session_id or f"siriagent-{uuid.uuid4()}"
        events: queue.Queue[dict[str, Any] | None] = queue.Queue()

        def push(payload: dict[str, Any]) -> None:
            events.put(payload)

        def on_notification(notification: Any) -> None:
            if notification.method != "session.event":
                return
            event = (notification.payload or {}).get("event") or {}
            mapped = _map_event(event)
            if mapped:
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
                push({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
            finally:
                events.put(None)

        push({"type": "session", "session_id": session})
        threading.Thread(target=worker, name="dsh-sdk-stream", daemon=True).start()
        while True:
            item = events.get()
            if item is None:
                break
            yield item


def _map_event(event: dict[str, Any]) -> dict[str, Any] | None:
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
        text = "\n".join(
            str(block.get("text") or "") for block in blocks if block.get("type") == "text"
        ).strip()
        reasoning = "\n".join(
            str(block.get("text") or "") for block in blocks if block.get("type") == "reasoning"
        ).strip()
        if text:
            return {"type": "text", "text": text, "replace": True}
        if reasoning:
            return {"type": "reasoning", "text": reasoning}
        return None
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
