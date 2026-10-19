#!/usr/bin/env python3
"""把 docs/PHASE2-REQUIREMENTS.md 渲染成与 PRD.html 同风格的独立 HTML。

用法：
    .venv/bin/python scripts/build_requirements_html.py

依赖：markdown（已加入 .venv）
"""
from __future__ import annotations

import html
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parents[1]
MD_PATH = ROOT / "docs" / "PHASE2-REQUIREMENTS.md"
OUT_PATH = ROOT / "docs" / "PHASE2-REQUIREMENTS.html"

TITLE = "SIRIAgent Phase 2 需求文档"
SUBTITLE = "范围 · 优先级 · 验收标准"
VERSION = "v1.4"
DATE = "2026-10-19"
STATUS = "111 颗展示集定稿，无阻塞项"


CSS = r"""
:root {
  --bg: #f3f6fc;
  --surface: #ffffff;
  --ink: #182647;
  --muted: #5c6f94;
  --line: #dfe7f4;
  --brand: #2348b2;
  --brand-ink: #17306f;
  --brand-soft: #e9f0fd;
  --brand-line: #c7d7f4;
  --warn-bg: #fdf6e7;
  --warn-line: #f0dca6;
  --warn-ink: #7d5300;
  --ok-bg: #eef7f0;
  --ok-line: #bfe0c8;
  --ok-ink: #1f6b3a;
  --code-bg: #0f1b33;
  --radius: 14px;
  --shadow: 0 1px 2px rgba(23, 48, 111, .05), 0 8px 24px rgba(23, 48, 111, .07);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, -apple-system, sans-serif;
  font-size: 15px;
  line-height: 1.78;
}
a { color: var(--brand-ink); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  font-family: Consolas, "JetBrains Mono", Menlo, monospace;
  font-size: .86em;
  background: var(--brand-soft);
  border: 1px solid var(--brand-line);
  border-radius: 6px;
  padding: 1px 6px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre {
  background: var(--code-bg);
  color: #dbe7ff;
  border-radius: var(--radius);
  padding: 18px 20px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
  box-shadow: var(--shadow);
  margin: 0 0 22px;
}
pre code {
  background: none; border: none; padding: 0;
  color: inherit; white-space: pre; font-size: 13px;
}
.skip-link { position: absolute; left: -9999px; }
.skip-link:focus { left: 16px; top: 12px; background: var(--surface); padding: 8px 14px; border-radius: 8px; z-index: 99; }
/* ---------- 顶栏 ---------- */
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 32px;
  background: rgba(255, 255, 255, .93);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--line);
}
.brand { display: flex; align-items: center; gap: 12px; }
.brand:hover { text-decoration: none; }
.brand-mark {
  width: 42px; height: 42px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--brand), #4b78e6);
  color: #fff; font-weight: 800; font-size: 18px;
  box-shadow: 0 6px 16px rgba(35, 72, 178, .28);
}
.brand strong { display: block; font-size: 15.5px; color: var(--ink); }
.brand small { display: block; font-size: 12px; color: var(--muted); }
.primary-button {
  border: none; cursor: pointer;
  background: var(--brand); color: #fff;
  font-size: 13.5px; font-weight: 600;
  padding: 9px 18px; border-radius: 10px;
  box-shadow: var(--shadow);
  transition: background .15s ease;
}
.primary-button:hover { background: var(--brand-ink); }
/* ---------- 版面 ---------- */
.page-shell {
  display: flex; gap: 40px; align-items: flex-start;
  max-width: 1320px; margin: 0 auto;
  padding: 30px 32px 90px;
}
.sidebar { width: 264px; flex-shrink: 0; position: sticky; top: 84px; max-height: calc(100vh - 110px); overflow-y: auto; padding-right: 4px; }
#toc { display: flex; flex-direction: column; gap: 2px; }
#toc a {
  padding: 6px 12px; border-radius: 9px;
  font-size: 13px; color: var(--muted);
  border-left: 3px solid transparent;
}
#toc a.depth-3 { padding-left: 24px; font-size: 12.5px; }
#toc a:hover { background: #edf2fa; text-decoration: none; color: var(--ink); }
#toc a.active {
  background: var(--brand-soft); color: var(--brand-ink);
  border-left-color: var(--brand); font-weight: 600;
}
main { flex: 1; min-width: 0; }
.doc-section { margin-bottom: 58px; scroll-margin-top: 84px; }
.section-heading { margin-bottom: 20px; }
.section-heading h2 { margin: 0 0 6px; font-size: 24px; letter-spacing: -.3px; }
.section-heading p { margin: 0; color: var(--muted); font-size: 14px; }
.sub-heading { margin: 34px 0 14px; font-size: 17px; scroll-margin-top: 84px; }
.note { font-size: 13px; color: var(--muted); margin: 10px 0 18px; }
h2 { scroll-margin-top: 84px; }
h3 { scroll-margin-top: 84px; }
h4 { margin: 26px 0 10px; font-size: 14.5px; scroll-margin-top: 84px; }
/* ---------- 首屏 ---------- */
.hero {
  display: flex; gap: 28px; justify-content: space-between; align-items: stretch;
  background: linear-gradient(135deg, #ffffff 0%, #eef4fe 55%, #d9e6fc 100%);
  border: 1px solid var(--brand-line);
  border-radius: 20px; padding: 38px 40px; margin-bottom: 30px;
  box-shadow: var(--shadow);
}
.hero-copy { flex: 1; min-width: 0; }
.eyebrow {
  margin: 0 0 10px; font-size: 12.5px; font-weight: 700;
  letter-spacing: 2px; text-transform: uppercase; color: var(--brand);
}
.hero h1 { margin: 0 0 12px; font-size: 30px; letter-spacing: -.5px; }
.hero-lead { margin: 0; font-size: 15.5px; color: var(--muted); max-width: 720px; }
.meta-row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.meta-chip {
  font-size: 12px; color: var(--brand-ink);
  background: rgba(255, 255, 255, .7);
  border: 1px solid var(--brand-line);
  border-radius: 999px; padding: 4px 12px;
}
/* ---------- 核心决策卡片 ---------- */
.decision-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; margin: 0 0 40px; }
.decision-grid article {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow);
}
.decision-grid .card-index {
  display: inline-block; font-size: 11.5px; font-weight: 700;
  letter-spacing: 1px; color: var(--brand);
  background: var(--brand-soft); border-radius: 6px; padding: 2px 10px; margin-bottom: 10px;
}
.decision-grid h3 { margin: 0 0 6px; font-size: 15px; }
.decision-grid p { margin: 0; font-size: 13px; color: var(--muted); }
/* ---------- 提示块 ---------- */
.callout {
  background: var(--surface); border: 1px solid var(--line);
  border-left: 4px solid var(--brand);
  border-radius: var(--radius); padding: 18px 22px; margin: 0 0 24px;
  box-shadow: var(--shadow);
}
.callout-label {
  display: block; font-size: 12px; font-weight: 700;
  letter-spacing: 1.5px; color: var(--brand);
  margin-bottom: 4px;
}
.callout p { margin: 0; font-size: 14px; color: var(--ink); }
.callout p + p { margin-top: 8px; }
/* ---------- 卡片网格 ---------- */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.card-grid article {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); padding: 18px 20px; box-shadow: var(--shadow);
}
.card-grid .card-index {
  display: inline-block; font-size: 11.5px; font-weight: 700;
  letter-spacing: 1px; color: var(--brand);
  background: var(--brand-soft); border-radius: 6px; padding: 2px 10px; margin-bottom: 10px;
}
.card-grid h3 { margin: 0 0 6px; font-size: 15px; }
.card-grid p { margin: 0; font-size: 13px; color: var(--muted); }
.card-grid .card-tail { display: block; margin-top: 10px; font-size: 12.5px; color: var(--brand-ink); }
/* ---------- 表格 ---------- */
.table-wrap {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--radius); overflow: auto; box-shadow: var(--shadow);
  margin-bottom: 22px;
}
table { width: 100%; border-collapse: collapse; }
th {
  text-align: left; font-size: 12.5px; letter-spacing: .3px;
  color: var(--muted); background: #f1f5fc;
  padding: 10px 14px; border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
td { padding: 11px 14px; border-bottom: 1px solid var(--line); font-size: 13.5px; vertical-align: top; }
tr:last-child td { border-bottom: none; }
td code, th code { white-space: nowrap; }
.table-wrap.wide table { min-width: 1040px; }
.table-wrap.wide td, .table-wrap.wide th { word-break: keep-all; font-size: 12.4px; padding: 8px 10px; }
.table-wrap.wide td:nth-child(11), .table-wrap.wide th:nth-child(11) { max-width: 240px; }
/* ---------- 标签 ---------- */
.tag {
  display: inline-block; font-size: 11.5px; font-weight: 700;
  border-radius: 6px; padding: 1px 8px; white-space: nowrap;
  border: 1px solid var(--brand-line); background: var(--brand-soft); color: var(--brand-ink);
}
.tag.plain { border-color: var(--line); background: #f1f5fc; color: var(--muted); }
.tag.warn { border-color: var(--warn-line); background: var(--warn-bg); color: var(--warn-ink); }
.tag.ok { border-color: var(--ok-line); background: var(--ok-bg); color: var(--ok-ink); }
/* ---------- 清单 ---------- */
main ul, main ol { padding-left: 24px; }
main li { margin: 6px 0; }
main ul li::marker { color: var(--brand); }
/* ---------- 页脚 ---------- */
.document-control {
  border-top: 1px solid var(--line); margin-top: 20px; padding-top: 22px;
  color: var(--muted); font-size: 12.5px;
  display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px;
}
.back-to-top {
  position: fixed; right: 26px; bottom: 26px; z-index: 60;
  width: 42px; height: 42px; border-radius: 50%;
  border: 1px solid var(--brand-line); background: #fff; color: var(--brand);
  font-size: 17px; cursor: pointer; box-shadow: var(--shadow);
  opacity: 0; pointer-events: none; transition: opacity .2s ease;
}
.back-to-top.visible { opacity: 1; pointer-events: auto; }
@media (max-width: 960px) {
  .page-shell { flex-direction: column; align-items: stretch; padding: 20px 18px 70px; }
  .sidebar { position: static; width: 100%; max-width: 100%; max-height: none; margin-bottom: 6px; }
  main { width: 100%; max-width: 100%; }
  .table-wrap, pre { max-width: 100%; }
  #toc {
    flex-direction: row; flex-wrap: nowrap; gap: 4px;
    overflow-x: auto; padding-bottom: 8px;
    -webkit-overflow-scrolling: touch;
  }
  #toc a { white-space: nowrap; border-left: none; border-bottom: 3px solid transparent; }
  #toc a.active { border-left: none; border-bottom-color: var(--brand); }
  #toc a.depth-3 { padding-left: 12px; }
  .hero { flex-direction: column; padding: 28px 24px; }
}
@media print {
  .topbar, .sidebar, .back-to-top { display: none; }
  body { background: #fff; }
  .page-shell { max-width: none; padding: 0; display: block; }
  .hero, .callout, .decision-grid article, .card-grid article, .table-wrap { box-shadow: none; break-inside: avoid; }
  .doc-section { margin-bottom: 34px; }
  pre { box-shadow: none; }
}
"""


def add_heading_ids(body: str) -> tuple[str, list[tuple[str, str, int]]]:
    """给 h2/h3 加 id，并返回 TOC 条目 (id, 纯文本, 层级)。"""
    toc: list[tuple[str, str, int]] = []
    counters = {2: 0, 3: 0}

    def repl(match: re.Match[str]) -> str:
        level = int(match.group(1))
        inner = match.group(2)
        counters[level] += 1
        if level == 2:
            counters[3] = 0
        hid = f"sec-{counters[2]}" if level == 2 else f"sec-{counters[2]}-{counters[3]}"
        text = re.sub(r"<[^>]+>", "", inner)
        text = html.unescape(text).strip()
        toc.append((hid, text, level))
        return f'<h{level} id="{hid}">{inner}</h{level}>'

    body = re.sub(r"<h([23])>(.*?)</h\1>", repl, body, flags=re.S)
    return body, toc


def wrap_tables(body: str) -> str:
    def repl(match: re.Match[str]) -> str:
        inner = match.group(1)
        wide = " wide" if inner.count("<th") >= 10 else ""
        return f'<div class="table-wrap{wide}"><table>{inner}</table></div>'

    return re.sub(r"<table>(.*?)</table>", repl, body, flags=re.S)


def blockquotes_to_callouts(body: str) -> str:
    def repl(match: re.Match[str]) -> str:
        inner = match.group(1).strip()
        return (
            '<div class="callout"><span class="callout-label">说明</span>'
            f"{inner}</div>"
        )

    return re.sub(r"<blockquote>(.*?)</blockquote>", repl, body, flags=re.S)


def tag_priorities(body: str) -> str:
    for level, cls in (("P0", "warn"), ("P1", ""), ("P2", "plain")):
        body = body.replace(
            f"<td>{level}</td>",
            f'<td><span class="tag {cls}">{level}</span></td>' if cls else f'<td><span class="tag">{level}</span></td>',
        )
    return body


def build_toc(toc: list[tuple[str, str, int]]) -> str:
    parts = ['<nav id="toc" aria-label="文档导航">']
    for hid, text, level in toc:
        parts.append(f'<a class="depth-{level}" href="#{hid}">{html.escape(text)}</a>')
    parts.append("</nav>")
    return "\n".join(parts)


def main() -> int:
    source = MD_PATH.read_text(encoding="utf-8")
    # 去掉一级标题（页面用 hero 呈现）
    source = re.sub(r"^# .*?\n", "", source, count=1)

    md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists", "attr_list"])
    body = md.convert(source)
    body, toc = add_heading_ids(body)
    body = wrap_tables(body)
    body = blockquotes_to_callouts(body)
    body = tag_priorities(body)

    toc_html = build_toc(toc)
    doc = f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{TITLE}</title>
<style>{CSS}</style>
</head>
<body>
<a class="skip-link" href="#main-content">跳到正文</a>
<header class="topbar">
  <a class="brand" href="#main-content" aria-label="返回文档顶部">
    <span class="brand-mark">S</span>
    <span>
      <strong>SIRIAgent · Phase 2</strong>
      <small>{SUBTITLE}</small>
    </span>
  </a>
  <div class="topbar-actions">
    <button type="button" class="primary-button" id="print-document">打印 / 导出 PDF</button>
  </div>
</header>

<div class="page-shell">
  <aside class="sidebar" aria-label="文档导航">
    {toc_html}
  </aside>

  <main id="main-content">
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">Phase 2 · 需求文档</p>
        <h1>{TITLE}</h1>
        <p class="hero-lead">两仓库分工、星历数据服务、MCP 与命令式 skill、双栏前端改版。本文档是 Phase 2 的唯一事实源，包含 111 颗国产卫星清单、优先级、验收标准、精度口径与风险边界。</p>
        <div class="meta-row">
          <span class="meta-chip">版本 {VERSION}</span>
          <span class="meta-chip">{DATE}</span>
          <span class="meta-chip">{STATUS}</span>
          <span class="meta-chip">源文件 docs/PHASE2-REQUIREMENTS.md</span>
        </div>
      </div>
    </section>

    <div class="decision-grid">
      <article><span class="card-index">仓库</span><h3>两个公开仓库</h3><p><b>SIRIAgent</b> 负责前端、DSH 调用与 skill；<b>RS-Service</b> 负责星历库、同步、REST 与 MCP。运行数据不进仓库。</p></article>
      <article><span class="card-index">数据</span><h3>12 张表</h3><p>卫星目录、TLE 历史、传感器、数据源、同步运行、同步状态、AOI、过境、覆盖等；TLE 追加写入，不覆盖。</p></article>
      <article><span class="card-index">同步</span><h3>每天 1 次 · 3 次重试</h3><p>03:00 Asia/Shanghai 触发；退避 5/15/45 分钟；三次都失败当天停止，次日自动恢复。</p></article>
      <article><span class="card-index">前端</span><h3>1/3 + 2/3</h3><p>左栏 Cesium 星历可视化，右栏 Agent；React + Vite + TypeScript，深空青绿，适配多分辨率与主流浏览器。</p></article>
      <article><span class="card-index">精度</span><h3>口径写死</h3><p>SGP4 约 1 km/天；可视化 5°、成像 10°、光学太阳角 &gt;10°；足迹 ±2–5 km；所有输出带 accuracy_note。</p></article>
      <article><span class="card-index">卫星</span><h3>111 颗 · 全部国内</h3><p>102 LEO + 9 GEO，商业 64 / 民用 29 / 气象海洋 18，军事 0；LEO 可见 2.57–5.29 次/天。</p></article>
    </div>

{body}

    <div class="document-control">
      <span>{TITLE} · {VERSION} · {DATE}</span>
      <span>SIRIAgent / docs/PHASE2-REQUIREMENTS.md</span>
    </div>
  </main>
</div>

<button type="button" class="back-to-top" id="back-to-top" aria-label="回到顶部">↑</button>

<script>
(function () {{
  var printBtn = document.getElementById('print-document');
  if (printBtn) printBtn.addEventListener('click', function () {{ window.print(); }});

  var links = Array.prototype.slice.call(document.querySelectorAll('#toc a'));
  var targets = links.map(function (a) {{
    var id = a.getAttribute('href').slice(1);
    return document.getElementById(id);
  }}).filter(Boolean);

  function setActive() {{
    var y = window.scrollY + 120;
    var current = targets[0] || null;
    targets.forEach(function (el) {{ if (el.offsetTop <= y) current = el; }});
    links.forEach(function (a) {{
      var on = current && a.getAttribute('href') === '#' + current.id;
      a.classList.toggle('active', !!on);
    }});
    var top = document.getElementById('back-to-top');
    if (top) top.classList.toggle('visible', window.scrollY > 600);
  }}
  window.addEventListener('scroll', setActive, {{ passive: true }});
  window.addEventListener('resize', setActive);
  setActive();

  var topBtn = document.getElementById('back-to-top');
  if (topBtn) topBtn.addEventListener('click', function () {{ window.scrollTo({{ top: 0, behavior: 'smooth' }}); }});
}})();
</script>
</body>
</html>
"""
    OUT_PATH.write_text(doc, encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len(doc):,} bytes, {len(toc)} toc entries)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
