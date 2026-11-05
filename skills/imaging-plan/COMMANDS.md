# imaging-plan 命令清单

把覆盖需求反推成星座编成方案。风险等级：`read` / `write` / `exec` / `network`；Phase 2 不拦截，"需审批"一律为否。

## 命令总表

| 命令 | 用途 | 风险 | 需审批 | 示例 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| `mcp__rs-service__list_aoi` | 列出可用 AOI（只支持浙江） | read | 否 | `{"level": "city"}` | 空 → 检查 `aoi` 表是否已 seed |
| `mcp__rs-service__plan_coverage` | 求解编成方案（问答/校验；结果直接回给模型） | write | 否 | 见下 | 按 `error` 分诊，见"错误码" |
| `~/桌面/RS-Service/.venv/bin/rs-service plan coverage --mode … --aoi …` | 求解并落盘（**出报告走这条**，CLI 是唯一实现） | write | 否 | 见下 | 退出码 2 表示业务错误，stderr 有 JSON |
| `scripts/render.sh --in plan.json --out report.html` | 渲染 HTML 报告（固定项目 venv） | write | 否 | 见下 | 文件不存在 / JSON 缺 `data` → 检查上一步 |

> `plan_coverage` 会写 `coverage_snapshot`（覆盖率、网格间距、算法版本），因此风险等级是 **write**；只读场景可传 `persist=false`。
> 同一组参数**只解一次**：要 HTML 报告就用 CLI `--out`，不要 MCP 解完再用 CLI 重算。

## 逐条说明

### `mcp__rs-service__plan_coverage`

- 模式与必填参数（**只问本模式用得到的字段**）：

  | mode | 必填 | 不填/不用 |
  | --- | --- | --- |
  | `min_sats_for_coverage` | `target_coverage_pct` | `n_sats`、`target_max_gap_hours` |
  | `min_sats_for_revisit` | `target_max_gap_hours` | `n_sats`、`target_coverage_pct` |
  | `max_coverage_for_n` | `n_sats`、`hours` | `target_coverage_pct`、`target_max_gap_hours` |
  | `min_wait_for_n` | `n_sats`、`hours` | `target_coverage_pct`、`target_max_gap_hours` |

  > 给定 N 颗的模式里覆盖率是**输出**：同样 N 颗星，时间窗不同答案就不同，所以要问 `hours`。
  > 这两个模式按给定窗口计算，**不会**自动扩窗。

- 入参：

  | 参数 | 类型 | 必填 | 说明 |
  | --- | --- | --- | --- |
  | `mode` | string | 是 | `min_sats_for_coverage` / `min_sats_for_revisit` / `max_coverage_for_n` / `min_wait_for_n` |
  | `aoi` | string \| array | 是 | adcode（`330100`）、中文名（`杭州`）、或 `POLYGON((lon lat, …))` |
  | `max_resolution_m` | number | 是 | 分辨率不差于此值，单位米 |
  | `target_coverage_pct` | number | 条件 | 目标覆盖率 1–100；**仅 `min_sats_for_coverage` 必填**，其余模式是输出 |
  | `n_sats` | integer | 条件 | `max_coverage_for_n` / `min_wait_for_n` 必填，1–20 |
  | `target_max_gap_hours` | number | 条件 | `min_sats_for_revisit` 必填 |
  | `sensor_types` | array | 否 | 默认 `["optical","sar","hyperspectral"]` |
  | `hours` | integer | 条件 | 时间窗；给定 N 颗的模式**必填**，其余默认 72，上限 336 |
  | `start` | string | 否 | ISO8601 UTC，默认现在 |
  | `extend` | boolean | 否 | 默认 true；**只对 `min_sats_for_coverage` 生效**（达不到目标扩窗 72h→7d→14d） |
  | `persist` | boolean | 否 | 默认 true，写 `coverage_snapshot` |
  | `cloud_filter` | boolean | 否 | 默认 true；光学星按 Open-Meteo 逐小时云量剔除访问 |
  | `cloud_threshold` | number | 否 | 默认 70（%），超过该云量的访问不计入覆盖 |
  | `optical_sun_min_deg` | number | 否 | 默认 10（°），光学/高光谱访问的太阳高度门限；夜间过境不计入覆盖 |

- 示例：

  ```json
  {"mode": "min_sats_for_coverage", "aoi": "330100",
   "max_resolution_m": 10, "target_coverage_pct": 90,
   "sensor_types": ["optical", "sar"], "hours": 72}

  {"mode": "max_coverage_for_n", "aoi": "330400",
   "max_resolution_m": 5, "n_sats": 3, "hours": 72, "sensor_types": ["optical"]}

  {"mode": "min_sats_for_revisit", "aoi": "330100",
   "max_resolution_m": 10, "target_max_gap_hours": 24}
  ```

- 口径：光学/高光谱按**太阳高度 >10°** 与云量过滤，夜间过境不计入覆盖；SAR 不看太阳高度。
- 返回：`{ok, data, accuracy_note, stale, degraded, generated_at}`；
  `data.plan.sats[]` 含 `name / mode_used / resolution_m / swath_km / coverage_pct / coverage_points`；
  给定 N 颗的模式里 `plan.target_pct` / `plan.feasible` 为 `null`，覆盖率看 `plan.coverage_pct`，
  并带 `plan.requested_n`。

- 失败处理：见下方错误码表。

### `rs-service plan coverage`

> `rs-service` 不在 PATH 里，固定用 `~/桌面/RS-Service/.venv/bin/rs-service`（与 `render.sh` 固定 venv 同理）。

```bash
~/桌面/RS-Service/.venv/bin/rs-service plan coverage \
  --mode min_sats_for_coverage --aoi 330100 \
  --max-res 10 --target 90 --types optical,sar \
  --hours 72 --out plan.json

# 给定 3 颗、看 72 小时窗口内最大覆盖：不需要 --target
~/桌面/RS-Service/.venv/bin/rs-service plan coverage \
  --mode max_coverage_for_n --aoi 330400 \
  --max-res 5 --n-sats 3 --hours 72 --out plan.json
```

- 风险：write（写 `coverage_snapshot`）。
- 出报告的唯一入口：`--out reports/<名称>.json`，随后 `render.sh`；不要用 MCP 结果再重算。
- 失败处理：退出码 2 为业务错误（如 `target_unreachable`），stdout 是 JSON；退出码 1 为环境问题。

### 渲染

```bash
skills/imaging-plan/scripts/render.sh --in plan.json --out reports/report.html
```

- 风险：write（只写 HTML 文件）。
- 失败处理：`plan.json` 不存在或 `ok=false` → 不要渲染，先把错误告诉用户。

## 错误码

| code | 含义 | 处理 |
| --- | --- | --- |
| `missing_params` | 缺必填参数（按模式判定） | 按 `missing` + `schema` 只问第一个字段，**不要猜**；给定 N 颗时不该出现 `target_coverage_pct` |
| `aoi_not_found` | 范围不在库里 | 让用户给 adcode 或 WKT；本版本只有杭州市级边界 |
| `aoi_invalid` | WKT 不合法 / 未闭合 | 要求 `POLYGON((lon lat, …))`，首尾闭合 |
| `no_candidate_satellites` | 筛选后无星 | 放宽 `max_resolution_m` 或加传感器类型 |
| `aoi_out_of_zhejiang` | 自定义 AOI 与浙江任一地市均不相交 | 只支持浙江；让用户换 AOI |
| `target_unreachable` | 扩到上限仍不达标 | 报 `best_coverage_pct` / `best_p95_hours`，给建议 |
| `unsupported_mode` | 模式不在枚举 | 回 `allowed` |
| `bad_params` | 参数越界（N 不在 1–20、窗口不在 1–336 等） | 按 `field` + `allowed` 让用户改值，不要夹带默认值硬跑 |

## 输出口径（必须随结果一起说）

- 覆盖率与重访间隔是**估算值**；覆盖按 0.02°–0.2° 自适应网格统计，窄幅宽卫星会把网格压得更细。
- 报告分节：卫星构成 / 覆盖与回放 / 推荐计划（含 CelesTrak 来源）/ 口径与精度；右上角可切换深/浅主题，PDF 导出强制浅色。
- 重访看 **P95**，失败再看 `max_hours` 与 `under_covered_points`。
- 给定 N 颗的模式只对**指定的时间窗**成立（报告标题会写窗口），不得外推成"长期覆盖"。
- 过境时间 ±1 分钟、足迹边缘 ±2–5 km、SGP4 在 LEO 约 1 km/天。
- 报告里保留 `algo_version`、`parser_version`、`grid.spacing_deg`。
