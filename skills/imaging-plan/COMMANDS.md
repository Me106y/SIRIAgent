# imaging-plan 命令清单

把覆盖需求反推成星座编成方案。风险等级：`read` / `write` / `exec` / `network`；Phase 2 不拦截，"需审批"一律为否。

## 命令总表

| 命令 | 用途 | 风险 | 需审批 | 示例 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| `mcp__rs-service__plan_coverage` | 求解编成方案（首选） | write | 否 | 见下 | 按 `error` 分诊，见"错误码" |
| `rs-service plan coverage --mode … --aoi …` | 同上（CLI 等价实现） | write | 否 | 见下 | 退出码 2 表示业务错误，stderr 有 JSON |
| `python scripts/render.py --in plan.json --out report.html` | 渲染 HTML 报告 | write | 否 | 见下 | 文件不存在 / JSON 缺 `data` → 检查上一步 |

> `plan_coverage` 会写 `coverage_snapshot`（覆盖率、网格间距、算法版本），因此风险等级是 **write**；只读场景可传 `persist=false`。

## 逐条说明

### `mcp__rs-service__plan_coverage`

- 入参：

  | 参数 | 类型 | 必填 | 说明 |
  | --- | --- | --- | --- |
  | `mode` | string | 是 | `min_sats_for_coverage` / `min_sats_for_revisit` / `max_coverage_for_n` / `min_wait_for_n` |
  | `aoi` | string \| array | 是 | adcode（`330100`）、中文名（`杭州`）、或 `POLYGON((lon lat, …))` |
  | `max_resolution_m` | number | 是 | 分辨率不差于此值，单位米 |
  | `target_coverage_pct` | number | 是 | 目标覆盖率，1–100 |
  | `n_sats` | integer | 条件 | `max_coverage_for_n` / `min_wait_for_n` 必填 |
  | `target_max_gap_hours` | number | 条件 | `min_sats_for_revisit` 必填 |
  | `sensor_types` | array | 否 | 默认 `["optical","sar","hyperspectral"]` |
  | `hours` | integer | 否 | 默认 72，上限 336 |
  | `start` | string | 否 | ISO8601 UTC，默认现在 |
  | `extend` | boolean | 否 | 默认 true，达不到目标自动扩窗 72h→7d→14d |
  | `persist` | boolean | 否 | 默认 true，写 `coverage_snapshot` |
  | `cloud_filter` | boolean | 否 | 默认 true；光学星按 Open-Meteo 逐小时云量剔除访问 |
  | `cloud_threshold` | number | 否 | 默认 70（%），超过该云量的访问不计入覆盖 |

- 示例：

  ```json
  {"mode": "min_sats_for_coverage", "aoi": "330100",
   "max_resolution_m": 10, "target_coverage_pct": 90,
   "sensor_types": ["optical", "sar"], "hours": 72}
  ```

- 返回：`{ok, data, accuracy_note, stale, degraded, generated_at}`；
  `data.plan.sats[]` 含 `name / mode_used / resolution_m / swath_km / coverage_pct / coverage_points`。

- 失败处理：见下方错误码表。

### `rs-service plan coverage`

```bash
rs-service plan coverage \
  --mode min_sats_for_coverage --aoi 330100 \
  --max-res 10 --target 90 --types optical,sar \
  --hours 72 --out plan.json
```

- 风险：write（写 `coverage_snapshot`）。
- 失败处理：退出码 2 为业务错误（如 `target_unreachable`），stdout 是 JSON；退出码 1 为环境问题。

### 渲染

```bash
python scripts/render.py --in plan.json --out /tmp/report.html
```

- 风险：write（只写 HTML 文件）。
- 失败处理：`plan.json` 不存在或 `ok=false` → 不要渲染，先把错误告诉用户。

## 错误码

| code | 含义 | 处理 |
| --- | --- | --- |
| `missing_params` | 缺必填参数 | 按 `missing` + `schema` 追问，**不要猜** |
| `aoi_not_found` | 范围不在库里 | 让用户给 adcode 或 WKT；本版本只有杭州市级边界 |
| `aoi_invalid` | WKT 不合法 / 未闭合 | 要求 `POLYGON((lon lat, …))`，首尾闭合 |
| `no_candidate_satellites` | 筛选后无星 | 放宽 `max_resolution_m` 或加传感器类型 |
| `aoi_out_of_zhejiang` | 质心不在浙江省界内 | 只支持浙江；让用户换 AOI |
| `target_unreachable` | 扩到上限仍不达标 | 报 `best_coverage_pct` / `best_p95_hours`，给建议 |
| `unsupported_mode` | 模式不在枚举 | 回 `allowed` |

## 输出口径（必须随结果一起说）

- 覆盖率与重访间隔是**估算值**；覆盖按 0.02°–0.2° 自适应网格统计，窄幅宽卫星会把网格压得更细。
- 重访看 **P95**，失败再看 `max_hours` 与 `under_covered_points`。
- 过境时间 ±1 分钟、足迹边缘 ±2–5 km、SGP4 在 LEO 约 1 km/天。
- 报告里保留 `algo_version`、`parser_version`、`grid.spacing_deg`。
