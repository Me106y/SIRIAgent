# AGENTS.md — SIRIAgent

本文件是 agent 在本仓库工作时的常驻约定。**需求、优先级、验收标准以 `docs/PHASE2-REQUIREMENTS.md` 为唯一事实源**；本文件只写"怎么工作"和"每条任务都不能忘的硬约束"，不复述需求细节。

## 0. 开工前

1. 读 `docs/PHASE2-REQUIREMENTS.md` 的 §1.3（验收演示）、§2（范围与不做）、§9（里程碑）。
2. 按任务查表，只读需要的章节：

   | 任务 | 先读 | 归属 |
   | --- | --- | --- |
   | 星历、同步、数据库 | §4.2–4.9 | RS-Service |
   | MCP、CLI、skill | §5 | RS-Service + SIRIAgent |
   | 前端、可视化、交互 | §6 | SIRIAgent |
   | 精度、门限、误差 | §4.6 | 两边都守 |
   | 部署、门禁、风险 | §7、§10 | SIRIAgent |

3. 任务不在 Phase 2 范围：先改文档，再写代码。文档里没有的决策，先问，不猜。

## 1. 两个仓库

- `SIRIAgent`（本仓）：React 前端、DSH 调用、skill、门禁（Phase 3）。
- `RS-Service`（`~/桌面/RS-Service`）：星历库、同步、REST、MCP、CLI。
- 跨仓改动先定接口：URL、MCP 工具名、字段、错误码写进文档，再分别实现。
- `SIRI-Agent` 是老平台，保持只读；新文档与新功能只落在 `SIRIAgent`。

## 2. 数据与运行

- 运行数据留在数据库：`~/.local/share/rs-service/rs.db`；仓库只放 schema、迁移、测试夹具。
- RS-Service 的 REST/MCP 只绑 `127.0.0.1`；浏览器经 SIRIAgent 反代，永不直连。
- 同步每天 1 次（03:00 Asia/Shanghai）、最多 3 次重试、失败当天停止；状态写 `sync_state`。
- DSH 运行时用 Python SDK + `DSH_HOME=~/.dsh-siriagent`；装配失败回退 headless + SSE。
- 凭据只放 `~/.dsh-siriagent/.credentials.yaml` 或环境变量，仓库里只留 `.env.example`。

## 3. 星历口径（每个输出都要带）

- SGP4 在 LEO 约 **1 km/天**；只用于可视化、可行性初判、过境时间 **±1 分钟**。
- 过境门限：可视化 **5°**、成像 **10°**、光学另加太阳高度 **>10°**。
- 足迹边缘 **±2–5 km**；覆盖率与重访间隔标 `estimate`。
- 每个 API / MCP / 前端结果带 `accuracy_note`；TLE >72h 标 `degraded`，>7d 拒绝过境计算。
- 卫星集：默认 **111 颗**（102 LEO + 9 GEO），重点保障 **30 颗**；两者共用同一套 TLE 与过境计算，不维护第二份名单。
- `payload_public=false` 的 13 颗只给轨道/可见性，不展示分辨率、不参与成像推荐。

## 4. Skill 与 MCP

- CLI 是唯一实现；MCP 工具是薄包装；REST 与 MCP 共用 service 层。
- 每个 skill 一个目录：`skills/<slug>/SKILL.md` + `COMMANDS.md`。
- `COMMANDS.md` 每条命令写清：**用途 / 风险等级 / 是否需审批 / 示例 / 失败处理**。
- 命令走 `run_command` 的注册子命令；Phase 2 不做拦截，Phase 3 按风险等级补门禁。
- 新增 MCP 工具必须同步 §5.2 与 `COMMANDS.md`，并补一个调用测试。

## 5. 前端

- React 19 + Vite + TypeScript；CSS Modules；不引 Tailwind 或组件库。
- 左 1/3 星历、右 2/3 Agent；断点 1280 / 1440 / 1920，<1024 堆叠。
- 111 颗只画当前位置（5 s 刷新）；轨迹只算选中星 1 圈（300–600 点）；卫星列表虚拟滚动。
- Cesium 用本地影像资产，不依赖 Cesium Ion token；WebGL 不可用时降级 2D 列表。
- 视觉：深空底色 + 青绿强调；对比度 ≥4.5:1；`prefers-reduced-motion` 下关闭位移动画。
- 复用 DSH 表现层时锁 `@deepseek-ai/dsh-client-ui-primitives@0.2.1-rc.2`，不 vendor、不 fork。

## 6. 代码与提交

- Python 3.12 + uv；FastAPI + SQLAlchemy 2 + Alembic；SQLite WAL。
- 新 Python 模块 ≤600 行；类型注解齐全；错误路径有结构化日志。
- 前端用 pnpm；构建产物 `web/dist/` 由后端托管。
- Commit：`feat(scope): ...` / `fix(scope): ...` / `docs: ...`；一次提交只做一件事，正文说明"为什么"。
- 推 `main` 前跑：`uv run pytest`、`pnpm test`、`pnpm build`，并确认 `git status` 干净。
- 仓库里只提交源码、迁移、测试夹具、文档；数据库、密钥、`node_modules`、构建产物留在本机。

## 7. 文档

- 需求变更先改 `docs/PHASE2-REQUIREMENTS.md`（含 §12.3 变更记录），再改代码。
- HTML 版由 `scripts/build_requirements_html.py` 生成；`docs/PHASE2-REQUIREMENTS.html` 不手改。
- 新增决策写进 §11 决策记录；新增风险写进 §10 风险表。

## 8. 完成标准

一个任务算完成，当且仅当：

1. §1.3 对应的验收项可复现；
2. 相关测试通过（星历用真实 TLE 抽查；前端在三档分辨率下无横向溢出）；
3. `docs/PHASE2-REQUIREMENTS.md` 与 `COMMANDS.md` 已同步；
4. `git status` 无意外文件，提交信息能说明"为什么"。
