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
# 浅色主题下同一颗星的可读版本（白底对比度 >= 4.5:1）
PALETTE_LIGHT = ["#0e7490", "#b45309", "#6d28d9", "#15803d", "#b91c1c", "#7e22ce", "#0369a1", "#a16207"]
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


def _must_buy(s: dict, coverage_pct: float, target_pct: float | None) -> bool:
    """去掉这颗星后是否还达标：不达标就是必选，达标就是可选。"""
    unique = float(s.get("unique_pct") or 0)
    if target_pct is not None:
        return coverage_pct - unique < float(target_pct) - 1e-9
    return unique >= 1.0


def _purchase_reason(s: dict, first: bool, coverage_pct: float, target_pct: float | None) -> str:
    parts = ["覆盖贡献最高，是方案主干" if first else f"补足剩余 {s['coverage_pct']:.1f}%"]
    unique = float(s.get("unique_pct") or 0)
    if unique > 0:
        parts.append(f"{unique:.1f}% 的格点只有它能覆盖")
    solo = float(s.get("solo_coverage_pct") or 0)
    if solo - float(s["coverage_pct"]) >= 10:
        parts.append(f"单星可达 {solo:.1f}%，与其他星重叠较多")
    passes = int(s.get("passes") or 0)
    if passes:
        parts.append(f"窗口内 {passes} 次有效过境")
    return "；".join(parts) + "。"


def _tle_label(epoch: str | None) -> str:
    if not epoch:
        return "—"
    try:
        return bj(epoch).strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return epoch


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
    colors_light = {}
    for i, s in enumerate(plan["sats"]):
        color = PALETTE[i % len(PALETTE)]
        colors[str(s["sat_id"])] = color
        colors_light[str(s["sat_id"])] = PALETTE_LIGHT[i % len(PALETTE_LIGHT)]
        sats.append({
            **s,
            "color": color,
            "color_light": PALETTE_LIGHT[i % len(PALETTE_LIGHT)],
            "sensor_label": TYPE_LABEL.get(s["sensor_type"], s["sensor_type"]),
            "reason": _purchase_reason(s, i == 0, plan["coverage_pct"], plan.get("target_pct")),
            "must_buy": _must_buy(s, plan["coverage_pct"], plan.get("target_pct")),
            "tle_label": _tle_label(s.get("tle_epoch_utc")),
        })

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
        "colors_light": colors_light,
        "total": total_points,
        "start_label": fmt_dt(window["start_utc"]),
        "window_hours": window_hours,
        "mrt": gap.get("mrt_hours"),
        "p50": gap.get("p50_hours"),
        "p95": gap.get("p95_hours"),
        "max": gap.get("max_hours"),
    })

    aoi = data["aoi"]
    aoi_name = "、".join(a["name"] for a in aoi)
    aoi_area = f'{sum(a["area_km2"] for a in aoi):,.0f}'
    notes = list(data.get("notes") or [])
    if data.get("cloud", {}).get("used") and not any("云量" in n for n in notes):
        notes.insert(0, f'光学/高光谱已按云量过滤（阈值 {data["cloud"]["threshold_pct"]:.0f}%），SAR 不受影响。')
    notes = list(dict.fromkeys(notes))
    terms_url = next((s.get("source_terms_url") for s in sats if s.get("source_terms_url")), None)

    # 口径区分：从未覆盖的格点 vs. 窗口内只被访问一次（重访按窗口长度计）的格点。
    # uncovered_points 是给地图抽稀后的坐标；统计口径要用未抽稀的真实格点数。
    uncovered_grid = plan.get("uncovered_point_count")
    if uncovered_grid is None:
        uncovered_grid = len(data.get("uncovered_points") or [])
    under_covered = plan.get("under_covered_points") or 0
    single_pass = len(events) <= 1

    # 四种模式问的是不同问题，标题与结论不能都写成"覆盖 X% 需要 Y 颗"。
    mode = data["mode"]
    target_pct = plan.get("target_pct")
    target_gap = plan.get("target_max_gap_hours")
    requested_n = plan.get("requested_n") or plan["sat_count"]
    coverage = plan["coverage_pct"]
    p95 = gap.get("p95_hours")
    if mode == "max_coverage_for_n":
        headline = f"给定 <em>{requested_n}</em> 颗星，{window_hours} 小时最大覆盖 <em>{coverage:.1f}%</em>"
    elif mode == "min_wait_for_n":
        mrt = gap.get("mrt_hours")
        headline = f"给定 <em>{requested_n}</em> 颗星，平均等待 <em>{mrt if mrt is not None else '—'}</em> 小时"
    elif mode == "min_sats_for_revisit":
        headline = (f"重访 P95 ≤ <em>{target_gap:g}</em> 小时，需要 <em>{plan['sat_count']}</em> 颗星"
                    if target_gap is not None
                    else f"重访 P95 <em>{p95 if p95 is not None else '—'}</em> 小时，需要 <em>{plan['sat_count']}</em> 颗星")
    else:
        headline = f"覆盖 <em>{target_pct:.0f}%</em>，需要 <em>{plan['sat_count']}</em> 颗星"

    verdict_ok = None
    if target_pct is not None:
        verdict_ok = coverage >= target_pct - 1e-9
    if mode == "min_sats_for_revisit" and target_gap is not None:
        gap_ok = p95 is not None and p95 <= target_gap + 1e-9
        verdict_ok = gap_ok if verdict_ok is None else (verdict_ok and gap_ok)

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
        mode=mode,
        headline=headline,
        verdict_ok=verdict_ok,
        target_gap=target_gap,
        target_pct=target_pct,
        sat_count=plan["sat_count"],
        coverage_pct=plan["coverage_pct"],
        must_buy_count=sum(1 for s in sats if s["must_buy"]),
        terms_url=terms_url,
        gap=gap,
        uncovered=uncovered_grid,
        uncovered_grid=uncovered_grid,
        under_covered=under_covered,
        single_pass=single_pass,
        sats=sats,
        grid_spacing=data["grid"]["spacing_deg"],
        grid_points=data["grid"]["points"],
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
