"""方案购买（模拟）：把「建筑变化」固定对图复制到平台工作区并留档。

Phase 3 口径（docs/PHASE3-REQUIREMENTS.md §3.2）：
- 每次购买只提供固定对图 image1.png（变化前）/ image2.png（变化后）；
- 工作区只保留一份 workspace/images/building-change/，首次购买复制，之后只写记录不复制；
- 购买记录不再有 source_dir / extras / 逐文件清单。
"""

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
# 固定对图：变化前 / 变化后（Phase 3 不再随机复制主题目录）。
BUILDING_CHANGE = "建筑变化"
FIXED_PAIR = (("image1.png", "before", "变化前"), ("image2.png", "after", "变化后"))
FIXED_DIR = IMAGES_DIR / "building-change"
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


def _plan_path(run_id: str) -> Path | None:
    """报告落在 ``reports/imaging-plan/<task>/<run_id>/``；兼容旧的平铺目录。"""

    if not run_id or not _RUN_ID_RE.match(run_id):
        return None
    direct = REPORT_DIR / run_id / "plan.json"
    if direct.is_file():
        return direct
    for candidate in REPORT_DIR.glob(f"*/{run_id}/plan.json"):
        return candidate
    return None


def _plan_summary(run_id: str) -> dict[str, Any]:
    plan_path = _plan_path(run_id)
    if plan_path is None:
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


def _image_size(path: Path) -> tuple[int, int] | None:
    """按文件内容读 PNG/JPEG 尺寸，避免为列文件引入图像库。"""
    try:
        with path.open("rb") as handle:
            head = handle.read(65536)
    except OSError:
        return None
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        if len(head) >= 24 and head[12:16] == b"IHDR":
            width, height = struct.unpack(">II", head[16:24])
            return int(width), int(height)
        return None
    if head[:2] == b"\xff\xd8":
        index = 2
        while index + 9 < len(head):
            if head[index] != 0xFF:
                index += 1
                continue
            marker = head[index + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack(">HH", head[index + 5 : index + 9])
                return int(width), int(height)
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                index += 2
                continue
            if index + 4 > len(head):
                break
            length = struct.unpack(">H", head[index + 2 : index + 4])[0]
            index += 2 + length
    return None


def _public(record: dict[str, Any]) -> dict[str, Any]:
    return dict(record)


def _ensure_fixed_pair() -> None:
    """把「建筑变化」固定对图复制到 FIXED_DIR（幂等：已存在则跳过）。"""
    source = DATA_ROOT / BUILDING_CHANGE
    if not source.is_dir():
        raise FileNotFoundError(f"数据目录不可用：{source}")
    FIXED_DIR.mkdir(parents=True, exist_ok=True)
    missing = [name for name, _phase, _label in FIXED_PAIR if not (FIXED_DIR / name).is_file()]
    if not missing:
        return
    for name, _phase, _label in FIXED_PAIR:
        src = source / name
        if not src.is_file():
            raise FileNotFoundError(f"固定对图缺失：{src}")
        shutil.copy2(src, FIXED_DIR / name)


def _fixed_files() -> list[dict[str, Any]]:
    """固定对图的元数据清单（与工作区单份文件一一对应）。"""
    files: list[dict[str, Any]] = []
    for name, phase, label in FIXED_PAIR:
        path = FIXED_DIR / name
        entry: dict[str, Any] = {
            "name": name,
            "phase": phase,
            "label": label,
            "path": path.relative_to(PROJECT_ROOT).as_posix(),
        }
        if path.is_file():
            entry["bytes"] = path.stat().st_size
            size = _image_size(path)
            if size is not None:
                entry["width"], entry["height"] = size
        files.append(entry)
    return files


@purchase_bp.post("/api/purchases")
def create_purchase() -> Any:
    """模拟购买：保证固定对图单份存在，然后写购买记录（引用同一目录）。

    按 ``run_id`` 幂等：同一份报告点第二次直接返回原购买单，不再新建，
    否则报告里的「购买本方案」会被重复点出多条记录。
    """
    body = request.get_json(silent=True) or {}
    run_id = str(body.get("run_id") or "").strip()
    if not run_id or not _RUN_ID_RE.match(run_id):
        return jsonify({"ok": False, "error": "run_id 不合法。"}), 400

    with _lock:
        existing = _read_records()
        for item in existing:
            if item.get("run_id") == run_id:
                return jsonify({"ok": True, "purchase": _public(item), "reused": True}), 200

    try:
        _ensure_fixed_pair()
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
        record = {
            "purchase_id": purchase_id,
            "run_id": run_id,
            "workspace_dir": FIXED_DIR.relative_to(PROJECT_ROOT).as_posix(),
            "summary": _plan_summary(run_id),
            "image_files": _fixed_files(),
            "created_at": _now(),
            "simulated": SIMULATED,
        }
        existing.append(record)
        try:
            _write_records(existing)
        except OSError as exc:
            return jsonify({"ok": False, "error": f"记录写入失败：{exc}"}), 500

    return jsonify({"ok": True, "purchase": _public(record)}), 201


@purchase_bp.get("/api/purchases/building-change")
def building_change() -> Any:
    """固定对图清单（「让 Agent 分析」用）；文件不存在时由端点保证复制。"""
    try:
        _ensure_fixed_pair()
    except FileNotFoundError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 503
    return jsonify(
        {
            "ok": True,
            "workspace_dir": FIXED_DIR.relative_to(PROJECT_ROOT).as_posix(),
            "image_files": _fixed_files(),
        }
    )


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
