from __future__ import annotations

import atexit
import json
import logging
import os
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

log = logging.getLogger("siriagent.turns")
log.setLevel(logging.INFO)
if not log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s %(name)s: %(message)s")
    )
    log.addHandler(_handler)
    log.propagate = False

# 回合结束后事件保留多久，供断线重连补发；以及无客户端时回合最多再活多久。
TURN_TTL_SECONDS = float(os.environ.get("DSH_TURN_TTL", "900"))
ORPHAN_GRACE_SECONDS = float(os.environ.get("DSH_TURN_ORPHAN_GRACE", "180"))
HEARTBEAT_SECONDS = 10.0
ANSWER_TTL_SECONDS = 900.0


class TurnBusy(RuntimeError):
    """上一轮仍有客户端在流式读取，拒绝并行开新回合。"""


class Turn:
    """一轮对话的事件日志：先落盘到内存，再按游标分发给（可能重连的）SSE 客户端。

    浏览器与服务器之间隔着隧道（cloudflared），连接随时可能被掐断。回合不能
    跟着连接一起死，否则正在等用户回答的问题会被当成"用户没回答"，模型还会
    对着已经断开的流继续追问。这里把回合的生命周期和某条 HTTP 连接解耦。
    """

    def __init__(self, turn_id: str, session_id: str) -> None:
        self.id = turn_id
        self.session_id = session_id
        self.started_at = time.time()
        self.finished_at: float | None = None
        self._cond = threading.Condition()
        self._events: list[dict[str, Any]] = []
        self._closed = False
        self._subscribers = 0
        self._detached_at: float | None = None

    @property
    def closed(self) -> bool:
        with self._cond:
            return self._closed

    @property
    def subscribers(self) -> int:
        with self._cond:
            return self._subscribers

    @property
    def orphaned_since(self) -> float | None:
        """没有客户端接着读的起始时刻；有客户端在读时为 None。"""
        with self._cond:
            return self._detached_at

    def size(self) -> int:
        with self._cond:
            return len(self._events)

    def publish(self, payload: dict[str, Any]) -> None:
        with self._cond:
            if self._closed:
                return
            self._events.append(payload)
            self._cond.notify_all()

    def close(self) -> None:
        with self._cond:
            if self._closed:
                return
            self._closed = True
            self.finished_at = time.time()
            self._cond.notify_all()

    def attach(self) -> int:
        """登记一个读者；返回当前事件总数（新读者从头补发）。"""
        with self._cond:
            self._subscribers += 1
            self._detached_at = None
            return len(self._events)

    def detach(self) -> None:
        with self._cond:
            self._subscribers = max(0, self._subscribers - 1)
            if self._subscribers == 0:
                self._detached_at = time.time()

    def read(self, cursor: int, timeout: float = HEARTBEAT_SECONDS) -> tuple[list[tuple[int, dict[str, Any]]], bool]:
        """从 cursor 起取事件；没新事件时最多等 timeout，返回 (事件, 是否已结束)。"""
        deadline = time.monotonic() + timeout
        with self._cond:
            while not self._closed and cursor >= len(self._events):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                self._cond.wait(remaining)
            batch = list(enumerate(self._events[cursor:], start=cursor))
            return batch, self._closed


class HarnessManager:
    """一个常驻 SDK runtime；同一时刻只跑一轮，事件按回合记录。"""

    def __init__(self) -> None:
        self._harness: DeepSeekHarness | None = None
        self._lock = threading.Lock()
        self._start_lock = threading.Lock()
        self._turn: Turn | None = None
        self._turns: dict[str, Turn] = {}
        self._questions: dict[str, tuple[threading.Event, dict[str, Any], Turn | None]] = {}
        # 已答复的 callId：答复的 HTTP 响应可能丢（隧道抖动），客户端重试时据此幂等返回成功。
        self._answered: dict[str, float] = {}
        self._questions_lock = threading.Lock()
        self._pump: threading.Thread | None = None
        self._watchdog: threading.Thread | None = None

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
        turn = self._turn
        with self._questions_lock:
            self._questions[call_id] = (waiter, box, turn)
        if turn is not None:
            turn.publish(
                {
                    "type": "question",
                    "callId": call_id,
                    "questions": payload.get("questions") or [],
                }
            )
        # 没有超时：用户不回答就一直等，只有显式取消或回合被回收才释放。
        # 浏览器断线不再取消问题——回合会活着等客户端重连。
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

    def _pending_questions(self) -> list[tuple[threading.Event, dict[str, Any], Turn | None]]:
        with self._questions_lock:
            return list(self._questions.values())

    def cancel_questions(self, turn: Turn | None = None) -> None:
        """让等待中的问题立即返回错误，避免占住单飞锁。"""
        for waiter, box, owner in self._pending_questions():
            if turn is not None and owner is not None and owner is not turn:
                continue
            box.pop("answers", None)
            waiter.set()

    def abort(self) -> None:
        """取消未答问题并关闭当前 runtime，释放单轮锁。

        关闭走独立线程：worker 在 harness.run 期间持有 self._lock，
        这里不能去抢锁，否则会和正在等待的 run 互相卡死。
        """
        turn = self._turn
        log.warning("turn abort id=%s", turn.id if turn is not None else "-")
        self.cancel_questions(turn)
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
        """登记用户答复。同一个 callId 重复提交返回 True（响应丢失后的重试）。"""
        now = time.time()
        with self._questions_lock:
            entry = self._questions.get(call_id)
            if entry is None:
                return call_id in self._answered
            waiter, box, _turn = entry
            box["answers"] = answers
            self._answered[call_id] = now
            for stale, ts in list(self._answered.items()):
                if now - ts > ANSWER_TTL_SECONDS:
                    self._answered.pop(stale, None)
            waiter.set()
            return True

    def close(self) -> None:
        with self._lock:
            if self._harness is not None:
                self._harness.close()
                self._harness = None

    def turn(self, turn_id: str) -> Turn | None:
        with self._start_lock:
            return self._turns.get(turn_id)

    def start(self, message: str, session_id: str | None = None) -> Turn:
        """开一轮对话并把首事件（session）写进回合；调用方随后按游标读取。"""
        with self._start_lock:
            current = self._turn
            if current is not None and not current.closed:
                if current.subscribers > 0:
                    raise TurnBusy("上一轮仍在流式读取，请先停止或等待完成。")
                # 没有客户端在读：上一轮已被放弃，回收它再开新回合。
                self.abort()
            self._prune_turns()
            # runtime 已被取消/重建时，旧 sessionId 在新进程里可能已持久化，
            # 继续复用会报 "session already exists"；此时开新会话。
            runtime_alive = self._harness is not None
            session = (
                session_id
                if runtime_alive and session_id
                else f"siriagent-{uuid.uuid4()}"
            )
            turn = Turn(f"turn-{uuid.uuid4().hex[:12]}", session)
            self._turn = turn
            self._turns[turn.id] = turn
            turn.publish({"type": "session", "session_id": session})
            log.info("turn start id=%s session=%s chars=%d", turn.id, session, len(message))
            threading.Thread(
                target=self._run_turn,
                args=(turn, message, session),
                name="dsh-sdk-turn",
                daemon=True,
            ).start()
            self._ensure_watchdog()
            return turn

    def attach(self, turn: Turn, cursor: int = 0) -> Iterator[tuple[int, dict[str, Any]] | None]:
        """按游标读取回合事件；没有新事件时 yield None 作为保活信号。"""
        cursor = max(0, min(cursor, turn.size()))
        turn.attach()
        try:
            while True:
                batch, closed = turn.read(cursor)
                for seq, payload in batch:
                    cursor = seq + 1
                    yield seq, payload
                if closed and not batch:
                    return
                if not batch:
                    yield None
        finally:
            turn.detach()

    def _run_turn(self, turn: Turn, message: str, session: str) -> None:
        started = time.time()
        try:
            with self._lock:
                harness = self._ensure()
                result = harness.run(
                    message,
                    session_id=session,
                    on_notification=lambda notification: self._on_notification(turn, notification),
                )
            turn.publish(
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
                turn.publish({"type": "notice", "message": "已取消本轮"})
            else:
                turn.publish({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
                log.warning("turn error id=%s %s: %s", turn.id, type(exc).__name__, exc)
        finally:
            # 显式结束标记：客户端据此区分“正常收尾/被取消”和“连接被掐断”。
            turn.publish({"type": "closed"})
            turn.close()
            log.info("turn end id=%s", turn.id)
            with self._start_lock:
                if self._turn is turn:
                    self._turn = None

    def _on_notification(self, turn: Turn, notification: Any) -> None:
        if notification.method != "session.event":
            return
        event = (notification.payload or {}).get("event") or {}
        mapped = _map_event(event)
        if isinstance(mapped, list):
            for item in mapped:
                turn.publish(item)
        elif mapped:
            turn.publish(mapped)

    def _prune_turns(self) -> None:
        now = time.time()
        for turn_id, turn in list(self._turns.items()):
            finished = turn.finished_at
            if finished is not None and now - finished > TURN_TTL_SECONDS:
                self._turns.pop(turn_id, None)

    def _ensure_watchdog(self) -> None:
        if self._watchdog is not None:
            return
        self._watchdog = threading.Thread(
            target=self._watchdog_loop, name="dsh-turn-watchdog", daemon=True
        )
        self._watchdog.start()

    def _watchdog_loop(self) -> None:
        """回收没人读的回合：客户端断线后给一段重连时间，超时则中止本轮。"""
        while True:
            time.sleep(5.0)
            turn = self._turn
            if turn is not None and not turn.closed:
                detached_at = turn.orphaned_since
                if detached_at is not None and time.time() - detached_at > ORPHAN_GRACE_SECONDS:
                    log.warning("turn orphaned id=%s, abort", turn.id)
                    self.abort()
            with self._start_lock:
                self._prune_turns()

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
