"""方案购买（模拟）：把 data/ 里的一个主题目录复制到平台工作区并留档。"""

from __future__ import annotations

import json
import os
import re
import secrets
import shutil
import struct
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, request

PROJECT_ROOT = Path(__file__).resolve().parent
WORKSPACE = PROJECT_ROOT / "workspace"
IMAGES_DIR = WORKSPACE / "images"
RECORD_FILE = WORKSPACE / "purchases.json"
REPORT_DIR = PROJECT_ROOT / "reports" / "imaging-plan"
DATA_ROOT = Path(
    os.environ.get("PURCHASE_DATA_ROOT", str(Path.home() / "桌面" / "data"))
)
# 只从可做前后配对的主题里随机；大气污染是单时相多源，留给后续“多源分析”。
POOL = (
    "多维度全面评估火灾",
    "森林覆盖变化",
    "沥青路面老化评估",
    "洪水检测",
)
SIMULATED = True
BJ = timezone(timedelta(hours=8))

purchase_bp = Blueprint("purchase", __name__)
UPLOAD_ROOT = WORKSPACE / "uploads"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
_ALLOWED_SUFFIXES = {".png", ".jpg", ".jpeg"}
_lock = threading.Lock()
_RUN_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
_PURCHASE_ID_RE = re.compile(r"^pur-[0-9]{8}-[0-9a-f]{6}$")


def _now() -> str:
    return datetime.now(BJ).isoformat(timespec="seconds")


def _read_records() -> list[dict[str, Any]]:
    try:
        payload = json.loads(RECORD_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return payload if isinstance(payload, list) else []


def _write_records(records: list[dict[str, Any]]) -> None:
    WORKSPACE.mkdir(parents=True, exist_ok=True)
    tmp = RECORD_FILE.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(RECORD_FILE)


def _plan_summary(run_id: str) -> dict[str, Any]:
    plan_path = REPORT_DIR / run_id / "plan.json"
    if not _RUN_ID_RE.match(run_id) or not plan_path.is_file():
        return {}
    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    city = plan.get("city") or {}
    summary_cards = plan.get("summary_cards") or {}
    targets = plan.get("targets") or {}
    window = plan.get("input_summary") or {}
    return {
        "city": city.get("name"),
        "window_start": window.get("start_utc"),
        "window_end": window.get("end_utc"),
        "sat_count": summary_cards.get("satellite_count"),
        "qualified_area_pct": summary_cards.get("qualified_area_pct"),
        "area_target_pct": targets.get("area_pct"),
        "operation": plan.get("operation"),
    }


def _png_size(path: Path) -> tuple[int, int] | None:
    """只读 PNG 的 IHDR，避免为列文件引入图像库。"""
    try:
        with path.open("rb") as handle:
            head = handle.read(24)
    except OSError:
        return None
    if len(head) < 24 or head[:8] != b"\x89PNG\r\n\x1a\n" or head[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", head[16:24])
    return int(width), int(height)


def _collect_files(directory: Path) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for item in sorted(directory.iterdir(), key=lambda p: p.name):
        if not item.is_file():
            continue
        entry: dict[str, Any] = {"name": item.name, "bytes": item.stat().st_size}
        size = _png_size(item)
        if size is not None:
            entry["width"], entry["height"] = size
        files.append(entry)
    return files


def _pick_source() -> Path:
    available = [DATA_ROOT / name for name in POOL if (DATA_ROOT / name).is_dir()]
    if not available:
        raise FileNotFoundError(f"数据目录不可用：{DATA_ROOT}")
    return secrets.choice(available)


def _public(record: dict[str, Any]) -> dict[str, Any]:
    return dict(record)


@purchase_bp.post("/api/purchases")
def create_purchase() -> Any:
    """模拟购买：复制一个随机主题目录到 workspace/images/<purchase_id>/。"""
    body = request.get_json(silent=True) or {}
    run_id = str(body.get("run_id") or "").strip()
    if not run_id or not _RUN_ID_RE.match(run_id):
        return jsonify({"ok": False, "error": "run_id 不合法。"}), 400

    try:
        source = _pick_source()
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 503

    stamp = datetime.now(BJ).strftime("%Y%m%d")
    with _lock:
        existing = _read_records()
        used = {item.get("purchase_id") for item in existing}
        while True:
            purchase_id = f"pur-{stamp}-{secrets.token_hex(3)}"
            if purchase_id not in used:
                break
        destination = IMAGES_DIR / purchase_id
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copytree(source, destination)
        except Exception as exc:  # noqa: BLE001 - 复制失败不留半套目录
            shutil.rmtree(destination, ignore_errors=True)
            return jsonify({"ok": False, "error": f"复制失败：{exc}"}), 500
        record = {
            "purchase_id": purchase_id,
            "run_id": run_id,
            "source_dir": source.name,
            "workspace_dir": destination.relative_to(PROJECT_ROOT).as_posix(),
            "summary": _plan_summary(run_id),
            "files": _collect_files(destination),
            "created_at": _now(),
            "simulated": SIMULATED,
        }
        existing.append(record)
        try:
            _write_records(existing)
        except OSError as exc:
            shutil.rmtree(destination, ignore_errors=True)
            return jsonify({"ok": False, "error": f"记录写入失败：{exc}"}), 500

    return jsonify({"ok": True, "purchase": _public(record)}), 201


@purchase_bp.get("/api/purchases/<purchase_id>")
def get_purchase(purchase_id: str) -> Any:
    if not _PURCHASE_ID_RE.match(purchase_id):
        return jsonify({"ok": False, "error": "purchase_id 不合法。"}), 400
    for record in _read_records():
        if record.get("purchase_id") == purchase_id:
            return jsonify({"ok": True, "purchase": _public(record)})
    return jsonify({"ok": False, "error": "购买记录不存在。"}), 404


@purchase_bp.post("/api/uploads")
def upload_image() -> Any:
    """接收解译输入图，保存到 workspace/uploads/<upload_id>/。"""
    uploaded = request.files.get("file")
    if uploaded is None:
        return jsonify({"ok": False, "error": "缺少文件。"}), 400
    raw_name = Path(uploaded.filename or "").name.strip()
    suffix = Path(raw_name).suffix.lower()
    if not raw_name or suffix not in _ALLOWED_SUFFIXES:
        return jsonify({"ok": False, "error": "只支持 PNG / JPG。"}), 415
    safe_name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", raw_name)[:120]
    data = uploaded.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify({"ok": False, "error": "文件不能超过 20MB。"}), 413
    upload_id = f"upl-{datetime.now(BJ):%Y%m%d}-{secrets.token_hex(3)}"
    directory = UPLOAD_ROOT / upload_id
    directory.mkdir(parents=True, exist_ok=True)
    (directory / safe_name).write_bytes(data)
    return jsonify(
        {
            "ok": True,
            "path": (directory / safe_name).relative_to(PROJECT_ROOT).as_posix(),
            "name": safe_name,
            "bytes": len(data),
        }
    )


@purchase_bp.get("/api/purchases")
def list_purchases() -> Any:
    records = _read_records()
    items = list(reversed(records[-50:]))
    return jsonify({"ok": True, "items": [_public(item) for item in items]})
