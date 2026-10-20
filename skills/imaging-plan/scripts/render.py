#!/usr/bin/env python3
"""把 plan_coverage 的 JSON 渲染成一份自包含的 HTML 报告（含时间轴回放）。

用法：
    python scripts/render.py --in plan.json --out report.html
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "templates"
BJ = timezone(timedelta(hours=8))
PALETTE = ["#48c7d9", "#f0a52b", "#8b7ff0", "#5fbf8f", "#e0574a", "#c084fc", "#7dd3fc", "#d6b25e"]
TYPE_LABEL = {"optical": "光学", "sar": "SAR", "hyperspectral": "高光谱"}
MODE_LABEL = {
    "min_sats_for_coverage": "最少卫星数达到覆盖率",
    "min_sats_for_revisit": "最少卫星数达到重访间隔",
    "max_coverage_for_n": "给定 N 颗最大化覆盖率",
    "min_wait_for_n": "给定 N 颗最小化平均等待",
}


def bj(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(BJ)


def fmt_dt(value: str) -> str:
    return bj(value).strftime("%Y-%m-%d %H:%M")


def compact(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    args = ap.parse_args()

    payload = json.loads(Path(args.src).read_text(encoding="utf-8"))
    if not payload.get("ok"):
        print(json.dumps({"ok": False, "error": payload.get("error"),
                          "missing": payload.get("missing")}, ensure_ascii=False))
        return 2

    data = payload["data"]
    plan = data["plan"]
    gap = plan.get("gap") or {}
    window = data["window"]

    sats = []
    colors = {}
    for i, s in enumerate(plan["sats"]):
        color = PALETTE[i % len(PALETTE)]
        colors[str(s["sat_id"])] = color
        sats.append({**s, "color": color, "sensor_label": TYPE_LABEL.get(s["sensor_type"], s["sensor_type"])})

    events = []
    for ev in data.get("timeline") or []:
        events.append({
            "sat_id": ev["sat_id"],
            "label": bj(ev["t_utc"]).strftime("%m-%d %H:%M"),
            "points": [[round(p[0], 3), round(p[1], 3)] for p in ev["points"]],
        })

    outline = data.get("aoi_outline") or []
    lons = [p[0] for p in outline] or [118.0, 121.0]
    lats = [p[1] for p in outline] or [29.0, 31.0]

    total_points = sum(len(e["points"]) for e in events) + len(data.get("uncovered_points") or [])
    total_points = total_points or int(data["grid"]["points"])
    window_hours = int(window["extended_to_hours"])
    tick = int(max(120, min(650, 5000 / max(1, len(events)))))

    map_json = compact({
        "bbox": [min(lons), min(lats), max(lons), max(lats)],
        "outline": [[round(p[0], 4), round(p[1], 4)] for p in outline],
        "uncovered": data.get("uncovered_points") or [],
        "events": events,
        "colors": colors,
        "total": total_points,
        "start_label": fmt_dt(window["start_utc"]),
        "window_hours": window_hours,
        "p50": gap.get("p50_hours"),
        "p95": gap.get("p95_hours"),
        "max": gap.get("max_hours"),
    })

    aoi = data["aoi"]
    aoi_name = "、".join(a["name"] for a in aoi)
    aoi_area = f'{sum(a["area_km2"] for a in aoi):,.0f}'
    notes = list(data.get("notes") or [])
    if data.get("cloud", {}).get("used"):
        notes.insert(0, f'光学卫星已按云量过滤（阈值 {data["cloud"]["threshold_pct"]:.0f}%），SAR 不受影响。')
    notes = list(dict.fromkeys(notes))

    # 口径区分：从未覆盖的格点 vs. 窗口内只被访问一次（重访按窗口长度计）的格点。
    uncovered_grid = len(data.get("uncovered_points") or [])
    under_covered = plan.get("under_covered_points") or 0
    single_pass = len(events) <= 1

    env = Environment(loader=FileSystemLoader(str(TEMPLATES)),
                      autoescape=select_autoescape(["html"]))
    html = env.get_template("report.html.j2").render(
        title=f'成图编成 · {aoi[0]["name"]}',
        generated_at=datetime.now(BJ).strftime("%Y-%m-%d %H:%M"),
        aoi_name=aoi_name,
        aoi_area=aoi_area,
        mode_label=MODE_LABEL.get(data["mode"], data["mode"]),
        window_start=fmt_dt(window["start_utc"]),
        window_end=fmt_dt(window["end_utc"]),
        window_hours=window_hours,
        extended=window_hours > window["hours"],
        target_pct=plan.get("target_pct", 90.0),
        sat_count=plan["sat_count"],
        coverage_pct=plan["coverage_pct"],
        feasible=plan["feasible"],
        gap=gap,
        uncovered=uncovered_grid,
        uncovered_grid=uncovered_grid,
        under_covered=under_covered,
        single_pass=single_pass,
        sats=sats,
        grid_spacing=data["grid"]["spacing_deg"],
        grid_points=total_points,
        notes=notes,
        accuracy_note=payload.get("accuracy_note", ""),
        algo_label=f'{data.get("algo_version", "plan-0.1")} · 模式表 {data.get("parser_version", "v0.1")}',
        map_json=map_json,
        events_count=len(events),
        tick_ms=tick,
        speed_label=f"{tick / 1000:.1f} 秒/步",
    )
    Path(args.dst).write_text(html, encoding="utf-8")
    print(json.dumps({"ok": True, "out": str(Path(args.dst).resolve()),
                      "bytes": len(html), "events": len(events)}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
