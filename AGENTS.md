# AGENTS.md

> 给 Agent 的项目指令。只放两类内容：**项目全貌** + **违反就会出错的硬规则**；细节一律链到 `docs/`。
> 真理源：需求与验收看 `docs/PHASE2-REQUIREMENTS.md`（§1.3 验收、§2 范围、§11 决策）；排障看 `docs/TROUBLESHOOTING.md`；星历后端在 `../RS-Service`。
> 本文与 docs 冲突时以 docs 为准，并在同一个 PR 里修正本文。

## 项目概述

`SIRIAgent` 是遥感任务平台：左 1/3 星历可视化，右 2/3 与 DSH Agent 对话；卫星目录、过境、覆盖与成像规划来自 `RS-Service`。

- **形态**：Flask（`app.py`）+ DSH Python SDK（`sdk_runtime.py`）跑在 `127.0.0.1:8000`；前端 `web/` 构建产物由 Flask 托管；公网只经 Cloudflare Tunnel + Access。
- **技术栈**：Python 3.12 · Flask/gunicorn；React 19 + Vite + TypeScript + CesiumJS（pnpm）。
- **数据**：本仓不连数据库；运行数据都在 `RS-Service` 的 PostgreSQL `rs_service`。仓库只放源码、skills、脚本、文档。
- **现状**：Phase 2 已完成（2026-11-07）；完成口径、里程碑与遗留项看 `docs/PHASE2-REQUIREMENTS.md` §1.3、§9.1、§9.2。

## 仓库里真实存在什么

不要凭记忆，用命令确认：

```sh
ls app.py sdk_runtime.py web/src skills docs
git log --oneline -10
```

- `web/dist/`、`reports/`、`.venv/`、`node_modules/` 是产物或本机环境（gitignored）：不手改、不 commit。
- `docs/PHASE2-REQUIREMENTS.html` 由 `scripts/build_requirements_html.py` 生成：改 `.md`，不手改 `.html`。
- `static/` 是旧页面，只在 `web/dist` 不存在时兜底；新功能只进 `web/`。
- 临时脚本、抓包与草稿放 `.scratch/`（gitignored），不留在仓库根目录。

## 快速命令

| 场景 | 命令 |
|---|---|
| 前端依赖 | `cd web && pnpm install` |
| 前端构建 + 类型检查 | `cd web && pnpm build` |
| 前端开发 | `cd web && pnpm dev`（`/api` 代理到 8000） |
| 后端依赖 | `~/.local/bin/uv venv --python 3.12 .venv && ~/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt` |
| 前台起服务 | `.venv/bin/gunicorn -w 1 --threads 4 --timeout 0 -b 127.0.0.1:8000 app:app` |
| 重启线上单元 | `systemctl --user restart siriagent-demo` |
| 星历后端门禁 | `cd ../RS-Service && uv run pytest` |
| 需求 HTML | `.venv/bin/python scripts/build_requirements_html.py` |

- `uv` 在 `~/.local/bin/uv`，不在 systemd 单元的 PATH 里：脚本与服务用 `.venv/bin/...` 绝对路径，不依赖 PATH。
- 只重启改动对应的单元：前端/后端改 `siriagent-demo`；星历改 `rs-service-api` 与 `rs-service-mcp`（两个都要）。
- `.env` 只在本机存在（目前只放高德 key）；仓库里只提交 `.env.example`。

## 成图产物（运行时约定）

- 成图由右栏“卫星成图”抽屉提交到 RS-Service，不再走 DSH skill；`skills/imaging-plan` 已移除。
- 产物在 `reports/imaging-plan/<run_id>/`（`plan.json` + `report.html`），`latest` 指向最近一次。
- 要分析方案，先读 `reports/imaging-plan/latest/plan.json` 与 `report.html`；不要重新求解。

## 架构：四条不能破的线

**① 边界。** 浏览器 → Flask `8000` → RS-Service `8766`。浏览器与公网都不直连 `8766`；`/api/rs/*` 是唯一反代入口。

**② 单轮串行。** 同一时刻只跑一轮（进程内锁）；断线用同一个 `turn_id` + 最后游标续读，不重开回合，也不把已答问题再问一遍。

**③ 文件访问。** `/api/files` 只允许 `PROJECT_ROOT` 内的文件，越界返回 403；前端链接一律走 `/api/files`，不拼 `file://`。

**④ 一个真相源。** 需求只认 `docs/PHASE2-REQUIREMENTS.md`；接口与字段只认 `../RS-Service/docs/api.md`；skill 命令只认 `skills/<slug>/COMMANDS.md`。不在代码、注释或本文件里另抄一份字段与数字。

## 硬规则（违反即为缺陷）

### 星历口径（每个输出都要带）

- 所有对外结果带 `accuracy_note`；SGP4 在 LEO 约 1 km/天，过境时间只到 ±1 分钟。
- 门限：可视化 5°、成像 10°、光学另加太阳高度 >10°；足迹边缘 ±2–5 km；覆盖率与重访标 `estimate`。
- TLE >72h 标 `degraded`，>7d 拒绝过境计算。
- `payload_public=false` 的卫星只给轨道与可见性，不给分辨率、幅宽，不参与成像推荐。

### 成图规划口径

- `task1` 是**面积口径**：目标区域至少成像一次即达标（内部时间阈值固定 0.001%），面积目标默认 90%。`targets.temporal_coverage_pct` 对 task1 必须为 `null`，报告与抽屉只认 `targets.area_pct`；单格时间覆盖率只用于 `task3`。
- 禁止用 90% 单格时间阈值算 task1：72 h 内单格覆盖率通常 <1%，达标面积会恒为 0.0%。改口径后先查 `reports/imaging-plan/latest/plan.json` 的 `selection.recommended_result.temporal_coverage_target_pct`（task1 必须是 0.001）与 `summary_cards.qualified_area_pct`；回归测试 `test_task1_is_area_only_regardless_of_temporal_target`、`test_task1_report_uses_area_target_and_hides_temporal_strip` 不得删改。
- `task1` 的“求解并生成报告”结果卡与报告只保留「选中卫星 + 达标面积」；禁止显示「时间覆盖率」「面积加权 MRT」「薄弱区」（薄弱区表同样带 MRT/时间覆盖率）。
- `task1` 的约束步骤必须提供可编辑的「面积目标 %」（默认 90，1–100）；不要重新加回「目标覆盖率 / 时间覆盖率」——那是 task3 的字段。约束步骤为空就是字段映射漏了，先查 `PlanDrawer` 的 `constraintFields`。
- 改 task1/报告后，必须用修改后的代码实际生成一份报告并核对：标题里的达标面积与 `targets.area_pct` 一致且不为 0.0%，报告与结果卡没有时间覆盖率、面积加权 MRT、薄弱区；只跑单测或看旧报告不算验收。
- 出现“达标面积 0.0%”先按 `docs/TROUBLESHOOTING.md` E15 查，不要靠调低目标凑非 0。

### 交互与安全

- 追问一次一问：`ask_user_question` 的 `questions` 只放 1 项，等用户回答后再决定下一问。
- 日志、会话与 PR 里不出现凭据：`.env` 内容、DSH 凭据、高德 key 一律打码或不打印。
- 模型输出的 Markdown 必须经 `marked` + `dompurify` 渲染，不绕过；报告写到 `reports/`，保证前端能 link 到。

### 语言

- 与用户交互一律简体中文：最终回答、追问、选项，**以及思考过程（reasoning）**，即使用户用英文提问。
- 代码标识符、命令、日志、协议字段、错误码保持原文，不翻译。
- 文档、README、`COMMANDS.md`、PR 正文用中文；提交标题用英文（见下）。

### 排障

- 遇到报错先查 `docs/TROUBLESHOOTING.md` 速查表，用原始报错文本匹配；按「浏览器/SSE → 隧道 → gunicorn → DSH SDK/node → MCP/REST → planner/DB → skill」由外到内排查。
- 一次排查至少留一样证据：`journalctl`、会话 JSONL、`curl`、服务状态或测试输出。只看界面文案不算定位。
- 改了后端必须重启对应单元再验证，否则验的是旧代码。
- 修完的新错误按模板补进 `docs/TROUBLESHOOTING.md`；同一现象只维护一条。

## 提交与 PR：`main` 只接受 PR

没有直推。代码、文档、一行修正、配置都一样：**开分支 → 提交 → push → `gh pr create` → 门禁 + 评审 → 合并**。所有改动经 PR 落到 `main`。

- **起分支**：先 `git fetch origin`，从 `origin/main` 开 `<type>/<kebab-slug>`（如 `docs/agents-md`、`fix/answer-submit-409`）；agent 建的分支用 `agent/<slug>-<hash>`。
- **开 PR**：`gh pr create --base main --fill`，再按模板补正文。
- **一个 PR 只做一件事**：跨仓改动拆成两个 PR（本仓 + `RS-Service`），先合接口/后端，再合前端；两边正文互相链接。
- **合并后追加的提交不会进 `main`**：PR 合并后再往同一分支推的提交只留在分支上（如 `agent/plan-tle-auto-e547316` 上的 `a76060d`）。声称某修复“已在 main”前，用 `git merge-base --is-ancestor <sha> origin/main`（退出 0 才算进了）或 `git log origin/main --grep '<关键词>'` 验证；不要只看开着的分支/PR。
- **提交信息**：Conventional Commits；**标题英文**、祈使句、小写开头、不加句号；**正文中文**说清为什么。类型：`feat` `fix` `docs` `test` `refactor` `perf` `ci` `build` `chore`。
  - 例：`fix(web): keep SSE alive across tunnel drops`
  - 一个提交只做一件事；重构与行为变更不混。
- **PR 标题**沿用同一格式；**正文按 `.github/pull_request_template.md` 填**：做了什么 / 为什么 / 改了哪一层 / 硬规则自查 / 怎么验证 / 风险与回滚。
- **agent 提的 PR，正文第一行写 `This is by an automated agent, not a human.`**
- **门禁（命令与结果贴进 PR 正文）**：
  - `cd web && pnpm build` 必须绿（含 `tsc --noEmit`）；
  - 碰了星历/后端：`cd ../RS-Service && uv run pytest` 必须绿；
  - 碰了界面：1280 / 1440 / 1920 三档无横向溢出，<1024 正常堆叠。
  - A7 的 PR CI（ruff + pytest / tsc + build）落地后，以 CI 绿为准，本地命令仍要跑。
- **合并由人做**：agent 可以开 PR、推修复，不自己点合并；评审意见（含 CodeRabbit）逐条处理，或写明不采纳的理由。
- **推送双写**：`git push` 要同时推到 Gitee 镜像，别只推 GitHub：
  ```bash
  git push origin <branch>
  git push gitee  <branch>
  ```
  远端已配好（`git remote -v` 里应有 `gitee`）；新克隆先
  `git remote add gitee https://gitee.com/su4iky/<repo>.git`。
  `main` 合并后由 `.github/workflows/mirror-to-gitee.yml` 自动镜像；
  分支也双推，是为了不依赖 Actions（可能排队或失败）就能让镜像跟上。
- **合并方式**：Squash merge，PR 标题即最终提交信息；合并后删分支。评审期间用追加提交修意见，不 force-push（会打断评审上下文）。
- **部署随合并自动发生**：`main` 有新提交后约 2 分钟内，本机 autoship 自动
  `cd web && pnpm build` 并重启 `autoship-SIRIAgent.service`（127.0.0.1:8000）；
  结果看 `autoship status`、`autoship logs SIRIAgent`，失败会弹通知。
  PR 里写清这次改动是否影响运行中的服务、回滚要做什么。
- **改需求/决策**：先改 `docs/PHASE2-REQUIREMENTS.md`（§11 决策记录、§12.3 变更记录），再改代码；不在代码里悄悄偏离文档。

## 版本与发布

- 每个合并到 `main` 的 PR 必须把仓库根 `VERSION` 升一级，同步 `web/package.json` 的 `version`，并在 `CHANGELOG.md` 顶部写该版本条目。
- 1.0 之后：破坏性变更 MAJOR、新能力或口径变化 MINOR、修复/文档 PATCH。`SIRIAgent` 与 `RS-Service` 各自编号，不共用平台版本。
- 合并后打 `v<version>` tag。级别判定、并行冲突、回滚与 CHANGELOG 格式见 [`docs/VERSIONING.md`](docs/VERSIONING.md)。

## 完成定义：跑通才算完

改代码不算完成，验证过才算：

1. 门禁绿：`cd web && pnpm build`；碰后端加 `cd ../RS-Service && uv run pytest`。
2. 验收项可复现：需求文档 §1.3 对应场景实跑一遍，PR 里写怎么复现。
3. 界面改动：三档宽度无横向溢出；WebGL 不可用时 2D 列表能开。
4. 文档同步：MCP/命令变了同步 `skills/*/COMMANDS.md`；需求变了同步 §12.3；新错误补 `docs/TROUBLESHOOTING.md`。
5. 线上验收前确认修复所在 PR 已合并、对应 unit 已重启；未合并时只能拿本地修复版生成的结果做证据，并在回复里说明线上仍是旧结果。
6. `git status` 干净：没有 `.env`、数据库、`web/dist/`、`reports/`、临时草稿混进提交。
7. 版本已 bump：`VERSION`、`web/package.json`、`CHANGELOG.md` 三者一致（规则见 [`docs/VERSIONING.md`](docs/VERSIONING.md)）。

## 文档导航

| 想了解 | 去哪看 |
|---|---|
| 需求、范围、验收演示 | `docs/PHASE2-REQUIREMENTS.md` §1–§2、§9.1、§9.2 |
| 星历精度与门限 | `docs/PHASE2-REQUIREMENTS.md` §4.6 |
| REST / MCP / 字段 | `../RS-Service/docs/api.md` |
| skill 命令与失败处理 | `skills/<slug>/COMMANDS.md` |
| 报错与真正原因 | `docs/TROUBLESHOOTING.md` |
| 部署、systemd、配置项 | 本文件「快速命令」、`docs/TROUBLESHOOTING.md` |
| 评审与 PR 要填什么 | `.github/pull_request_template.md` |
| 版本与发布 | `docs/VERSIONING.md`、`CHANGELOG.md` |

<!-- 全文控制在 200 行内：放不下的写进 docs/，这里只加一行链接。
     每条规则只有一个真理源；新增前先确认它不是 docs 里已有内容的副本。 -->
