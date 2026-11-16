# SIRIAgent v2.0.0 PRD：单场景区域重访规划

| 项目 | 内容 |
| --- | --- |
| 目标版本 | v2.0.0（SemVer MAJOR，API 破坏性收敛） |
| 状态 | 草案，待评审 |
| 日期 | 2026-11-16 |
| 范围 | SIRIAgent（成图抽屉、报告入口、全站界面精修）+ RS-Service（数据扩容、单场景求解、进度、性能、报告模板） |
| 不在本版 | 省级/超大范围、放宽分辨率模式、SAR、自动扩窗、ETA、过境甘特、云量双算、旧 task1/3/4/5 的新入口与兼容层 |
| 上游 | `docs/PHASE2-REQUIREMENTS.md`、`docs/PRD-v1.2.0.md`、`AGENTS.md` |
| 关联 | `../RS-Service/docs/api.md`、`../RS-Service/src/rs_service/plan_api.py` |

---

## 1. 背景与目标

### 1.1 现状

- 「卫星成图」抽屉有 5 个任务（task1~task5），每个任务的目标字段、KPI、报告口径都不同；使用者真正想要的只有一个问题：**给定一个区域和一个重访时间，最少需要几颗星、能不能做到。**
- 求解在 RS-Service 进程内单 worker 执行，前端只看到「排队中 / 正在传播与选星」，不知道卡在哪一步；168h 窗口实测 858s，其中机会计算 335s、选星 266s。
- 报告模板的地图与回放轴被 `max-width:780px` 卡住，1600 宽屏只占一半；正文 13.5px、辅助 11–12px，偏小。
- 目录 65 颗（61 光学 + 4 高光谱），≤10m 光学候选 53 颗。实测在 72h / 24h / 100% 下 ILP 返回 0 颗、0.0%——现有目录的密度不足以支撑“全区域 24h 重访”。

### 1.2 目标

1. **一个场景**：`revisit`——覆盖一个区域，并保证区域在给定重访时间 T 内持续被重访；不限制星数、不限制时间窗（窗口由系统按 3T 派生）。
2. **算得动**：24 核并行传播 + 限时选星，72h/180 星首解 ≤ 3 分钟，168h ≤ 8 分钟；算不动时给“全目录上限”，不允许只转圈。
3. **看得见**：后端 job 暴露 `progress`，前端显示阶段、逐星计数、已用时间；关掉抽屉再打开能续看。
4. **补得够**：把 ≤10m 光学目录补到 203 颗（全部可规划：原 53 + 37 国产 + 3 Sentinel-2 + 110 PlanetScope），并用杭州 144h / 48h / 100% 的实测做闸门；24h 实测 76.08%，不再作为可选档。
5. **看得清**：报告地图与回放轴铺满主区，正文字号 15px；全站字号阶梯统一，补 `DESIGN.md`。

### 1.3 实测基线（2026-11-16，线上 RS-Service，杭州 330100）

| 配置 | 结果 | 耗时 |
| --- | --- | --- |
| ≤10m，24h 窗 / T=12h / 90% | 2 颗，达标 0.0% | 73s（机会 45s、选星 7s、云量约 20s） |
| ≤10m，48h 窗 / T=48h / 90% | 4 颗，达标 10.0% | 146s（机会 96s、选星 27s） |
| ≤10m，96h 窗 / T=48h / 90% | 10 颗，达标 34.2% | 312s（机会 192s、选星 108s） |
| ≤10m，168h 窗 / T=48h / 90% | 16 颗，达标 15.8% | 858s（机会 335s、选星 266s） |
| ≤10m，72h 窗 / T=48h / **100%**（ILP-only） | **0 颗，0.0%** | 256s |
| **≤1km**，72h 窗 / T=48h / **100%** | **1 颗（FY-3F），100.0%**，面积加权 MRT 23.7h | 221s（机会 164s、选星 57s） |

结论：

- 持续重访（含首尾空档）在窗口拉长时达标面积会下降（168h 15.8% < 96h 34.2%；两次云量条件不同——168h 滤掉 1690 个窗口、96h 未滤云，但“首尾空档随窗口变长而更难满足”的方向性成立），**不能自动扩窗**；W 应按 T 派生（见 §3.2）。
- 100% 的真正瓶颈是分辨率：放宽到 ≤1km 后 1 颗 FY-3F 即可 100%；坚持 ≤10m 必须靠补星（见 §4）。
- ILP 在不可行时返回 0 颗星，不能直接上屏；必须另跑限时贪心给“全目录上限”（见 §3.3）。

---

## 2. 术语与口径

| 术语 | 定义 |
| --- | --- |
| **T（重访时间）** | 用户给定的小时数，可选 48 / 72，默认 48（下限 48；24h 在现目录下全目录上限仅 76.08%） |
| **W（评估窗口）** | `min(3T, 168h)`；168h 是 TLE 有效期上限。T=72h 时 W=168h（2.33T），结果必须标注“受 TLE 上限限制” |
| **达标面积** | 面积中「单格最长重访间隔（MRT）≤ T」的占比；MRT **含夜间与窗口首尾空档** |
| **100%** | 全部 5km 网格代表点都达标，不四舍五入；99.98% 就是未达标 |
| **全目录上限** | 用全部候选星直接计算的达标面积（不需要选星），用来回答“不是算法偷懒，是目录不够” |
| **连续重访** | 窗口内每个格子的最长间隔（首访距窗口开始、相邻两次、末访距窗口结束）都 ≤ T |
| **数据闸门** | 补星后必须跑通「杭州 144h / 48h / 100% 可行」，否则停止扩容、结果给放宽分辨率建议 |
| **模型/型号** | 卫星的载荷系列（如吉林一号高分03），不是单颗卫星 |

所有对外结果继续带 `accuracy_note`：TLE/SGP4 在 LEO 约 1 km/天，过境时间 ±1 分钟；W=168h 时第 7 天的预报误差更大，报告必须写明“7 天预报，结果用于可行性判断”。

---

## 3. 单一场景：`revisit`

### 3.1 输入

| 字段 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `aoi_code` / `aoi_wkt` | 二选一 | — | 市 / 区县 adcode，或浙江省内 `POLYGON` WKT |
| `revisit_hours` | 是 | 48 | 48 / 72，下限 48 |
| `start_utc` | 否 | 当前整点 | 窗口起点；前端按本机时区填写，提交转 UTC |
| `sensor_types` | 否 | `["optical"]` | 本版 100% 承诺只对光学；高光谱保留在目录与星历，不参与 revisit 选星 |
| `max_resolution_m` | 否 | 10 | 1 / 2 / 5 / 10；不提供 >10m 档 |
| `cloud_filter` | 否 | `false` | 默认不滤云；开启时按网格代表点 Open-Meteo 逐小时云量剔除 |
| `grid_size_km` | 否 | 5 | 固定 5 km，不在 UI 暴露 |
| `detection_step_s` | 否 | 10 | 固定 10 s，不在 UI 暴露 |

**AOI 限制**：只允许市、区县、自定义多边形；自定义面积 ≤ 20,000 km²（覆盖浙江最大地级市丽水约 17,298 km²）。省级 AOI 在本版禁用，`GET /plan-options` 的 `aoi` 列表不再返回 `level="province"` 的选项；直接传省级 adcode 返回 422 `aoi_too_large`。

### 3.2 判定

服务端把输入翻译成引擎参数：

```
horizon_h        = min(3 * revisit_hours, 168)
mrt_target_s     = revisit_hours * 3600
area_target_pct  = 100
fallback_area_target_pct = 100   # 不做面积降级
auto_expand      = false
method           = "both"        # 限时贪心 + ILP
```

判定规则（与引擎 `task_2_min_satellites_mrt` 一致）：

1. 对每个 5km 网格代表点，按选中卫星的全部可见窗口计算最长间隔，**首尾空档计入**；
2. 最长间隔 ≤ T 的网格面积占比即达标面积；
3. 达标面积 = 100% 且选中星数最少 → 可行；
4. 达不到 100% → 不可行，返回“全目录上限 + 实际最好方案”，不返回 0 颗星（见 §3.3）。

**为什么 W = 3T**：W = T 时未覆盖格的首尾空档正好等于 T，会出现“0 颗星也达标”；W = 2T 时中段一次覆盖就能满足两侧空档。W = 3T 才强制每格至少两次覆盖、真正体现“持续重访”。

**为什么 T=72h 时 W 封顶 168h**：3×72=216h 超过 TLE 7 天有效期；封顶后仍是 2.33T，结果标注“窗口受 TLE 上限限制”。

### 3.3 输出与不可行

结果卡与报告必须包含：

| 字段 | 内容 |
| --- | --- |
| 最少卫星数 | 可行时是真正的最小集合；不可行时是“实际最好方案”的星数 |
| 达标面积 | `qualified_area_pct`，保留 1 位小数；100% 显示 `100.0%` |
| 全目录上限 | 全部候选星的最优努力达标面积；与“实际最好方案”并列展示 |
| 面积加权 MRT | 实际最长间隔的面积加权值，用小时显示 |
| 评估窗口 | W、T、是否受 TLE 上限限制、云量是否过滤 |
| 评估窗口内覆盖率 | `city_mean_temporal_coverage_pct`，作为辅助指标，不作为 KPI |

**不可行时**：

- 文案固定为「未达标 · 全目录上限 X%」，禁止出现“0 颗星 / 无方案”；
- 附一条“出路”建议，数字必须来自实测：
  - 放宽到 ≤1km：`1 颗 FY-3F，250 m，72h 内 100%，面积加权 MRT 23.7h`；
  - 或把 T 放宽到 48h（如果 48h 能达标）。
- 建议文案只在 `max_resolution_m <= 10` 且不可行时出现；不要把它做成可点击的“自动放宽”，避免误操作。

**最佳努力的实现**：

1. 先跑限时贪心（≤60s），得到“能在 100% 目标下拿到的最好集合/面积”；
2. 再跑 ILP（≤30s），若找到可行解则以 ILP 为准；
3. 两者都不可行时，用贪心集合 + 全候选星指标的较大者作为“全目录上限”；
4. 结果写 `optimality`：`proven_optimal` / `time_limited` / `infeasible_heuristic`，前端与报告原样展示。

### 3.4 交互流程（抽屉 4 步）

1. **范围**：省/市/区县换成「市 / 区县 / 地图绘制」；省下拉移除，默认杭州市。
2. **重访**：T 两档（48 / 72 小时，默认 48）+ 开始时间（默认当前整点）；显示派生窗口 `W = min(3T, 168h)` 与“为什么是这个窗口”的一句话。
3. **约束**：分辨率（1/2/5/10 m）、云量开关（默认关）、载荷（光学，只读）、目录规模与 TLE 年龄。
4. **求解与报告**：进度、结果卡、生成报告、历史结果。

旧的第 1 步「任务」整步删除；左导轨从 5 步变 4 步。

### 3.5 边界与错误

| 场景 | 行为 |
| --- | --- |
| AOI 面积 > 20,000 km² | 422 `aoi_too_large`，文案“本版只支持市级/区县级范围” |
| AOI 不在浙江 | 422 `aoi_out_of_zhejiang` |
| TLE > 168h | 拒绝求解，`tle_stale`，给 `rs-service sync` 提示 |
| TLE 72–168h | 允许，结果标 `degraded` |
| 候选为 0 | `no_candidates`，列出 blocked 原因 |
| 选星超时 | 返回最佳努力 + `optimality=time_limited`；不报 500 |
| 服务重启导致 job 丢失 | 前端提示“任务已失效，请重新求解”，清 localStorage 的 job_id |
| W=168h 且 T=72h | 结果标注“2.33T，受 TLE 上限限制” |

---

## 4. 数据扩容

### 4.1 目标与型号

- 目标：≤10m 光学从 53 颗补到 **203 颗（全部 ≤10m 光学）**：新增 37 颗国产 + 3 颗 Sentinel-2 + 110 颗 PlanetScope Flock。
- 型号优先级（历史口径，实测后已加入国际公开星）：
  1. 宽幅优先：吉林一号 Kuanfu（136–150km / 0.5m）、北京三号B（150km / 0.5m）；
  2. 数量补齐：吉林一号高分03（17km / 0.75m）、高分02（17km / 0.75m）；
  3. 其他有官方参数的国产光学型号（四维、PIESAT、HJ、ZY、GF 系列）。
- 排除：视频星、红外/夜光、SAR、参数拿不到官方来源的型号、>10m 的型号。
- 每颗入库星必须有：`norad`、`name`、`sensor_type=optical`、`raw_spec`（可解析出分辨率与幅宽）、`confidence=official`、`source_url`、`model`（型号键）。

### 4.2 参数来源与置信度

- **粒度**：型号级官方。一个官方页面/官方 PDF 覆盖同型号一批星；每颗星单独写 `source_url` 并校验型号归属。
- **置信度**：新增星只用 `official`；现有 65 颗的 `vendor/approx` 保留，不强行升级。
- **抓取**：已实测 `jl1.cn` 的 WAF 只拦非浏览器请求；无头 Chrome 可读取单星/型号页（示例抓到“0.75m 全色 / 3m 多光谱 / 幅宽优于 17km / 535km 太阳同步轨道”）。抓取脚本放 `../RS-Service/scripts/`，产物 `data/jl1_models.json`（型号、分辨率、幅宽、source_url、抓取时间）。
- **校验**：分辨率与幅宽必须能从 `raw_spec` 解析；解析失败或为空的型号不入库；型号页与 CelesTrak 名称对不上的星不入库，列在 `data/unmatched.json`。
- **许可与合规**：只使用官方公开参数与 CelesTrak 公开 TLE；不抓取付费数据、不绕过登录。WAF 若升级导致无法读取，退回“人工提供型号表”，不伪造参数。

### 4.3 入库与同步

1. 从 CelesTrak `GROUP=active` 匹配型号名（`JILIN-01`、`BEIJING-3` 等）；匹配不到时按 NORAD 单颗 `CATNR` 拉取。
2. 生成 `data/satellites_seed.json` 增量（保留现有 65 颗）。
3. `rs-service seed` 入库；`sensor.swath_km` 由 `raw_spec` 的幅宽字段解析（不要取“宽幅模式”的最大值，避免把 60km 星写成 800km）。
4. `rs-service sync` 拉 TLE；`plan-options.capability.plannable` 必须等于新增后的 ≤10m 光学数量。
5. 文档里的“65 颗”“61 光学 + 4 高光谱”全部改为动态计数或新数字。

### 4.4 数据闸门

**前置条件**：M1 性能并行已完成（否则 180 颗单核要跑 9 分钟，无法验收）。

**闸门命令**（RS-Service）：

```sh
.venv/bin/python scripts/revisit_gate.py \
  --aoi 330100 --revisit-hours 24 --max-resolution-m 10 \
  --expect-area 100 --window-hours 72
```

**通过标准**：

- `feasible == true`；
- `qualified_area_pct == 100.0`；
- 单次耗时 ≤ 3 分钟（并行后）；
- 新增星的 `confidence` 全为 `official`，且每颗都有 `source_url`；结果里列出 confidence 分布（existing 的 vendor/approx 星允许被选中，但必须在报告里标出来源）；
- 报告标题/结果卡显示“达标面积 100.0%”，不出现“0 颗星”。

**不通过的处理**：

- 停止扩容，不为了凑 100% 再补第三批；
- 结果页按 §3.3 给“放宽到 ≤1km 可 100%（1 颗 FY-3F）”的建议；
- 由产品负责人在 PRD 评审里签字确认“发布不可达 100% 的版本”或“改 T/放宽分辨率”，不得默默上线。

**实测结论**：203 颗时 T=24h 全目录上限 **76.08%**，仍不可达；T=48h 达到 **100%**（5 颗星，451s）。24h 的瓶颈是光学白天窗口 + 太阳同步轨道地方时簇聚，继续堆星不能解决。

---

## 5. 进度

### 5.1 后端契约

`GET /api/v1/plans/{job_id}` 增加 `progress`：

```json
{
  "status": "running",
  "progress": {
    "stage": "opportunities",
    "label": "传播与过境机会",
    "current": 42,
    "total": 180,
    "pct": 51.2,
    "elapsed_s": 63.4,
    "updated_at": "2026-11-16T07:12:03Z"
  }
}
```

- `stage` 枚举：`prepare` / `grid` / `opportunities` / `cloud` / `selection` / `metrics` / `playback` / `done`。
- `current/total`：机会阶段是“已传播卫星数 / 候选总数”；选星阶段是 1/2（贪心）、2/2（ILP）；其他阶段可为 `null`。
- `pct`：0–100，按阶段权重相加：机会 65、选星 25、云量 5、其余 5；阶段内按 `current/total` 线性。
- `elapsed_s`：从 `created_at` 起算的墙钟秒数。
- 进度写在 `JobStore` 的 job dict 里，由求解线程通过回调更新；锁内更新，前端轮询读到的是快照。

### 5.2 进度回调链路

- `facade.execute_request` 增加可选 `progress` 参数（第 4 处 vendor 改动，记入 `VENDOR.md`）；
- 透传给 `regional_opportunities.compute_regional_opportunities(progress=...)`，该函数已支持逐星回调；
- `adapter` 在阶段边界补：`prepare`（读 AOI/候选）、`grid`、`cloud`（若开）、`selection`（贪心/ILP 两段）、`metrics`/`playback`；
- `run_plan` 不再有自动扩窗循环，进度里不需要“第 N 次尝试”。

### 5.3 前端

- 第 4 步「求解与报告」显示：
  - 阶段列表（已完成打勾、当前高亮、未开始灰）；
  - 进度条 + `pct`；
  - 当前阶段的 `label` 与 `current/total`（如“传播与过境机会 · 42/180”）；
  - 已用时间 `elapsed_s`；
  - **不显示 ETA**，不写“预计还需 X 秒”。
- 轮询间隔 1.2s；连续失败 2 次显示“状态查询暂时失败，正在重试”，不清空进度。
- 选星阶段文案写“贪心（≤60s）+ ILP（≤30s）”，不写“最多 30s”。

### 5.4 持久化与失败态

- 提交成功后把 `job_id` 写 `localStorage`（key `siri.plan.job`），关闭抽屉不清除。
- 重开抽屉时读取 `job_id`：能查到 → 恢复轮询并显示进度；404 → 清除并提示“任务已失效（服务可能重启过），请重新求解”。
- 求解完成/失败后清除 `job_id`，避免下次误恢复。
- 服务重启导致 job 丢失是已知行为；PRD 不要求持久化任务结果，只要求“能恢复就恢复，不能恢复要说清楚”。

---

## 6. 性能

### 6.1 并行传播

- 机会计算按卫星切分，进程池/线程池并行，默认 `min(24, os.cpu_count())` 个工作进程。
- 合并结果必须按 `sat_index` 确定性归并，保证同一输入多次求解结果一致；golden 测试不得漂移。
- 进度回调从 worker 聚合到主进程，按完成卫星数递增，不要求严格顺序。
- 只并行“传播与过境机会”，选星仍单线程（CBC/贪心本身不适合多进程拆分）。

### 6.2 选星限时

- 贪心：在 `greedy_select_mrt` 增加 `time_limit_s`（默认 60），到点停止并返回当前最好集合 + `status=time_limited`；反向删除阶段也受同一时限约束。
- ILP：保持 `selection_time_limit_s=30`。
- 顺序：先贪心（保证有解可展示），再 ILP（尝试更优/可行）；ILP 失败或超时回退贪心。
- 推荐逻辑：可行解优先，其次星数少，其次达标面积高；同分时取贪心（结果更稳定）。

### 6.3 预算与验收

| 场景 | 目标 |
| --- | --- |
| 72h / 180 星 / 云量关 | ≤ 180s（机会 ≤ 60s + 选星 ≤ 90s + 其他 ≤ 30s） |
| 168h / 180 星 / 云量关 | ≤ 480s |
| 72h / 65 星 / 云量关 | ≤ 90s |
| 任意场景 | 进度每 2s 至少更新一次；超时也有结果 |

- 验收时记录 `timings_s`（grid/opportunities/selection/total）与墙钟时间，写进 PR 正文。
- 并行实现若改 vendor，记入 `VENDOR.md` 的“Deliberate changes”第 5 条；能在 adapter 层做就不改 vendor。

---

## 7. 报告

### 7.1 布局

- 「覆盖与回放」的 `.mapwrap` 去掉 `max-width:780px`，地图按 16:9 铺满主区（main 的内容宽度）；回放轴、播放键、图例随容器铺满。
- 主区保持单列流式，不新增侧栏；表格宽度 100%，长表格允许横向滚动而不是压缩字号。
- 首屏顺序：标题 → KPI 条 → 窗口上下文 → 卫星构成 → 覆盖与回放 → 推荐计划 → 口径与精度。
- 本轮**不新增**过境甘特图（Q5 选的是 a）。

### 7.2 字号

| 元素 | 现在 | 目标 |
| --- | --- | --- |
| 正文/表格 | 13.5px | **15px** |
| 辅助说明 `.lede` | 13px | 14px |
| 标签 `.context .k` / `.strip .lab` | 11–12px | **12.5px** |
| 小字/脚注 | 11px | **12px**（不再出现 10px 正文） |
| H1 | clamp(26–34px) | 保持 |
| H2 | 17px | 19px |
| KPI 数值 | 20px | 24px |

行高 1.7；表格行高 ≥ 44px；打印/PDF 保持浅色主题。

### 7.3 KPI 与零方案态

- KPI 条（4 格）：**最少卫星数 / 达标面积（最长重访 ≤ T · 目标 100%）/ 全目录上限 / 评估窗口**。
- 可行：标题「区域重访：选中 N 颗，达标面积 100.0%」；不再出现时间覆盖率/面积加权 MRT 作为主 KPI。
- 不可行：标题「未达标：全目录上限 X%」；KPI 显示实际达标面积与全目录上限；正文给“放宽到 ≤1km 可 100%”的建议与实测数字。
- 删除 task1/3/4/5 的分支文案、`show_temporal` 逻辑与旧标签；`target_label` 只剩“达标面积（最长重访 ≤ T）”。
- 卫星表加一列「参数来源」（official/vendor/approx），让补星后的目录可追溯。

### 7.4 口径

报告「口径与精度」必须写：

- W = 3T（或封顶 168h，2.33T）、T、是否滤云；
- MRT 含夜间与窗口首尾空档；光学夜间空档约 12–19h，T < 19h 物理上不可达；
- 100% 指全部 5km 网格代表点，不四舍五入；
- TLE 年龄、degraded 标记、7 天预报的误差提示；
- 目录来源与 confidence 分布（official / vendor / approx 各多少颗）；
- 不可行时的全目录上限与建议。

---

## 8. 全站界面精修（impeccable）

### 8.1 范围

保留三栏布局、深色星历风与信息架构，只做层级、字号、密度、对齐、对比度的精修：

| 面 | 内容 |
| --- | --- |
| App 壳 | 顶部品牌/入口、按钮层级、间距 |
| 左栏 | 卫星目录、搜索/筛选、TLE 状态、选中态 |
| 地球区 | 控件（图层/时间轴/定位）、图例、浮层 |
| 对话 | 消息、工具卡、思考块、输入区、问答卡 |
| 成图抽屉 | 4 步向导、进度、结果卡、历史列表 |
| 解译抽屉 | 功能选择、槽位、结果三联图 |
| 购买页 | 成功页摘要、图像列表 |
| 设置菜单 | 弹层与表单 |

不做：换配色/换字体家族/改三栏结构/移动端专项。

### 8.2 字号阶梯

统一为 CSS 变量（`web/src/styles.css`）：

```
--text-xs: 12px;    /* 最小可读字号，禁止更小 */
--text-sm: 13px;
--text-base: 14px;
--text-lg: 16px;
--text-xl: 20px;
--text-2xl: 26px;
```

- 正文/表单/按钮 ≥ 14px；辅助说明 ≥ 13px；标签/角标 ≥ 12px；
- 报告单独一套：正文 15px、辅助 14px、标签 12.5px；
- 不允许用 `transform: scale()` 或 `zoom` 假装放大。

### 8.3 DESIGN.md

- 新建 `DESIGN.md`（Google Stitch 格式），记录：颜色、字体、字号阶梯、间距、圆角、阴影、组件状态、深浅主题（报告）、动效时长。
- 同步更新 `PRODUCT.md` 的「Capabilities」：task1~4 → `revisit`；成图报告四节不变。
- 后续 UI 改动以 DESIGN.md 为基线；与代码冲突时先改文档再改代码。

### 8.4 验收

- 1280 / 1440 / 1920 三档无横向溢出；<1024 单列堆叠；
- 键盘 Tab 能到所有交互元素，焦点可见；ESC 关闭抽屉；
- 报告深/浅主题都无低对比文字；打印/PDF 浅色不截断；
- 不出现 <12px 的可读正文（含报告）。

---

## 9. 接口与数据契约

### 9.1 API 变化（RS-Service）

| 方法 | 路径 | 变化 |
| --- | --- | --- |
| GET | `/api/v1/plan-options` | 只返回一个任务 `revisit`；新增 `revisit`（可选小时、默认、窗口规则）、`aoi_limits`（最大面积、允许 level）；`aoi` 不再返回省级 |
| POST | `/api/v1/plans` | 入参改为 `operation="revisit"`、`revisit_hours`；不再接受 task1~5、`auto_expand`、`area_target_pct`、`n_budget`、`mrt_target_minutes`；面积目标服务端固定 100 |
| GET | `/api/v1/plans/{job_id}` | 新增 `progress`；结果字段见 9.3 |
| POST | `/api/v1/plans/{job_id}/report` | 报告目录改为 `reports/imaging-plan/revisit/<run_id>/` |
| GET | `/api/v1/plans/history` | 扁平列表；旧 task1~5 的 run 仍返回，`task="legacy"`、`task_label` 用旧名；新 run `task="revisit"` |

错误码新增：`aoi_too_large`、`revisit_unsupported`；保留 `aoi_out_of_zhejiang`、`tle_stale`、`no_candidates`、`bad_aoi`、`plan_not_found`、`plan_not_completed`。

`POST /plans` 示例：

```json
{
  "operation": "revisit",
  "aoi_code": "330100",
  "revisit_hours": 24,
  "start_utc": "2026-11-16T16:00:00+08:00",
  "max_resolution_m": 10,
  "cloud_filter": false
}
```

### 9.2 结果字段

沿用现有 `summary_cards`，新增/固定：

| 字段 | 说明 |
| --- | --- |
| `summary_cards.satellite_count` | 实际最好方案的星数 |
| `summary_cards.qualified_area_pct` | 达标面积（≤T） |
| `summary_cards.ceiling_area_pct` | 全目录上限（新增） |
| `summary_cards.area_weighted_mrt_minutes` | 面积加权 MRT |
| `targets.revisit_hours` | T（新增，替代 `mrt_minutes` 语义） |
| `targets.area_pct` | 固定 100 |
| `window.used_horizon_h` | W；新增 `window.capped_by_tle` 布尔与 `window.window_rule="3T"` |
| `optimality` | `proven_optimal` / `time_limited` / `infeasible_heuristic` |
| `catalog` | 候选数、confidence 分布、official 数（新增） |
| `suggestion` | 不可行时的放宽建议（结构化：`{"kind":"relax_resolution","max_resolution_m":1000,"estimated_sats":1,"source":"FY-3F"}`） |

### 9.3 历史与文件

- 新报告目录：`reports/imaging-plan/revisit/<run_id>/{plan.json,report.html,meta.json}`；`latest` 软链不变。
- 旧目录 `task1..task5` 保留，历史列表可打开；不迁移、不删除。
- `meta.json` 的 `task` 字段新值为 `revisit`；旧报告仍是 `task1..task5`，历史接口负责兼容。
- `/api/files` 白名单不变（`reports/` + `workspace/`）。

---

## 10. 里程碑与 PR 切分

> 跨仓：先合 RS-Service 接口/数据/性能，再合 SIRIAgent 前端。每个 PR 只做一件事；正文按 `.github/pull_request_template.md`。

| 里程碑 | 仓库 | 内容 | 依赖 | 验收 |
| --- | --- | --- | --- | --- |
| **M1 性能** | RS-Service | 逐星并行传播、贪心限时、进度回调骨架 | — | 72h/65 星 ≤90s；结果与 golden 一致 |
| **M2 数据** | RS-Service | 官方型号抓取、seed 扩容到 203、TLE 同步 | M1 | 闸门：杭州 144h/48h/100% 可行；24h 实测 76.08% |
| **M3 单场景 + 进度** | RS-Service | `revisit` API、W=3T、100%、全目录上限、progress 契约 | M1 | API 单任务；不可行不返回 0 星；progress 可读 |
| **M4 前端抽屉** | SIRIAgent | 4 步向导、进度、持久化、单场景结果卡 | M3 | 三档宽度；关开抽屉恢复；失败态 |
| **M5 报告** | RS-Service | 铺满、字号、KPI、零方案态、confidence 列 | M3 | 1440/1920 铺满；15px；无旧 KPI |
| **M6 全站精修** | SIRIAgent | 字号阶梯、组件精修、DESIGN.md | M4 | 三档无溢出；<12px 清零 |

版本：

- M1/M2 走 PATCH（1.11.3、1.11.4）；M3 合并时升 **2.0.0**（破坏性 API），M4/M5/M6 继续按 PATCH 递增（2.0.1 → 2.0.3），最终以最后一个合并的 PR 打 `v2.0.3` tag；PRD 标题的 2.0.0 指“首个破坏性版本”。
- 若 M2 闸门未过，M3 合并前必须按 §4.4 走“产品负责人签字”分支：要么带“不可达 100% + 建议”发布，要么暂缓并回到数据/口径评审。

---

## 11. 验收清单

1. `GET /plan-options` 只返回 `revisit` 一个任务；省级 AOI 不出现。
2. 杭州、T=48h、≤10m、云量关：能提交并完成；进度依次经过 `prepare → grid → opportunities → cloud? → selection → metrics → playback → done`，机会阶段显示 `N/总数`。
3. 关闭抽屉再打开，进度恢复；服务重启后提示“任务已失效”。
4. 不可行时结果卡显示「未达标 · 全目录上限 X%」，不出现“0 颗星”；建议文案含 FY-3F 实测数字。
5. 数据闸门通过（或按 §4.4 的失败路径签字）：杭州 72h/24h/100% 达标 100.0%，耗时 ≤3 分钟。
6. 报告在 1440/1920 下地图与回放轴铺满主区；正文 15px；KPI 四格；不出现 task1/3/4/5 的 KPI 与文案。
7. 历史结果为单列表：新 `revisit` + 旧 task1~5 都能打开；旧报告不 404。
8. 1280/1440/1920 无横向溢出；<1024 堆叠；报告深浅主题可读；无 <12px 正文。
9. `cd web && pnpm build` 绿；`cd ../RS-Service && uv run pytest` 绿；`ruff check` 绿。
10. `VERSION`、`web/package.json`、`CHANGELOG.md` 一致为 2.0.0；`git status` 干净。

**新增回归测试**：

- `test_plan_options_exposes_only_revisit`
- `test_revisit_window_is_three_t_and_capped_at_168`
- `test_revisit_area_target_is_fixed_100`
- `test_infeasible_returns_best_effort_not_zero_sats`
- `test_progress_stages_are_monotonic`
- `test_aoi_larger_than_20000_is_rejected`
- `test_report_full_width_and_no_legacy_kpi`（文本断言：无「时间覆盖率」「面积加权 MRT」主 KPI、无 task1 文案）

---

## 12. 明确不做

- 省级/超大 AOI；面积 > 20,000 km² 的自定义范围。
- 放宽到 >10m 的分辨率模式（只作为不可行时的建议文案）。
- 国际卫星（PlanetScope / Sentinel-2 / SPOT）。
- SAR、视频星、红外/夜光。
- 自动扩窗（72h → 168h 的多轮求解）。
- ETA / 预计剩余时间。
- 过境甘特图。
- 云量双算（滤云前/后并列）。
- task1/3/4/5 的 API 与 UI 兼容层（旧报告除外）。
- 任务状态持久化到数据库（服务重启丢失是已知行为）。

---

## 13. 风险与回滚

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 补到 180 颗仍达不到 72h/24h/100% | 100% 承诺落空 | 数据闸门硬门；失败则停扩容，结果给放宽建议，产品负责人签字 |
| 官方型号页 WAF 升级/改版 | 抓取失败 | 已验证无头 Chrome 可读；失败退回人工型号表，不伪造参数 |
| CelesTrak TLS 偶发不可达 | 新星没有 TLE | 同步重试 + 代理；`tle_stale` 拒绝求解并提示 |
| 180 颗选星 ILP 解不动 | 结果次优 | 限时贪心 + ILP 30s；标 `time_limited`；结果页说明 |
| 并行改变结果 | golden 漂移 | 按 sat_index 确定性归并；golden 测试必须不变 |
| 破坏性 API | 旧前端/脚本 404 | 只保留旧报告静态文件；前端同版升级；CHANGELOG 写明 |
| 100% 对部分城市不可达 | 演示翻车 | 闸门只承诺杭州；其他城市如实展示“全目录上限”，不硬凹 |
| 180 颗单次 168h 太慢 | 体验差 | 预算 ≤8 分钟；进度可见；必要时提示改用 72h 窗口 |
| 全站精修范围蔓延 | 拖期 | 只做字号/层级/密度/对齐，不改布局与视觉世界 |

**回滚**：

- 数据扩容可单独回滚 seed（保留旧 65 颗），不影响场景代码；
- 性能并行可开关（环境变量 `RS_PLAN_PARALLEL=0` 回退单进程）；
- 不支持“只回退前端”：2.0.0 的 API 已破坏，回滚必须两仓一起退到 1.11.x；因此 2.0.0 合并前必须两仓联调，合并后保留 `v1.11.2` tag 作为回滚点。

---

## 14. 文档同步

| 文档 | 改什么 |
| --- | --- |
| `AGENTS.md` | 删除 task1~5 的硬规则；新增 revisit 口径（100%、W=3T、云量默认关、AOI 上限、数据闸门） |
| `docs/PHASE2-REQUIREMENTS.md` | §12.3 追加 2.0.0 变更；§11 决策记录 |
| `../RS-Service/docs/api.md` | 单任务、`revisit_hours`、`progress`、`ceiling_area_pct`、历史兼容 |
| `../RS-Service/src/rs_service/coverage_engine/VENDOR.md` | 第 4/5 处 deliberate change（progress 透传、贪心限时、并行） |
| `docs/TROUBLESHOOTING.md` | 新增：进度不动、job 失效、aoi_too_large、数据闸门失败、TLE 拉取失败 |
| `docs/IMAGING-PLAN-GUIDE.html` | 单场景操作说明与报告解读 |
| `PRODUCT.md` | Capabilities 从 task1~4 改为 revisit；界面上限 |
| `CHANGELOG.md` | 2.0.0：破坏性收敛、数据扩容、进度、性能、报告、全站精修 |

---

## 15. 决策记录

| # | 决策 | 结论 |
| --- | --- | --- |
| Q1 | 重访口径 | 持续重访，MRT 含窗口首尾空档 |
| Q2 | 面积目标 | 固定 100%，不做输入 |
| Q3 | 旧任务 | 彻底收敛：API/UI 只留 `revisit`，历史单列表，旧报告保留 |
| Q4 | 进度形态 | 阶段 + 百分比 + 逐星计数 + 已用时间，不做 ETA |
| Q5 | 报告 | 地图 + 回放轴铺满，正文 15px；不加甘特 |
| Q6 | impeccable 范围 | 全站精修（不是只修成图） |
| Q7 | 分辨率 | 坚持 ≤10m，靠补星；不放宽分辨率模式 |
| Q8 | 时间窗 | W = min(3T, 168h)，不自动扩窗 |
| Q9 | 性能 | 进本阶段：并行 + 限时 |
| Q10 | 进度持久化 | job_id 存 localStorage，重开续看 |
| Q11 | 设计方向 | 精修，保留深色三栏 |
| Q12 | 补星范围 | 实测后定为 203 颗（全部 ≤10m 光学）：原 53 + 37 国产 + 3 Sentinel-2 + 110 PlanetScope；24h 不可达、48h 100% |
| Q13 | 数据闸门 | 杭州 72h/24h/100%；不过则回退建议，不硬凹 |
| Q14 | 参数置信度 | 只收 official |
| Q15 | T 范围 | 24–72h，默认 24 |
| Q16 | 云量 | 默认关，报告注明 |
| Q17 | 不可行 | 限时贪心给全目录上限 + 实际最好方案 |
| Q18/Q22 | official 粒度 | 型号级官方 + 每颗 `source_url` |
| Q19 | 补星型号 | 宽幅优先（Kuanfu/北京三号B），GF-03/GF-02 补齐；排除视频/红外/夜光 |
| Q20 | 闸门口径 | 一次闸门；不过停止扩容 |
| Q21 | 性能预算 | 72h ≤3 分钟，168h ≤8 分钟 |
| Q23 | AOI 规模 | 市 / 区县 / ≤20,000 km² 自定义；省禁用 |
| Q24 | 官方参数获取 | 自行抓取（无头 Chrome 已验证可读 `jl1.cn`） |
| Q25 | T=72h 窗口 | W 封顶 168h，标注 2.33T |
