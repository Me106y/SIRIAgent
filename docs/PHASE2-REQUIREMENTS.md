# SIRIAgent Phase 2 需求文档

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.5（草案，待评审） |
| 日期 | 2026-10-19 |
| 状态 | 范围与决策已确认；M3 前端骨架已落地 |
| 归属 | `SIRIAgent` 仓库（本文档为 Phase 2 唯一事实源） |
| 上游 | `PRD.html`（遥感智能体平台建设方案 v1.1） |
| HTML 版 | `docs/PHASE2-REQUIREMENTS.html`（`scripts/build_requirements_html.py` 生成） |

> 约定：本文档使用 `[ ]` 待办、`[x]` 完成、`[-]` 明确不做、`[?]` 待拍板。优先级 P0 = 不做就无法验收；P1 = Phase 2 内应完成；P2 = 有余力再做。后续需求变更直接改本文档，不再新建平行 TODO 文件。

---

## 1. 现状与目标

### 1.1 现状核对（2026-10-19）

| 项 | 事实 |
| --- | --- |
| 公网入口 | Cloudflare Tunnel：`siriagent.dpdns.org → 127.0.0.1:8000`，`dsh.siriagent.dpdns.org → 127.0.0.1:3080`；Cloudflare Access 保护 |
| Zeabur | 当前只是 mesh/tailnet（`100.64.1.58`），**不是公网入口**；Phase 2 维持 Tunnel 单源 |
| SIRIAgent | Flask + 原生 HTML；无 git、无远端；`app.py` 用 `subprocess.run` **全量缓冲**，不是流式 |
| SIRI-Agent | 老平台，GitHub `Me106y/SIRI-Agent`；继续保留但**不再接收新文档与新功能** |
| 运行时 | DSH `0.2.1-rc.2`，MIT；`~/.dsh` 下有 `headless` / `web` 两个 profile、63 个 user skill |
| 星历数据 | 老库 `data/tle_cache.sqlite` 快照停在 **2026-07-12**（已过期 99 天）；120 颗，含退役星与 3 处 NORAD 错标 |
| CelesTrak | 2026-10-19 11:55 复测：直连与 7890 代理均恢复，`gp.php` 返回 200（约 1.3 s）；此前为 TLS EOF，按"会偶发不可达"设计 |
| Space-Track | 可通；需账号；用户协议禁止向第三方转移数据 |
| `gh` | 已装 `~/.local/bin/gh` v2.102.0；**尚未登录** |

### 1.2 Phase 2 目标

把当前"验证台"升级为可日常使用的双栏平台，并建立独立的星历数据服务：

1. **两仓库分工**：`SIRIAgent` = 前端 + DSH 调用 + （Phase 3 的）门禁；`RS-Service` = 星历数据、计算、MCP、CLI。
2. **本地星历库 + 每日同步**：结构化、可追溯、带精度声明，不再依赖过期 JSON/SQLite 快照。
3. **前端改版**：左 1/3 星历可视化，右 2/3 Agent 区；深空科技风；多分辨率与主流浏览器可用。
4. **Skill 命令化 + MCP 取数**：CLI 为唯一实现，MCP 为薄包装，`COMMANDS.md` 说明命令与风险。

### 1.3 验收演示（唯一硬标准）

1. 打开 `https://siriagent.dpdns.org`，通过 Cloudflare Access 登录。
2. 左栏 3D 地球显示默认展示集的**实时位置**；选中一颗后显示星下点轨迹、传感器足迹、未来 24h 过境。
3. 右栏可**任意提问**（不限定话题、不加话题限制）；回答以 token 级流式出现，工具调用卡片、思考块实时呈现。
4. 问及星历/过境类问题时，Agent 经 **MCP** 调用 `RS-Service`，返回过境表或覆盖结论，并带精度声明。
5. 刷新页面后能恢复同一会话继续对话。
6. 在 1280 / 1920 / 2560 宽度与 Chrome / Edge / Firefox / Safari 下布局不破、不出现横向滚动。

---

## 2. 范围与不做

### 2.1 Phase 2 做

- 两仓库建立、GitHub 公开托管、CI 最小集。
- `RS-Service`：SQLite 星历库、每日同步、REST、MCP、CLI、4 个 skill。
- `SIRIAgent`：Python SDK 常驻运行时调用、SSE/WS 流式、React 前端、Cesium 可视化、响应式。
- 精度口径、坐标系、云量、保留与备份策略。

### 2.2 Phase 2 明确不做

| 项 | 原因 | 去向 |
| --- | --- | --- |
| 门禁控制（权限/审批/白名单） | 本轮决策：完全不做；bash 全放行 | Phase 3 第一项 |
| 登录 / 配额 / 多用户隔离 | 站点访问由 Cloudflare Access 兜底 | Phase 3 |
| 成果库 / 影像切片 | 与星历主线无关 | Phase 3+ |
| GPU 模型 / 地物分类 | 依赖显卡与模型资产 | Phase 3+ |
| 对外 API / 多租户 | SQLite 只够单机；Space-Track 数据不可转发 | Phase 3 |
| 历史 TLE >180 天回溯 | 存储与合规成本高 | 按需 |
| 移动端专项适配 | 只保证可读降级 | Phase 3 |
| 全量目录（含退役/军事）默认展示 | 见 §4.4 分层 | 视决策 |

### 2.3 安全边界（必须写进运维手册）

Phase 2 **没有应用层门禁**，且 Agent 拥有 bash 全放行权限。公网侧唯一防线是 **Cloudflare Access**。因此：

- `RS-Service` 的 REST/MCP 只绑 `127.0.0.1`，绝不暴露公网。
- `dsh.siriagent.dpdns.org` 必须保持 Access 保护，不得关闭。
- 任何进入 `SIRIAgent` 工作区的不可信输入都可能触发文件/命令副作用；这是本轮的已知风险，Phase 3 必须补门禁。

---

## 3. 工作流 A — 仓库与工程基线

### 3.1 仓库清单

| 仓库 | 位置 | 可见性 | 职责 | 数据 |
| --- | --- | --- | --- | --- |
| `SIRIAgent` | `~/桌面/SIRIAgent` | Public | 前端、DSH 调用、skill、门禁（Phase 3） | 不含运行数据 |
| `RS-Service` | `~/桌面/RS-Service`（新建） | Public | 星历库、同步、REST、MCP、CLI | **数据库不入库**，放 `~/.local/share/rs-service/` |

> 决策：**不再为 DSH 组件单开仓库**。前端直接依赖 `@deepseek-ai/dsh-client-ui-primitives@0.2.1-rc.2`（npm `next` 标签；`latest` 是旧的 `0.0.1-rc.1`，不可用）。若后续出现必须改源码的组件，再单独 fork。

### 3.2 待办

| ID | 待办 | 优先级 | 验收 |
| --- | --- | --- | --- |
| A1 | `SIRIAgent` 执行 `git init`，建立公开仓库，`main` 分支 | P0 | 远端可访问，首次提交含 README/LICENSE/本文档 |
| A2 | 新建 `RS-Service` 仓库骨架（pyproject、src layout、tests、docs） | P0 | `uv run rs-service --help` 可执行 |
| A3 | `gh auth login` 完成（当前未登录） | P0 | `gh auth status` 显示已登录 `Me106y` |
| A4 | 两仓库统一 MIT `LICENSE`；`THIRD_PARTY_NOTICES.md` | P0 | 含 DSH（MIT）、shiki/KaTeX/anser/micromark（MIT）、diff（BSD-3）、simple-icons（CC0）、Montserrat（OFL） |
| A5 | 品牌约束：项目名不使用 "DeepSeek Harness" 商标，README 用 "built on DeepSeek Harness" | P0 | 文案检查通过 |
| A6 | `.gitignore`：`.venv/`、`node_modules/`、`*.db`、`data/`、`dist/`、`.env` | P0 | `git status` 干净 |
| A7 | 最小 CI：Python（ruff + pytest）、前端（tsc + vite build） | P1 | PR 上绿 |
| A8 | `SIRIAgent` 增加 `docs/` 与 `AGENTS.md`（本仓开发规范） | P1 | 文档可检索 |

### 3.3 目录结构（目标）

```text
SIRIAgent/
├── app.py                    # Flask/FastAPI 入口（保留文件名，内部重构）
├── dsh_runtime/              # Python SDK 调用、事件桥、会话管理
├── skills/                   # <slug>/SKILL.md + COMMANDS.md
├── web/                      # React + Vite + TS 源码
│   ├── src/
│   │   ├── layout/           # 1/3 + 2/3 框架
│   │   ├── ephemeris/        # Cesium 地球、轨迹、足迹、时间轴
│   │   ├── agent/            # 消息流、工具卡、思考块、输入区
│   │   ├── components/       # 自研通用组件
│   │   ├── theme/            # 深空青绿 token
│   │   └── api/              # SSE/WS 客户端
│   └── dist/                 # 构建产物（gitignore）
├── docs/
│   ├── PHASE2-REQUIREMENTS.md
│   └── ...
└── static/                   # 旧页面（过渡期保留）

RS-Service/
├── pyproject.toml
├── src/rs_service/
│   ├── api/                  # FastAPI /api/v1
│   ├── mcp/                  # MCP server（Streamable HTTP）
│   ├── db/                   # SQLAlchemy 模型、迁移、仓储
│   ├── sync/                 # 抓取、解析、调度
│   ├── astro/                # SGP4、坐标、过境、覆盖
│   ├── cli.py                # rs-service sync/query/serve-mcp
│   └── settings.py
├── migrations/               # Alembic
├── tests/
└── docs/
```

---

## 4. 工作流 B — 星历数据服务（RS-Service）

### 4.1 技术栈

| 层 | 选型 | 理由 |
| --- | --- | --- |
| 语言/环境 | Python 3.12 + `uv` | 本机已有；`sgp4`/`skyfield` 成熟 |
| Web | FastAPI + Pydantic v2 | 类型化、OpenAPI、async |
| ORM/迁移 | SQLAlchemy 2 + Alembic | 仓储层可换 Postgres |
| 数据库 | **SQLite（WAL）** | 单机、单写入、零运维；迁移阈值见 §4.9 |
| 轨道 | `sgp4`（数值内核）+ `skyfield`（几何/验收基准） | 性能 + 可对照 |
| 数值 | `numpy` | 覆盖计算向量化，禁止双重循环 |
| HTTP | `httpx` | 超时、重试、代理 |
| 定时 | **systemd user timer**，每日 03:00 Asia/Shanghai | 不依赖 Web 进程，不会多 worker 重复跑 |
| 日志 | 结构化 JSON 到 stderr + `sync_run` 表 | 可审计 |

### 4.2 数据库（12 张表）

数据库文件：`~/.local/share/rs-service/rs.db`（**不在仓库内**）。连接参数：`journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`、`busy_timeout=5000`。时间统一 `TEXT ISO8601 'Z'`。

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `satellite` | `sat_id` INTEGER PK（NORAD）、`norad_alpha5`、`intl_designator`、`name`、`name_zh`、`operator`、`country`、`category`、`object_type`、`status`、`orbit_regime`、`launch_date`、`is_domestic`、**`payload_public`**、`metadata_source`、`updated_at` | 卫星目录；`is_domestic` 由 `operator/country` 派生；`payload_public=false` 的 13 颗不展示载荷参数 |
| `satellite_alias` | `sat_id`、`alias`、`alias_norm`、`source`、`kind` | 解决 `JL-1` ↔ `JILIN-1 GAOFEN 03D52`、中文名 |
| `tle_record` | `sat_id`、`epoch_utc`、`line1`、`line2`、`omm_json`、`checksum_ok`、`mean_motion`、`inclination_deg`、`eccentricity`、`raan_deg`、`argp_deg`、`mean_anomaly_deg`、`bstar`、`mean_motion_dot`、`mean_motion_ddot`、`ephemeris_type`、`element_set_no`、`rev_at_epoch`、`source_id`、`fetched_at_utc`；`UNIQUE(sat_id, epoch_utc, source_id)` | append-only；`omm_json` 是 6 位号时代的唯一载体 |
| `tle_current` | `sat_id` PK、`tle_id`、`epoch_utc`、`age_hours`、`updated_at` | 按 `data_source.priority` 择优 |
| `sensor` | `sat_id`、`sensor_name`、`sensor_type`、`pan_resolution_m`、`ms_resolution_m`、`tir_resolution_m`、`swath_km`、`along_track_km`、`fov_deg`、`bands_json`、`imaging_modes_json`、`revisit_days_nominal`、**`confidence`**、`source_url`、`updated_at` | `confidence ∈ official/vendor/approx/unknown`；3 处错标就是缺这一层 |
| `data_source` | `code`、`name`、`kind`、`base_url`、`query_template`、`auth_type`、`credential_ref`、`min_interval_s`、`daily_budget`、`priority`、`enabled`、`terms_url`、`last_success_at`、`last_http_status`、`notes` | 源注册与限流预算 |
| `sync_run` | `source_id`、`started_at_utc`、`finished_at_utc`、`status`、`attempt_no`、`max_attempts`、`next_retry_at`、`http_status`、`requested`、`inserted`、`updated`、`unchanged`、`failed`、`bytes`、`duration_ms`、`error_code`、`error_message` | `status ∈ ok/partial/retrying/failed/abandoned/skipped_not_modified`；`failed` = 本次尝试失败但还会重试，`abandoned` = 3 次都失败、当天停止 |
| `sync_item_error` | `run_id`、`sat_id`、`attempt_no`、`http_status`、`error_code`、`error_message`、`retry_count`、`created_at_utc` | 单星失败明细 |
| `sync_state` | `source_id` PK、`last_attempt_at`、`last_success_at`、`last_status`、`consecutive_failures`、`attempts_today`、`retry_count_today`、`circuit_open_until`、`next_scheduled_at`、`updated_at` | 每日一次的调度与重试状态；**重启进程不丢**，避免同一天重复抓取 |
| `aoi` | `code`、`name`、`level`、`adcode`、`geom_wkt`、`min_lat`、`min_lon`、`max_lat`、`max_lon`、`area_km2`、`source`、`datum`、`accuracy` | 城市/区县/自定义 |
| `pass_window` | `sat_id`、`aoi_id`、`tle_id`、`algo_version`、`aos_utc`、`los_utc`、`tca_utc`、`max_elev_deg`、`aos_az_deg`、`los_az_deg`、`duration_s`、`min_range_km`、`sun_elev_deg`、`is_daylight`、`footprint_hit`、`coverage_ratio`、**`cloud_cover_pct`**、`computed_at`；`UNIQUE(sat_id, aoi_id, aos_utc, algo_version)` | 换 TLE 即失效 |
| `coverage_snapshot` | `aoi_id`、`window_start_utc`、`window_end_utc`、`sat_set_hash`、`grid_spacing_deg`、`k_min`、`temporal_coverage_pct`、`area_coverage_pct`、`mrt_s`、`art_s`、`algo_version`、`computed_at` | 面向 Agent 查询与报表 |

索引最小集：

```sql
CREATE INDEX idx_tle_sat_epoch  ON tle_record(sat_id, epoch_utc DESC);
CREATE INDEX idx_tle_epoch      ON tle_record(epoch_utc);
CREATE INDEX idx_sat_status_cat ON satellite(status, category);
CREATE INDEX idx_sat_operator   ON satellite(operator);
CREATE INDEX idx_pass_aoi_aos   ON pass_window(aoi_id, aos_utc);
CREATE INDEX idx_pass_sat_aos   ON pass_window(sat_id, aos_utc);
CREATE INDEX idx_pass_tle       ON pass_window(tle_id);
CREATE INDEX idx_sync_src_time  ON sync_run(source_id, started_at_utc);
CREATE INDEX idx_sensor_sat     ON sensor(sat_id);
```

### 4.3 数据源与同步

> 2026-10-19 11:55 复测：CelesTrak 直连与 7890 代理均返回 200（单星约 1.3 s，`GROUP=resource/sar/weather` 均正常）。主源恢复，Phase 2 直接使用 CelesTrak GP，不部署 Zeabur 中转；但同步层仍必须**源无关 + 熔断 + 保留上一版**，因为该线路此前出现过整段 TLS EOF。

- 主源：CelesTrak GP，`FORMAT=json`（OMM 字段），按 `GROUP=resource,sar,weather` + `CATNR` 补齐；**不得**使用 `.com` 域名。
- 备源：Space-Track GP（**仅内部核对，不进入对外输出**）；CelesTrak SupGP（仅 ISS/CSS/Planet 等有 SupGP 的对象）。
- 元数据：CelesTrak SATCAT，每日 1 次。
- 抓取纪律（**2026-10-19 定稿**）：
  - **每天只同步 1 次**：03:00 Asia/Shanghai，由 systemd timer 触发；不再做"每日 2–4 次"。
  - **每次同步最多 3 次重试**：首次尝试 + 3 次重试（共最多 4 次请求，`max_retries=3`，可配置）；退避 5 / 15 / 45 分钟。
  - **3 次重试都失败就停止当天抓取**：`sync_run.status='abandoned'`，`sync_state.circuit_open_until` 设为次日 03:00；当天不再自动请求，人工 `--force` 除外。
  - 手动触发也计入 `attempts_today`，默认不绕过熔断；排障时才允许 `--force`。
  - 带 `If-Modified-Since` / `ETag`；`304` 记 `skipped_not_modified`，不算失败。
  - 单次尝试遇到**非 200 立即终止本次尝试**（不是整轮终止），进入下一次重试；重试用尽才 `abandoned`。
  - 301/403/404 计入熔断计数（CelesTrak：50 次/2h 进防火墙）；**403 "not updated since last download" 不重试**。
  - 失败时保留上一版本数据，服务仍可读；`sync_status` 标记 `stale`。
  - 代理：沿用 `HTTPS_PROXY=http://127.0.0.1:7890`（CelesTrak/Space-Track/Open-Meteo 实测可通）。

状态机：

```text
03:00 → running ──ok──→ ok
              └─fail→ retrying(1) ──fail→ retrying(2) ──fail→ retrying(3) ──fail→ abandoned
                           │                  │                  │
                           └────── ok ────────┴────── ok ───────┘
```

- 状态持久化：`sync_state` 记录 `last_attempt_at`、`last_success_at`、`last_status`、`consecutive_failures`、`attempts_today`、`retry_count_today`、`circuit_open_until`；进程重启后从表里恢复，**不会因为重启在同一天重复抓取**。
- 星历数据落库：每次成功同步把逐星结果写入 `tle_record`（append-only，含 `epoch_utc`、`line1/line2`、`omm_json`、六根数、`checksum_ok`、`source_id`、`fetched_at_utc`），并更新 `tle_current`；失败明细写 `sync_item_error`。**不要只存一个覆盖式快照**。
- 解析：优先 OMM/JSON；TLE 文本仅作兼容，校验行校验位；`sat_id` 用整数，接口同时接受 Alpha-5。
- 幂等：`UNIQUE(sat_id, epoch_utc, source_id)`，重复抓取只更新 `fetched_at`。

### 4.4 卫星集：111 颗（全部国内、公开轨道，2026-10-19 定稿）

> 2026-10-19 决策：**不使用历史 120 颗名单**，改为按"杭州 7 天真实过境频次 + 全部国内公开轨道"重新计算。方法：杭州 30.27°N / 120.16°E；2026-10-19T00:00Z 起 7 天；可见门限 5°；光学成像 = 最大仰角 ≥10° 且 TCA 太阳高度 >10°；SAR/微波 = ≥10°（不看太阳）；30 s 扫描 + 峰值抛物线插值；TLE 历元 2026-10-18/19。研究用镜像取 TLE，**生产仍用 CelesTrak GP**。7 天 SGP4 的 TCA 误差约数秒至 1 分钟。

**结果：111 颗 = 102 颗 LEO + 9 颗 GEO；商业 64、民用 29、气象海洋 18；军事/双用途 0 颗。** 其中 `payload_public=true` 98 颗，`false` 13 颗（仅给轨道/可见性，不做成像承诺）。

#### 4.4.1 口径与阈值

纳入阈值（同时满足）：

1. **国内**：中国民用、商业或气象海洋卫星；不含 Sentinel/Landsat/WorldView 等国外星。
2. **在轨且非退役**：剔除已退役/失效（FY-1D、FY-3A/B/C、HJ-1A/B、HY-1B、HY-2A、ZY-1 02C 等）、已再入、140–185 km 待再入对象。
3. **高度**：LEO 高度 ≥200 km；本表最低为 Jilin-1 GF-03D09（284 km），已标注"低轨"。
4. **可见过境**：LEO 在杭州 7 天平均 ≥2.5 次/天（5° 门限）；GEO 为常驻可见（仰角 >5°，可见率 100%），单列、不参与 LEO 排名。
5. **TLE**：有可用 TLE，年龄 ≤60 天；本表 **111 颗全部 ≤0.9 天**，无 >14 天条目。
6. **载荷**：优先公开载荷；商业星座中 13 颗载荷未核实（Tianyi A–F、Xingshidai 20、Honghu 2、Dongpo 08/09/10、KX-09、LuTan-4 01A），标 `payload_public=false`，只给轨道/可见性。
7. **去重**：按 NORAD 去重；`JILIN-1 GAOFEN 3A`（44312）已确认是 **Bufeng-1A（GNSS-R）** 的镜像别名，**从本清单剔除**；本表无 OBJECT A/B/C 重复对象。

**为什么 0 军事**：Yaogan、Yunhai、Ningxia、GF-8/9/10R/11/12/14 无公开载荷参数；本轮按要求把 110–120 全部限定在公开载荷的商业/民用/气象海洋，军事 0 颗。

**数量差异**：若把退役星、140–185 km 待再入、44312 别名和 GF-8/9/10R/11/12/14 双用途也算入，会得到约 121 颗；按上述硬性排除后为 **111 颗**。

#### 4.4.2 LEO 展示集（102 颗，按可见过境/天降序）

> 该表较宽，可横向滚动查看 TLE 年龄与置信度列。

| # | NORAD | 名称 | 类别 | i(°)/h(km) | 可见/天 | 成像/天 | 最大仰角(°) | TLE(d) | 公开 | 传感器（分辨率/幅宽） | conf |
|---:|---:|---|---|---:|---:|---:|---:|---:|---|---|---|
| 1 | 48621 | HY-2D | 气象海洋 | 66.0 / 950 | 5.29 | 4.43 | 86.4 | 0.4 | 是 | 高度计 / 散射计；足印约 2–25 km | approx |
| 2 | 46469 | HY-2C | 气象海洋 | 66.0 / 950 | 5.14 | 4.43 | 86.3 | 0.4 | 是 | 高度计 / 散射计；足印约 2–25 km | approx |
| 3 | 56232 | FY-3G | 气象海洋 | 50.0 / 409 | 5.0 | 3.71 | 80.6 | 0.4 | 是 | 降水测量雷达 / 微波成像；约 0.5–5 km | approx |
| 4 | 43609 | HY-1C | 气象海洋 | 98.5 / 775 | 4.86 | 1.57 | 87.1 | 0.4 | 是 | 50 m（CZI）；1000 km | official |
| 5 | 43655 | HY-2B | 气象海洋 | 99.3 / 964 | 4.57 | 3.86 | 84.2 | 0.4 | 是 | 高度计 / 散射计；足印约 2–25 km | approx |
| 6 | 69737 | HY-2E | 气象海洋 | 99.3 / 964 | 4.57 | 3.86 | 85.3 | 0.5 | 是 | 高度计 / 散射计；足印约 2–25 km | approx |
| 7 | 58349 | HY-3A | 气象海洋 | 98.5 / 775 | 4.57 | 1.71 | 87.5 | 0.4 | 是 | 约 50 m；约 1000 km | approx |
| 8 | 44528 | ZY-1 02D | 民用 | 98.7 / 771 | 4.57 | 1.71 | 83.9 | 0.4 | 是 | 5 m / 10 m；115 km；30 m 高光谱 60 km | official |
| 9 | 43010 | FY-3D | 气象海洋 | 99.0 / 823 | 4.43 | 1.43 | 81.8 | 0.4 | 是 | 250 m 可见 / 1 km 红外；2900 km | official |
| 10 | 49008 | FY-3E | 气象海洋 | 98.8 / 823 | 4.43 | 0.86 | 78.3 | 0.4 | 是 | 250 m 可见 / 1 km 红外；2900 km | official |
| 11 | 65815 | FY-3H | 气象海洋 | 98.7 / 823 | 4.43 | 1.86 | 80.2 | 0.7 | 是 | 250 m / 1 km；2900 km | approx |
| 12 | 45721 | HY-1D | 气象海洋 | 98.5 / 775 | 4.43 | 2.0 | 84.4 | 0.4 | 是 | 50 m（CZI）；1000 km | official |
| 13 | 57490 | FY-3F | 气象海洋 | 98.7 / 823 | 4.29 | 1.86 | 79.7 | 0.4 | 是 | 250 m 可见 / 1 km 红外；2900 km | official |
| 14 | 41727 | GF-3 | 民用 | 98.4 / 748 | 4.29 | 3.57 | 77.8 | 0.4 | 是 | C 波段；1 m 聚束 / 3 m 条带 / 10–500 m 扫描；10–650 km | official |
| 15 | 49122 | GF-5 02 | 民用 | 98.2 / 698 | 4.29 | 1.71 | 82.8 | 0.4 | 是 | 30 m；330 波段；60 km | official |
| 16 | 49495 | GF-3 02 | 民用 | 98.4 / 748 | 4.14 | 3.57 | 87.6 | 0.1 | 是 | C 波段；1 m 聚束 / 3 m 条带 / 10–500 m 扫描；10–650 km | official |
| 17 | 52200 | GF-3 03 | 民用 | 98.4 / 748 | 4.14 | 3.57 | 83.9 | 0.4 | 是 | C 波段；1 m 聚束 / 3 m 条带 / 10–500 m 扫描；10–650 km | official |
| 18 | 39150 | GF-1 | 民用 | 97.9 / 637 | 4.0 | 1.57 | 82.2 | 0.4 | 是 | 2 m / 8 m；60 km；16 m 宽幅 800 km | official |
| 19 | 43260 | GF-1 03 | 民用 | 98.0 / 637 | 4.0 | 1.71 | 84.5 | 0.4 | 是 | 2 m / 8 m；60 km；16 m 宽幅 800 km | official |
| 20 | 43262 | GF-1 04 | 民用 | 98.0 / 638 | 4.0 | 1.57 | 77.4 | 0.4 | 是 | 2 m / 8 m；60 km；16 m 宽幅 800 km | official |
| 21 | 40118 | GF-2 | 民用 | 98.0 / 623 | 4.0 | 1.71 | 83.3 | 0.4 | 是 | 0.8 m 全色 / 3.2 m 多光谱；45 km | official |
| 22 | 43461 | GF-5 01 | 民用 | 98.5 / 688 | 4.0 | 1.43 | 78.5 | 0.6 | 是 | 30 m；330 波段；60 km | official |
| 23 | 43484 | GF-6 | 民用 | 98.1 / 638 | 4.0 | 1.71 | 83.3 | 0.4 | 是 | 2 m / 8 m；90 km；16 m 宽幅 800 km | official |
| 24 | 46478 | HJ-2A | 民用 | 97.9 / 637 | 4.0 | 1.71 | 78.7 | 0.4 | 是 | 2 m / 8 m；90 km | official |
| 25 | 46479 | HJ-2B | 民用 | 97.9 / 637 | 4.0 | 1.57 | 84.2 | 0.4 | 是 | 2 m / 8 m；90 km | official |
| 26 | 61936 | HY-4A | 气象海洋 | 98.0 / 648 | 4.0 | 3.29 | 86.2 | 0.4 | 是 | 盐度/微波遥感；幅宽未公开 | approx |
| 27 | 40961 | Jilin-1 | 商业 | 97.7 / 632 | 4.0 | 0.43 | 77.3 | 0.4 | 是 | 0.72 m 全色 / 2.9 m 多光谱；约 4.5 km | approx |
| 28 | 53445 | Jilin-1 GF-03D09 | 商业 | 97.6 / 284 | 4.0 | 1.0 | 16.2 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 29 | 44520 | KX-09 | 商业 | 97.8 / 573 | 4.0 | — | 65.0 | 0.4 | 否 | 未公开 | unknown |
| 30 | 50465 | ZY-1 02E | 民用 | 98.4 / 771 | 4.0 | 1.86 | 75.6 | 0.4 | 是 | 2 m 级 / 5 m 级；约 90 km | approx |
| 31 | 53587 | Beijing-3B | 商业 | 97.8 / 604 | 3.86 | 1.71 | 85.7 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；150 km | vendor |
| 32 | 43259 | GF-1 02 | 民用 | 98.0 / 638 | 3.86 | 1.57 | 85.4 | 0.4 | 是 | 2 m / 8 m；60 km；16 m 宽幅 800 km | official |
| 33 | 45856 | Gaofen Duomo | 民用 | 97.8 / 636 | 3.86 | 1.86 | 84.6 | 0.4 | 是 | 0.5 m 级 / 2 m 级；约 90 km | approx |
| 34 | 51284 | LuTan-1 01A | 民用 | 97.8 / 600 | 3.86 | 3.29 | 82.4 | 0.4 | 是 | L 波段 InSAR；3 m；50 km | approx |
| 35 | 51822 | LuTan-1 01B | 民用 | 97.8 / 600 | 3.86 | 3.29 | 83.3 | 0.4 | 是 | L 波段 InSAR；3 m；50 km | approx |
| 36 | 43485 | Luojia-1 | 民用 | 97.8 / 602 | 3.86 | 1.43 | 78.3 | 0.4 | 是 | 130 m；250 km | official |
| 37 | 49338 | Jilin-1 GF-02F | 商业 | 97.7 / 538 | 3.71 | 1.29 | 79.3 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 38 | 57696 | Jilin-1 Kuanfu 02A | 商业 | 97.6 / 534 | 3.71 | 1.14 | 81.3 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；150 km | vendor |
| 39 | 52320 | SuperView Neo-1 01 | 商业 | 97.3 / 511 | 3.71 | 1.43 | 80.3 | 0.4 | 是 | 0.3 m 全色 / 1.2 m 多光谱；13 km | vendor |
| 40 | 52322 | SuperView Neo-1 02 | 商业 | 97.3 / 511 | 3.71 | 1.43 | 86.9 | 0.4 | 是 | 0.3 m 全色 / 1.2 m 多光谱；13 km | vendor |
| 41 | 64048 | Tianyi A | 商业 | 97.4 / 505 | 3.71 | — | 74.3 | 0.4 | 否 | 未公开 | unknown |
| 42 | 44703 | GF-7 | 民用 | 97.6 / 498 | 3.57 | 1.29 | 86.2 | 0.4 | 是 | 0.8 m 全色（双线阵）/ 2.5 m 多光谱；20 km | official |
| 43 | 54035 | HJ-2E | 民用 | 97.4 / 502 | 3.57 | 2.86 | 86.0 | 0.4 | 是 | S 波段；5 m；20–100 km | official |
| 44 | 44836 | Jilin-1 GF-02B | 商业 | 97.5 / 497 | 3.57 | 1.57 | 78.4 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 45 | 49256 | Jilin-1 GF-02D | 商业 | 97.7 / 537 | 3.57 | 1.86 | 81.4 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 46 | 52443 | Jilin-1 Kuanfu 01C | 商业 | 97.5 / 533 | 3.57 | 1.43 | 80.9 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；136 km | vendor |
| 47 | 56153 | PIESAT-1 A | 商业 | 97.5 / 520 | 3.57 | 2.86 | 74.8 | 0.4 | 是 | X 波段 InSAR；0.5 m 聚束；80 km 拼接 | vendor |
| 48 | 56154 | PIESAT-1 B | 商业 | 97.5 / 520 | 3.57 | 2.86 | 74.9 | 0.4 | 是 | X 波段 InSAR；0.5 m 聚束；80 km 拼接 | vendor |
| 49 | 56155 | PIESAT-1 C | 商业 | 97.5 / 520 | 3.57 | 2.86 | 75.2 | 0.4 | 是 | X 波段 InSAR；0.5 m 聚束；80 km 拼接 | vendor |
| 50 | 56156 | PIESAT-1 D | 商业 | 97.5 / 520 | 3.57 | 2.86 | 74.7 | 0.4 | 是 | X 波段 InSAR；0.5 m 聚束；80 km 拼接 | vendor |
| 51 | 62333 | PIESAT-2 09 | 商业 | 97.5 / 516 | 3.57 | 2.86 | 85.6 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 52 | 62334 | PIESAT-2 10 | 商业 | 97.5 / 516 | 3.57 | 3.0 | 83.4 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 53 | 62335 | PIESAT-2 11 | 商业 | 97.5 / 516 | 3.57 | 3.0 | 84.7 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 54 | 62336 | PIESAT-2 12 | 商业 | 97.5 / 516 | 3.57 | 2.86 | 85.2 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 55 | 61871 | PIESAT-2 C | 商业 | 97.4 / 483 | 3.57 | 3.0 | 70.6 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 56 | 63125 | SuperView Neo-1 03 | 商业 | 97.4 / 498 | 3.57 | 1.43 | 73.1 | 0.4 | 是 | 0.3 m 全色 / 1.2 m 多光谱；13 km | vendor |
| 57 | 63126 | SuperView Neo-1 04 | 商业 | 97.4 / 498 | 3.57 | 1.57 | 72.8 | 0.4 | 是 | 0.3 m 全色 / 1.2 m 多光谱；13 km | vendor |
| 58 | 53130 | SuperView Neo-2 02 | 商业 | 97.4 / 489 | 3.57 | 0.43 | 77.1 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | vendor |
| 59 | 62079 | SuperView Neo-2 03 | 商业 | 97.4 / 504 | 3.57 | 0.43 | 67.9 | 0.5 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | vendor |
| 60 | 62080 | SuperView Neo-2 04 | 商业 | 97.4 / 504 | 3.57 | 0.43 | 67.8 | 0.5 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | vendor |
| 61 | 68377 | SuperView Neo-2 05 | 商业 | 97.4 / 504 | 3.57 | 0.14 | 82.0 | 0.5 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | vendor |
| 62 | 68378 | SuperView Neo-2 06 | 商业 | 97.4 / 504 | 3.57 | 0.14 | 82.0 | 0.5 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | vendor |
| 63 | 63208 | SuperView Neo-3 02 | 商业 | 97.4 / 496 | 3.57 | 1.43 | 86.3 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | approx |
| 64 | 64051 | Tianyi D | 商业 | 97.4 / 503 | 3.57 | — | 75.2 | 0.4 | 否 | 未公开 | unknown |
| 65 | 64053 | Tianyi F | 商业 | 97.4 / 504 | 3.57 | — | 75.9 | 0.4 | 否 | 未公开 | unknown |
| 66 | 41556 | ZY-3 02 | 民用 | 97.4 / 498 | 3.57 | 1.29 | 77.9 | 0.4 | 是 | 2.1 m 全色 / 5.8 m 多光谱；51 km | official |
| 67 | 67131 | ZY-3 04 | 民用 | 97.5 / 499 | 3.57 | 1.43 | 84.4 | 0.8 | 是 | 2.1 m 全色 / 5.8 m 多光谱；51 km | official |
| 68 | 54686 | Dongpo 08 | 商业 | 97.7 / 456 | 3.43 | — | 62.3 | 0.4 | 否 | 未公开 | unknown |
| 69 | 57519 | HJ-2F | 民用 | 97.4 / 502 | 3.43 | 2.86 | 72.1 | 0.4 | 是 | S 波段；5 m；20–100 km | official |
| 70 | 58555 | Honghu 2 | 商业 | 97.3 / 471 | 3.43 | — | 81.3 | 0.4 | 否 | 未公开 | unknown |
| 71 | 43946 | Jilin-1 10 | 商业 | 97.5 / 482 | 3.43 | 1.29 | 80.4 | 0.4 | 是 | 0.72 m 全色 / 2.9 m 多光谱；约 4.5 km | approx |
| 72 | 44777 | Jilin-1 GF-02A | 商业 | 97.5 / 436 | 3.43 | 1.29 | 77.1 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 73 | 54695 | Jilin-1 GF-03D48 | 商业 | 97.7 / 450 | 3.43 | 0.0 | 79.7 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 74 | 54690 | Jilin-1 GF-03D50 | 商业 | 97.7 / 453 | 3.43 | 0.14 | 87.5 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 75 | 45016 | Jilin-1 Kuanfu 01 | 商业 | 97.5 / 529 | 3.43 | 1.43 | 78.4 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；136 km | vendor |
| 76 | 61189 | Jilin-1 Kuanfu 02B-01 | 商业 | 97.6 / 537 | 3.43 | 1.57 | 83.0 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；150 km | vendor |
| 77 | 61869 | PIESAT-2 A | 商业 | 97.4 / 464 | 3.43 | 2.71 | 69.7 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 78 | 61872 | PIESAT-2 D | 商业 | 97.4 / 476 | 3.43 | 2.86 | 81.4 | 0.3 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 79 | 53128 | SuperView Neo-2 01 | 商业 | 97.4 / 489 | 3.43 | 0.57 | 78.5 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | vendor |
| 80 | 59510 | SuperView Neo-3 01 | 商业 | 97.4 / 495 | 3.43 | 1.43 | 73.5 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；15 km | approx |
| 81 | 64049 | Tianyi B | 商业 | 97.4 / 501 | 3.43 | — | 76.3 | 0.4 | 否 | 未公开 | unknown |
| 82 | 64050 | Tianyi C | 商业 | 97.4 / 501 | 3.43 | — | 79.3 | 0.4 | 否 | 未公开 | unknown |
| 83 | 64052 | Tianyi E | 商业 | 97.4 / 484 | 3.43 | — | 74.2 | 0.4 | 否 | 未公开 | unknown |
| 84 | 58918 | Xingshidai 20 | 商业 | 97.3 / 498 | 3.43 | — | 76.8 | 0.4 | 否 | 未公开 | unknown |
| 85 | 45939 | ZY-3 03 | 民用 | 97.5 / 499 | 3.43 | 1.71 | 79.4 | 0.4 | 是 | 2.1 m 全色 / 5.8 m 多光谱；51 km | official |
| 86 | 43440 | Zhuhai-1 OVS-02 | 商业 | 97.0 / 484 | 3.43 | 0.57 | 73.1 | 0.4 | 是 | 0.9 m 全色 / 2.5 m 多光谱；12 km | approx |
| 87 | 54685 | Dongpo 09 | 商业 | 97.7 / 447 | 3.29 | — | 83.3 | 0.4 | 否 | 未公开 | unknown |
| 88 | 54689 | Dongpo 10 | 商业 | 97.7 / 453 | 3.29 | — | 79.0 | 0.4 | 否 | 未公开 | unknown |
| 89 | 54692 | Jilin-1 GF-03D47 | 商业 | 97.7 / 455 | 3.29 | 0.0 | 83.7 | 0.3 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 90 | 54694 | Jilin-1 GF-03D49 | 商业 | 97.7 / 443 | 3.29 | 0.0 | 85.6 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 91 | 61870 | PIESAT-2 B | 商业 | 97.4 / 463 | 3.29 | 2.71 | 75.3 | 0.4 | 是 | X 波段 InSAR；0.5 m 级；80 km 拼接 | approx |
| 92 | 43099 | SuperView-1 03 | 商业 | 97.3 / 434 | 3.29 | 1.29 | 83.8 | 0.4 | 是 | 0.5 m 全色 / 2 m 多光谱；12 km | vendor |
| 93 | 44539 | Zhuhai-1 03E | 商业 | 97.6 / 429 | 3.29 | 0.86 | 81.4 | 0.3 | 是 | 0.9 m 级；12 km | approx |
| 94 | 43441 | Zhuhai-1 OHS-02 | 商业 | 97.0 / 481 | 3.29 | 0.57 | 80.1 | 0.4 | 是 | 10 m；150 km（32 波段） | vendor |
| 95 | 44536 | Zhuhai-1 03B | 商业 | 97.6 / 381 | 3.14 | 0.29 | 85.1 | 0.4 | 是 | 0.9 m 级；12 km | approx |
| 96 | 44538 | Zhuhai-1 03D | 商业 | 97.5 / 392 | 3.14 | 0.57 | 73.3 | 0.4 | 是 | 0.9 m 级；12 km | approx |
| 97 | 54252 | Jilin-1 GF-03D51 | 商业 | 97.6 / 336 | 3.0 | 0.71 | 77.2 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 98 | 54255 | Jilin-1 GF-03D52 | 商业 | 97.6 / 350 | 3.0 | 0.86 | 80.5 | 0.3 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 99 | 54253 | Jilin-1 GF-03D53 | 商业 | 97.6 / 382 | 3.0 | 1.0 | 76.5 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 100 | 54251 | Jilin-1 GF-03D08 | 商业 | 97.6 / 320 | 2.57 | 0.57 | 75.2 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 101 | 46457 | Jilin-1 GF-03E | 商业 | 97.2 / 307 | 2.57 | 1.0 | 79.6 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |
| 102 | 46458 | Jilin-1 GF-03F | 商业 | 97.2 / 332 | 2.57 | 1.14 | 81.8 | 0.4 | 是 | 0.75 m 全色 / 3 m 多光谱；17 km | vendor |

> **成像/天口径**：光学 = 最大仰角 ≥10° 且 TCA 太阳高度 >10°；SAR/微波 = 最大仰角 ≥10°（不看太阳）；载荷未核实 = "—"。
>
> **低轨/异常提示**：Jilin-1 GF-03D08/09/51/52/53、GF-03E/F 的高度为 284–382 km，处于低轨衰减段；其中 GF-03D09 最大仰角仅 16.2°，TLE 可能异常，UI 标灰并标"低置信"，不纳入成像推荐。

#### 4.4.3 GEO 常驻可见性（9 颗，不参与过境排名）

| NORAD | 名称 | 类别 | 定点经度(°E) | 仰角范围(°) | 方位角范围(°) | 可见率 | 类型/载荷 | 公开 |
|---:|---|---|---:|---:|---:|---:|---|---|
| 41194 | GF-4 | 民用 | 105.7 | 50.7–52.0 | 206.6–207.7 | 100% | GEO 光学 50 m / 400 m | 是 |
| 46610 | GF-13 01 | 民用 | 118.4 | 54.5–54.9 | 182.3–184.7 | 100% | GEO 光学 50 m / 400 m | 是 |
| 55912 | GF-13 02 | 民用 | 148.1 | 42.5–44.3 | 132.4–134.5 | 100% | GEO 光学 50 m / 400 m 级 | 是 |
| 57624 | LuTan-4 01A | 民用 | 89.5 | 28.2–53.1 | 217.2–248.6 | 100% | GEO SAR，载荷未公开 | 否 |
| 40367 | FY-2G | 气象海洋 | 99.5 | 42.3–53.8 | 212.0–222.9 | 100% | GEO 气象 1.25 km / 5 km | 是 |
| 43491 | FY-2H | 气象海洋 | 79.1 | 31.0–35.8 | 236.7–243.4 | 100% | GEO 气象 1.25 km / 5 km | 是 |
| 41882 | FY-4A | 气象海洋 | 123.4 | 51.6–57.6 | 173.2–174.0 | 100% | GEO 气象 AGRI 1 km / 4 km | 是 |
| 48808 | FY-4B | 气象海洋 | 104.7 | 50.4–51.4 | 208.5–209.2 | 100% | GEO 气象 AGRI 0.5–2 km / 2–4 km | 是 |
| 67246 | FY-4C | 气象海洋 | 133.0 | 52.0–52.1 | 155.7–155.9 | 100% | GEO 气象 AGRI 0.5–2 km / 2–4 km | 是 |

#### 4.4.4 分类统计

| 类别 | LEO | GEO | 合计 | payload_public=false |
|---|---:|---:|---:|---:|
| 商业 | 64 | 0 | 64 | 12 |
| 民用 | 25 | 4 | 29 | 1 |
| 气象海洋 | 13 | 5 | 18 | 0 |
| **合计** | **102** | **9** | **111** | **13** |

其中 `payload_public=true` 共 **98** 颗，`false` 共 **13** 颗。商业 12 颗未核实载荷为：Tianyi A–F（6）、Xingshidai 20（1）、Honghu 2（1）、Dongpo 08/09/10（3）、KX-09（1）；民用 1 颗为 LuTan-4 01A。

#### 4.4.5 频次结论

- LEO 可见过境 **2.57–5.29 次/天**；光学成像 **0–2.00 次/天**；SAR 在 ≥10° 下 **2.71–3.57 次/天**，夜间同样可用。
- 杭州最高频：HY-2D **5.29**、HY-2C **5.14**、FY-3G **5.00**、HY-1C **4.86**、HY-2B / HY-2E / HY-3A / ZY-1 02D **4.57**。
- 光学成像最高：HY-1D **2.00**、FY-3F / FY-3H / ZY-1 02E / Jilin-1 GF-02D **1.86**。
- 结论：杭州的高频星不是 YAOGAN，而是 66° 倾角的 HY-2C/D、50° 倾角的 FY-3G，以及 700–800 km 的 SSO 星。**军事/电子侦察星全部不进入展示集。**

#### 4.4.6 数据质量与排除项（必须保留）

| 对象 | 处理 | 依据 |
| --- | --- | --- |
| 41335 | **排除（国外）** | 实为 Sentinel-3A（ESA），历史库误标为 Gaofen-3 |
| 43437 | **排除（国外）** | 实为 Sentinel-3B（ESA），历史库误标为 Gaofen-5 |
| 44312 | **排除（类型不符）** | 实为 **捕风一号A（Bufeng-1A）**，GNSS-R 海面风场星，i=45°、462 km；不是 GF-3A，也不是光学/SAR 成像星 |
| 40143 | **排除（名称错配）** | 实为 Yaogan-21（LEO）；GF-4 是 41194（GEO） |
| GF-12 系列 | **不按光学处理** | 实为 SAR；历史库标成"光学 0.8 m/16 km"是错的 |
| GF-8 / 9 / 10R / 11 / 12 / 14 | 排除（双用途、载荷未公开） | 无法给出可信传感器参数，避免 Agent 编造 |
| 退役星 | 排除 | FY-1D、FY-3A/3B/3C、HJ-1A/1B、HY-1B、HY-2A、ZY-1 02C |
| 无 TLE | 排除 | 齐鲁一号、巢湖一号、涪城一号、海南一号、南京一号、闽星等镜像无数据 |
| 140–185 km 待再入 | 排除 | 7 个对象 7 天 0 过境，TLE 不可用于业务预报 |
| 国外星 | 排除 | Sentinel、Landsat、WorldView 等 |
| 13 颗 `payload_public=false` | **保留但只给轨道** | Tianyi、Xingshidai、Honghu、Dongpo、KX-09、LuTan-4；不展示分辨率/幅宽，不参与成像推荐 |

#### 4.4.7 分层与前端性能

| 层 | 数量 | 用途 |
| --- | --- | --- |
| 重点保障集 | **30** | 默认推荐、Agent 优先查询；全部包含在 111 中 |
| 默认展示集 | **111（102 LEO + 9 GEO）** | 左栏全量星历、过境查询 |
| 全量目录 | 约 174 | 含军事/退役/待再入，仅高级查询，P2 |
| 自定义集 | 用户勾选 | 落 `satellite_group` 表，P2 |

**重点保障 30 颗**（全部在 111 内）：GF-2、GF-7、吉林一号宽幅01、吉林一号高分02D、四维高景 Neo-1 01、北京三号B；GF-3、GF-3 02、GF-3 03、陆探一号 A/B、HJ-2E、PIESAT-1 A；GF-1 03、GF-6、ZY-3 03、ZY-1 02D、GF-5 02、HJ-2A；FY-3D/F/G、HY-1D、HY-2D、HY-3A；GEO：GF-4、GF-13 01、FY-4B、FY-4C、FY-2H。

**前端性能（111 颗必须按此实现）**：

1. **当前位置层（111 颗）**：每 5 s 传播一次（或前端插值），111 个点精灵；禁止 60 fps 重复传播。
2. **轨迹层（仅选中星）**：只算当前轨道 1 圈（约 90–100 min），10–20 s 步长 ≈ 300–600 点；最多同时 3 条，禁止全量。
3. **TLE/对象缓存**：服务端按 NORAD 缓存 TLE 与 `EarthSatellite`；前端只取 `norad/name/lat/lon/alt` 轻量数组（<100 KB）。
4. **过境预计算**：7 天统计在服务端算好写 `pass_window`；前端点击某星再取 TCA 列表。
5. **GEO 单独图层**：9 颗常驻，不参与轨迹层与过境排名。
6. **降级**：TLE >14 天标"低置信"，>30 天不画轨迹；轨迹点 >1000 时抽稀到 500。

#### 4.4.8 旧 120 颗的来源（仅供对照，不再采用）

| 来源 | 数量 | 说明 |
| --- | --- | --- |
| `data/hangzhou_frequent_satellites.json` | 105 | "杭州历史任务统计 + 国内公开在轨对地观测卫星补充池"，生成于 2026-06-23 |
| TLE 缓存额外补充 | 15 | FY-3A/3B、HJ-1A/1B、Landsat 8/9、Sentinel-2A/2B/3A/3B、GF-6、YG-7/8/12 等 |
| 合计 | 120 | 快照停在 2026-07-12 |

构成：YAOGAN 77（YG-30/35/39/43 四个三星星座占 52 颗）、GF 17、HJ 6、Sentinel 4、JL 4、FY 3、ZY 3、SuperView 3、Landsat 2、Luojia 1。它是"历史上问过的 + 能公开拿到 TLE 的"并集，含退役星、错标星与军事星，不适合当默认展示集。

### 4.5 计算能力


| # | 能力 | 说明 |
| --- | --- | --- |
| C1 | SGP4 传播 | `sgp4`，检查 error 码；TEME→ECEF 用 GMST（IAU-82） |
| C2 | 星下点轨迹 | 30–60 s 步长；经度跨 ±180° 需 unwrap |
| C3 | 过境窗口 | 60 s 粗扫 + 1 s 二分细化；AOS/LOS/TCA/最大仰角/方位角/时长 |
| C4 | 足迹判定 | 旋转矩形或 FOV 计算；记录 `algo_version` |
| C5 | 区域覆盖 | AOI 网格 0.1°–0.2°，`(T, N)` 向量化；时间/面积/K 重覆盖 |
| C6 | 重访间隔 | 区间并集 + 补集；MRT/ART/分位数 |
| C7 | 光照 | `skyfield.almanac` 太阳高度角 |
| C8 | 云量 | Open-Meteo（见 §4.8） |

### 4.6 精度与口径（**强制章节，所有输出必须遵守**）

> 本节是产品口径，不是可选建议。任何 API、MCP 工具、前端展示、报告文案都必须与本节一致。

#### 4.6.1 轨道精度

- TLE/SGP4 在 LEO 的沿轨误差约 **1 km/天**（历元时刻约 1 km）。
- **可用于**：可视化、任务可行性初判、过境时间估算（**±1 分钟**）、覆盖趋势判断。
- **不可用于**：0.5 m 级任务规划、精确侧摆角计算、碰撞规避、测绘级面积量算。
- 所有对外结果必须带 `accuracy_note` 字段，至少包含：`"TLE/SGP4; along-track ~1 km/day; not for sub-meter planning"`，中文界面同步展示。

#### 4.6.2 过境门限

| 场景 | 仰角门限 | 附加条件 |
| --- | --- | --- |
| 可视化 / 一般可见 | **5°** | 无 |
| 成像可用 | **10°** | 光学另要求太阳高度角 **>10°**（默认；可按任务覆盖） |
| 雷达/SAR | **10°** | 不看太阳高度角 |

门限不得硬编码在调用方，必须由配置或请求参数提供；默认值写入 `settings`。

#### 4.6.3 足迹与覆盖误差

- 足迹多边形边缘误差按 **±2–5 km** 对待，不得展示为精确边界。
- 覆盖率、重访间隔是**估算值**，界面与 API 必须标注 `estimate`；不得给出"精确面积""保证重访"等表述。
- `coverage_snapshot` 必须记录 `grid_spacing_deg`、`algo_version`、`sat_set_hash`，便于复现。

#### 4.6.4 数据新鲜度

| TLE 年龄 | 行为 |
| --- | --- |
| ≤ 24h | 正常 |
| 24–72h | 正常返回，附 `stale=true` 警告 |
| 72h–7d | 返回但标记 `degraded=true`，过境结果加"精度下降"提示 |
| > 7d | **拒绝**用于过境/覆盖计算，返回明确错误与最近成功同步时间 |

#### 4.6.5 时间与坐标

- 时间：统一 UTC，ISO8601 `YYYY-MM-DDTHH:MM:SSZ`；禁止 `+00:00` 与本地时间混用。
- 坐标：对外统一 **WGS84**；AOI 入库前必须完成 GCJ-02→WGS84 转换（见 §4.7）。
- 高度：WGS84 椭球高；前端展示可注明"约值"。

### 4.7 AOI 与坐标系

- 粒度：城市（adcode）+ 区县（adcode）+ 自定义多边形（WKT）。
- 数据来源：复用 `SIRI-Agent/data/district_boundaries/`（高德 district API v3）。
- **已核验**：13 个区县为 2021 年区划调整后版本（含临平区 330113、钱塘区 330114；无江干区/下城区）；20,696 个点；bbox `lat 29.19–30.56 / lon 118.34–120.72`。
- **准确性问题**：高德坐标为 **GCJ-02**，直接当 WGS84 用有 **300–600 m 偏移**；边界为概化折线，非测绘级。
- 入库要求：
  1. GCJ-02 → WGS84 转换（使用成熟算法，写单测）；
  2. 环闭合、自交、绕向校验；
  3. 面积与官方公布值比对，相对误差阈值 ≤ 5%（超出则标 `accuracy=low` 并告警）；
  4. 记录 `source=amap`、`datum=gcj02`、`accuracy=approx`。
- 空间查询：bbox 预过滤 + 点在多边形；**不引入 PostGIS/SpatiaLite**。

### 4.8 云量（Phase 2 就接）

- 源：**Open-Meteo**（免费、无需 key）：
  - 预报：`https://api.open-meteo.com/v1/forecast?...&hourly=cloud_cover`（实测可通）；
  - 历史：`https://archive-api.open-meteo.com/v1/archive?...`（实测可通）。
- 用法：计算过境窗口时，取 AOI 在 **TCA 时刻**的 `cloud_cover_pct` 写入 `pass_window`；预报结果缓存 1 小时；历史窗口走 archive。
- 口径：这是**数值天气预报**，不是卫星云掩膜；界面标注"云量预报，仅供参考"。真实云图（Sentinel-2/葵花）留 Phase 3。
- 现有 `_estimate_cloud_percent`（伪随机占位）**必须删除**，不得保留任何调用。

### 4.9 保留、备份与迁移

| 表 | 保留 |
| --- | --- |
| `tle_record` | 180 天全量；>180 天按天抽样 1 条 |
| `tle_current` | 每星 1 行 |
| `pass_window` | 未来 10 天 + 过去 7 天；TLE 更新即失效重算 |
| `coverage_snapshot` | 90 天 |
| `sync_run` | 90 天；`sync_item_error` 30 天 |
| `sync_state` | 常驻（每源 1 行，不清理） |

- 备份：每日 `VACUUM INTO` 到 `~/.local/share/rs-service/backups/`，保留 7 份。
- 迁移 Postgres 的触发条件：`tle_record` > 500 万行、需要多写入进程/多租户、需要 PostGIS、需要跨实例共享。届时只换仓储层与连接串。

### 4.10 测试与验收

- 单测：OMM/TLE 解析、校验位、GCJ-02 转换、过境窗口回归（与 `skyfield` 对照，时间误差 ≤ 1 s、角度 ≤ 0.01°）。
- 数据断言：NORAD↔名称映射（覆盖默认展示集全部 NORAD），防止再次出现 41335/43437/44312 类错配。
- 集成：`rs-service sync --dry-run`、`GET /api/v1/health`、MCP `tools/list`。
- 同步状态机测试：模拟首次失败 → 3 次重试 → `abandoned`；断言当天不再发起请求、次日恢复；`sync_state` 在进程重启后保持。
- 验收：连续 7 天同步成功；`sync_status` 能显示最近一次尝试/成功时间、尝试次数、重试次数、成败与失败原因；过境结果带 `accuracy_note` 与 `cloud_cover_pct`。

---

## 5. 工作流 C — MCP、CLI 与 Skill

### 5.1 接口分工

| 入口 | 绑定 | 调用方 | 用途 |
| --- | --- | --- | --- |
| REST `/api/v1/*` | `127.0.0.1:8766` | `SIRIAgent` 反代 | 前端可视化、健康检查 |
| MCP（Streamable HTTP） | `127.0.0.1:8765` | DSH Agent | 工具调用 |
| CLI `rs-service` | 本机 | 同步任务、人工排障、skill 文档 | 唯一实现 |

- 浏览器**永不**直连 `RS-Service`；`SIRIAgent` 做反代、缓存与 CORS 收敛。
- REST 与 MCP 共用同一 service 层，禁止两份业务逻辑。

### 5.2 MCP 工具清单

| 工具 | 入参 | 出参 | 说明 |
| --- | --- | --- | --- |
| `list_satellites` | `category?`、`country?`、`status?` | 卫星摘要列表 | 默认展示集 |
| `get_satellite` | `sat_id` 或 `name` | 目录 + 传感器 + 当前 TLE 元数据 | |
| `get_tle` | `sat_id`、`max_age_hours?` | TLE/OMM + `epoch` + `age_hours` | 超龄按 §4.6.4 处理 |
| `propagate` | `sat_id`、`times[]` 或 `start/end/step` | 位置（WGS84）+ `accuracy_note` | |
| `ground_track` | `sat_id`、`start/end`、`step_s` | 星下点序列 | 经度已 unwrap |
| `next_passes` | `aoi`（code/adcode/WKT）、`start/end`、`min_elev_deg?` | 过境列表（AOS/LOS/TCA/最大仰角/云量） | 默认 5°/10° 按 §4.6.2 |
| `coverage_window` | `aoi`、`start/end`、`grid_deg?`、`k_min?` | 时间/面积覆盖率、MRT/ART | 标注 `estimate` |
| `sync_status` | — | 最近同步、TLE 年龄、失败项 | |
| `run_command` | `command`（枚举）、`args`（schema） | stdout/结构化结果 + 审计 id | 受控命令入口，见 §5.3 |

> 2026-10-19 已实现：`list_satellites`、`get_satellite`、`next_passes`、`ground_track`、`current_position`、`sync_status`；其余待补。

所有工具出参统一包一层：

```json
{
  "ok": true,
  "data": {},
  "accuracy_note": "TLE/SGP4; along-track ~1 km/day; not for sub-meter planning",
  "stale": false,
  "degraded": false,
  "generated_at": "2026-10-19T03:00:00Z"
}
```

### 5.3 受控命令 `run_command`

- 只接受注册过的子命令（如 `tle.sync`、`pass.next`、`coverage.window`），每个子命令有独立参数 schema；**不执行任意 shell 字符串**。
- 服务端设置超时（默认 30 s）、并发上限、审计记录（`command_audit` 表：调用方、命令、参数、结果、耗时、`accuracy_note`）。
- Phase 2 **不做权限拦截**（决策见 §2.2），但结构保留，Phase 3 直接填白名单。

### 5.4 Skill 契约（"命令式 + MCP"）

每个 skill 一个目录：

```text
SIRIAgent/skills/<slug>/
├── SKILL.md        # 触发条件、能力、输入输出、首选 MCP 工具
├── COMMANDS.md     # 命令清单：用途 / 风险 / 是否需要审批 / 示例 / 失败处理
└── scripts/        # 可选：本地辅助脚本
```

`SKILL.md` frontmatter 至少包含：

```yaml
---
name: ephemeris-query
description: 查询卫星星历、过境与覆盖信息
when-to-use: 用户询问某地某时的卫星过境、可见性、覆盖能力时
---
```

`COMMANDS.md` 每条命令一行表格：

| 命令 | 用途 | 风险 | 需审批 | 示例 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| `rs-service pass next --aoi 330100 --hours 24` | 查询杭州未来 24h 过境 | read | 否 | 见下 | 检查 `sync_status`，TLE 过期先同步 |

风险等级：`read`（只读）、`write`（写本地库/文件）、`exec`（执行外部命令）、`network`（外网请求）。Phase 2 全部不拦截，但必须如实标注。

首批 skill：

| slug | 能力 | 首选 MCP 工具 |
| --- | --- | --- |
| `ephemeris-query` | 查卫星、TLE、当前位置 | `list_satellites`、`get_satellite`、`propagate` |
| `pass-planning` | 某 AOI 未来过境与可用性 | `next_passes` |
| `coverage-check` | 区域覆盖/重访评估 | `coverage_window` |
| `tle-health` | 数据新鲜度与同步诊断 | `sync_status`、`run_command(tle.sync)` |

### 5.5 注册到 DSH

- MCP：在 `~/.dsh-siriagent/profiles/sdk/cordis.patch.yml` 增加 `@deepseek-ai/dsh-mcp-client` 条目，`serverName: rs-service`，transport 指向 `http://127.0.0.1:8765`。
- Skill：`SIRIAgent/.dsh/skills/` 或 `SIRIAgent/skills/` + `customSkillDirs` 配置；二选一，文档内统一。
- 工具名会带前缀：`mcp__rs-service__next_passes`；`COMMANDS.md` 中同时写 MCP 名与 CLI，避免歧义。

---

## 6. 工作流 D — 前端改版

### 6.1 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 19 + Vite + TypeScript |
| 样式 | CSS Modules + CSS 变量（不引 Tailwind/组件库；借鉴 DSH 的语义分层） |
| 地球 | **CesiumJS**（本地 NaturalEarth 影像，不用 Cesium Ion，不需要 token） |
| 卫星推演 | `satellite.js`（前端本地 SGP4，负责平滑动画；服务端负责过境/覆盖） |
| Markdown | `@deepseek-ai/dsh-client-ui-primitives@0.2.1-rc.2`（直接依赖，不 vendor） |
| 状态 | React hooks（按需再引状态库） |
| 流式 | SSE（优先）或 WebSocket |
| 测试 | Vitest + Playwright（视觉与响应式） |

### 6.2 DSH 调用与流式

- 后端使用 **Python SDK**（`deepseek_harness`），常驻 `dsh --profile sdk` 进程，通过 `session.event` 通知拿到 `text-delta / reasoning-delta / tool-call-delta`。
- 独立 `DSH_HOME=~/.dsh-siriagent`：复制 `~/.dsh/.credentials.yaml`，加 `sdk.patch.yml`（凭据启用、`approval: never`、MCP 与 skill 目录）。
- 每个浏览器会话映射一个 DSH session；后端把通知归一化为 SSE 事件：`session`、`text`、`reasoning`、`tool_call`、`tool_result`、`status`、`error`、`done`。
- 降级：SDK 装配失败时回退 `dsh --profile headless --json`（块级事件 + SSE），功能不减，只是没有 token 级打字机。
- 端点：`POST /api/chat`（发送）、`GET /api/stream/<session>`（SSE）、`POST /api/session/reset`、`GET /api/health`。
- 审批：Phase 2 不做；`approval: never`。

### 6.3 布局与信息架构

```text
┌──────────────────────────────────────────────────────────────┐
│ Header：品牌 / 同步状态 / 会话 / 连接状态 / 设置              │
├──────────────────┬───────────────────────────────────────────┤
│ 左 1/3           │ 右 2/3                                    │
│ 卫星筛选列表     │ 消息流（思考块、工具卡、产物卡）          │
│ 3D 地球          │                                           │
│ 选中星轨迹/足迹  │                                           │
│ 时间轴 ±24h      │                                           │
│ 过境表           │                                           │
│ 数据源/同步状态  │ 输入区（附件、斜杠命令、发送/停止）        │
└──────────────────┴───────────────────────────────────────────┘
```

- 左栏可折叠（窄屏默认折叠为图标条）。
- 右栏不限制话题：欢迎语只做示例，不写"只能问星历"。
- 时间轴拖动时，地球、轨迹、过境表联动；"回到现在"按钮。
- 卫星列表支持按类别（商业/民用/气象海洋）/类型（光学/SAR/高光谱）/分辨率/低置信筛选，默认 111 颗展示集；列表用虚拟滚动，111 颗也能流畅。

### 6.4 视觉系统

- 基调：深空（近黑蓝 `#050B14` 系）+ 青绿/青色强调（`#22D3EE` / `#2DD4BF`）+ 等宽数字。
- 克制的网格/扫描线/发光，不做大面积霓虹；信息密度优先。
- 字体：界面用系统无衬线 + `JetBrains Mono`（数字/坐标/时间）。
- 对比度：正文 ≥ 4.5:1；状态色不只靠颜色区分（加图标/文字）。
- 动效：`prefers-reduced-motion` 下关闭位移动画；地球自转可暂停。

### 6.5 响应式与浏览器适配（硬要求）

| 断点 | 行为 |
| --- | --- |
| ≥ 1920 | 左 1/3、右 2/3；左栏完整 |
| 1440–1919 | 左 32%、右 68%；过境表压缩列 |
| 1280–1439 | 左 30%、右 70%；时间轴简化 |
| 1024–1279 | 左栏可折叠；右栏全宽 |
| < 1024 | 上下堆叠；地球高度 40vh；输入区固定底部 |

- 浏览器矩阵：Chrome / Edge / Firefox / Safari 最近两个大版本；WebGL 不可用时显示降级提示与 2D 轨迹列表。
- 高分屏：`devicePixelRatio` 适配，Cesium `resolutionScale` 可调；2560/4K 下不模糊。
- 无横向滚动；长文本/长卫星名省略号 + tooltip；触控目标 ≥ 44px。
- 验收：Playwright 在 1280×800、1920×1080、2560×1440 三档截图对比，无溢出、无遮挡。

### 6.6 性能预算

- 首屏（不含 Cesium 影像）：< 2.5 s（本地/香港出口，20 Mbps）。
- Cesium 与影像按需加载；首屏先出骨架与卫星列表。
- **111 颗只画当前位置**（点/图标，Cesium 实体或 PointPrimitive），不为每颗星预生成 1s 轨迹；轨迹仅对选中星按需计算并按 stride 降采样。
- 卫星位置动画 ≥ 30 FPS（111 颗当前位置；轨迹模式 ≥ 30 FPS）。
- 卫星列表用虚拟滚动（只渲染可视行）；筛选/搜索在前端完成。
- 过境窗口按日预计算并缓存（`pass_window`），前端不再逐次全量算。
- 单次过境查询 P95 < 3 s（111 颗、24h 窗口，命中缓存）。

### 6.7 前端待办

| ID | 待办 | 优先级 | 验收 |
| --- | --- | --- | --- |
| D1 | 搭建 React+Vite+TS 工程与构建管线，`dist/` 由 Flask/FastAPI 托管 | P0 | `npm run build` 后站点可用 |
| D2 | DSH SDK 常驻运行时 + SSE 事件桥 | P0 | 浏览器看到 token 级流式 |
| D3 | 双栏布局 + Header + 输入区 | P0 | 三档分辨率不破 |
| D4 | Cesium 地球 + 卫星实时位置 | P0 | 111 颗位置正确、可交互 |
| D5 | 选中星轨迹、足迹、时间轴、过境表 | P0 | 与 MCP 结果一致 |
| D6 | 消息流：思考块、工具卡、错误态 | P0 | 工具调用实时出现 |
| D7 | 会话恢复（刷新后续聊） | P1 | 同 session 续聊 |
| D8 | 视觉 token 与深空主题 | P1 | 对比度达标 |
| D9 | 响应式与浏览器矩阵 | P1 | Playwright 三档通过 |
| D10 | 性能优化（Cesium 懒加载、降采样） | P2 | 首屏 < 2.5 s |
| D11 | 无障碍（键盘、aria、reduced motion） | P2 | axe 无严重项 |

---

## 7. 工作流 E — 门禁（Phase 2 不做）

### 7.1 本轮决策

- **完全不做门禁**：不设权限档位、不做命令白名单、不做审批弹窗。
- Agent 拥有 **bash 全放行**；白名单只保留数据结构与文档位置，Phase 3 再填内容。
- 站点访问继续由 Cloudflare Access 兜底。

### 7.2 已知风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 公网用户可让 Agent 执行任意命令 | Access 仅放行本人邮箱；RS-Service 只绑 localhost；日志留痕 |
| Agent 误改工作区/系统文件 | 会话工作区固定；每日备份；Phase 3 优先补沙箱 |
| 密钥泄露 | DSH 凭据只在 `~/.dsh-siriagent/.credentials.yaml`；不进仓库 |

### 7.3 Phase 3 第一项（占位）

- 工具面最小化 + 命令白名单 + 高风险审批 + 审计查询页。
- 依据：Phase 2 的 `COMMANDS.md` 风险标注与 `command_audit` 表。

---

## 8. 优先级总表

| ID | 工作流 | 待办 | 优先级 | 依赖 |
| --- | --- | --- | --- | --- |
| A1 | 仓库 | SIRIAgent git + 公开仓库 | P0 | A3 |
| A2 | 仓库 | RS-Service 骨架 | P0 | A4 |
| A3 | 仓库 | gh 登录 | P0 | — |
| A4 | 仓库 | LICENSE / THIRD_PARTY_NOTICES | P0 | A1、A2 |
| A5 | 仓库 | 品牌约束 | P0 | A1 |
| A6 | 仓库 | .gitignore | P0 | A1、A2 |
| B1 | 数据 | Alembic 初始迁移（10 表） | P0 | A2 |
| B2 | 数据 | 抓取/解析（OMM + TLE） | P0 | B1 |
| B3 | 数据 | 同步 CLI + systemd timer（每日 03:00、3 次重试、失败当天停止） | P0 | B2 |
| B4 | 数据 | 卫星目录与 111 颗展示集入库 | P0 | B2 |
| B5 | 数据 | SGP4 传播 + 轨迹 | P0 | B4 |
| B6 | 数据 | 过境窗口（门限/太阳角） | P0 | B5 |
| B7 | 数据 | AOI 导入 + GCJ-02 转换 + 校验 | P0 | B1 |
| B8 | 数据 | 足迹与覆盖估算 | P1 | B6、B7 |
| B9 | 数据 | 云量接入（Open-Meteo） | P1 | B6 |
| B10 | 数据 | 保留、备份、`VACUUM INTO` | P1 | B3 |
| B11 | 数据 | 精度口径落到所有出参 | P0 | B5、B6 |
| C1 | MCP | REST `/api/v1` | P0 | B5 |
| C2 | MCP | MCP server + 9 工具 | P0 | C1 |
| C3 | MCP | `run_command` + 审计 | P1 | C2 |
| C4 | Skill | 4 个 skill + COMMANDS.md | P0 | C2 |
| C5 | Skill | 注册到 DSH（MCP + 目录） | P0 | C2、D2 |
| D1 | 前端 | React 工程 | P0 | A1 |
| D2 | 前端 | SDK 流式桥 | P0 | A1 |
| D3 | 前端 | 双栏布局 | P0 | D1 |
| D4 | 前端 | Cesium 地球 + 实时位置 | P0 | D1、C1 |
| D5 | 前端 | 轨迹/足迹/时间轴/过境表 | P0 | D4、C2 |
| D6 | 前端 | 消息流与工具卡 | P0 | D2、D3 |
| D7 | 前端 | 会话恢复 | P1 | D2 |
| D8 | 前端 | 视觉 token | P1 | D3 |
| D9 | 前端 | 响应式/浏览器矩阵 | P1 | D3 |
| D10 | 前端 | 性能优化 | P2 | D4 |
| D11 | 前端 | 无障碍 | P2 | D3 |
| E1 | 门禁 | Phase 3 占位 | P2 | — |

---

## 9. 依赖与里程碑

```text
M1 数据可用（约 1 周）
  A2/A4 → B1 → B2 → B3 → B4 → B5 → B6 → B7
M2 Agent 可查（约 0.5 周）
  B5/B6 → C1 → C2 → C4 → C5
M3 前端骨架（约 1 周）
  A1 → D1 → D2 → D3 → D6
M4 可视化（约 1 周）
  C1 → D4 → D5
M5 联调上线（约 0.5 周）
  D7/D8/D9 + 验收演示
```

关键路径：**A3（gh 登录）→ A1/A2 → B2（数据源）→ B4（卫星集）→ B6（过境）→ C2（MCP）→ D5（可视化联调）**。

### 9.1 实施进度（2026-10-19）

| 里程碑 | 状态 | 证据 |
| --- | --- | --- |
| M1 数据服务 | **进行中** | 两仓库已公开（[SIRIAgent](https://github.com/Me106y/SIRIAgent)、[RS-Service](https://github.com/Me106y/RS-Service)）；12 表迁移 `73866dc4fe27`；111 颗 seed；首次同步 111 条 TLE；REST/MCP 可用；12 个测试通过。待补：AOI/GCJ-02 入库、覆盖/重访、云量写入 `pass_window` |
| M2 Agent 可查 | **进行中** | MCP 已接入 `headless.patch.yml`（Streamable HTTP）；6 个工具可用，前端已显示工具卡；待补 `get_tle`、`propagate`、`coverage_window`、`run_command` 与 4 个 skill |
| M3 前端骨架 | **已完成骨架** | `web/` React 19 + Vite + TS + Cesium；1/3 + 2/3 布局；111 颗位置 5 s 刷新；选中星轨迹与过境表；`/api/chat` 可用；1440/900/488 宽度无横向溢出 |
| M4 可视化 | **部分完成** | 地球、实时位置、轨迹、过境表已接；时间轴、足迹、覆盖图层待补 |
| 流式 | 待补 | 当前前端复用 `/api/chat`（headless 一次性返回）；D2 的 SDK 流式桥未接 |
| M5 联调上线 | 未开始 | 待 D7–D9 与验收演示 |

---

## 10. 风险与回滚

| 级别 | 风险 | 触发条件 | 缓解/回滚 |
| --- | --- | --- | --- |
| P0 | CelesTrak 偶发不可达（2026-10-19 曾整段 TLS EOF，同日恢复） | 3 次重试用尽 → `abandoned` | 当天停止；保留上一版数据；次日 03:00 自动恢复；`sync_status` 告警 |
| P0 | gh 未登录阻塞建仓 | `gh auth status` 失败 | 用户手动登录；或先用本地 git，远端后补 |
| P0 | SDK 装配失败 | `dsh --profile sdk` 起不来 | 回退 headless + SSE（功能降级，不阻塞前端） |
| P1 | Cesium 资产过大，隧道慢 | 首屏 > 5 s | 本地低分辨率影像 + 懒加载；必要时降级 2D |
| P1 | npm 包与本地 React 版本冲突 | 构建失败 | 锁版本；必要时 vendor 该包源码 |
| P1 | 区县边界 GCJ-02 偏移 | 覆盖判定偏差 > 1 km | 转换 + 面积校验；不合格则只用城市级 |
| P1 | 无门禁 + bash 全放行 | 公网滥用 | Access 收紧；审计；Phase 3 补门禁 |
| P2 | 云量预报偏差 | 与实况差异大 | 标注"预报"；Phase 3 接卫星云图 |

---

## 11. 决策记录（已关闭）

| # | 问题 | 结论 | 日期 |
| --- | --- | --- | --- |
| Q1 | 默认展示集 | 111 颗全部中国（102 LEO + 9 GEO，公开载荷优先），按杭州 7 天过境频次选定，见 §4.4 | 2026-10-19 |
| Q2 | 星历数据源 | CelesTrak GP 直连为主；Space-Track 仅内部核对；镜像仅研究/兜底 | 2026-10-19 |
| Q3 | 云量与 AOI | Open-Meteo 接入；AOI 做 GCJ-02→WGS84 与面积校验，见 §4.7/§4.8 | 2026-10-19 |
| Q4 | `gh` 登录 | 已完成（`Me106y`，keyring，scopes 含 repo/workflow） | 2026-10-19 |

> 当前无阻塞项。下一步按 §9 的 M1 开工。

---

## 12. 附录

### 12.1 术语

| 术语 | 含义 |
| --- | --- |
| TLE | 两行轨道根数；5 位 NORAD 号已耗尽，新对象用 OMM |
| OMM | Orbit Mean-Elements Message，结构化轨道根数 |
| SGP4 | 简化通用摄动模型，TLE 的标准传播算法 |
| AOI | Area of Interest，关注区域 |
| MCP | Model Context Protocol，Agent 调用外部工具的协议 |
| AOS/LOS/TCA | 过境开始/结束/最高点时刻 |
| MRT/ART | 最大/平均重访间隔 |

### 12.2 关键事实来源

- CelesTrak GP 格式与限流：<https://celestrak.org/NORAD/documentation/gp-data-formats.php>（经 Wayback 2026-10-13 快照核实）
- CelesTrak 使用政策：<https://celestrak.org/usage-policy.php>
- Space-Track API 与限流：<https://www.space-track.org/documentation#/api>
- Space-Track 用户协议（禁止转发）：<https://www.space-track.org/auth/createAccount>
- DSH 文档：`docs/subsystems/mcp.zh.md`、`docs/subsystems/skills.zh.md`、`docs/api-gateway.zh.md`、`packages/bundle/headless/src/json-stream.ts`
- 本仓库旧实现：`src/sat_ephemeris/*`、`data/tle_cache.sqlite`、`data/district_boundaries/*`

### 12.3 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-10-19 | v1.5 | M3 前端骨架落地：`web/` React+Vite+TS+Cesium、1/3+2/3、111 颗实时位置、选中星轨迹/过境、`/api/chat`；补充 `payload_public` 列 |
| 2026-10-19 | v1.4 | 展示集扩到 **111 颗**（102 LEO + 9 GEO，全部国内公开轨道；商业 64/民用 29/气象海洋 18；军事 0）；新增 13 颗 payload_public=false 仅轨道条目、低轨异常提示、111 颗前端性能口径 |
| 2026-10-19 | v1.3 | 展示集初版：30 颗全部中国（25 LEO + 5 GEO）；补充 44312=捕风一号A、40143=Yaogan-21、GF-12=SAR 等数据质量结论 |
| 2026-10-19 | v1.2 | 同步改为每日 1 次（03:00）+ 最多 3 次重试，失败当天停止；新增 `sync_state` 表，`sync_run`/`sync_item_error` 增加尝试次数、重试与错误字段 |
