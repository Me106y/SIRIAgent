# pass-planning 命令清单

计算指定 AOI 的未来过境窗口、最高仰角、太阳高度与成像可行性。
默认 AOI 杭州（30.27N, 120.16E），默认窗口未来 24 h，可见门限 5°，光学成像另需最高仰角 ≥10° 且 TCA 太阳高度 >10°。

风险等级：`read` / `write` / `exec` / `network`；Phase 2 不拦截，"需审批"一律为否。

## 命令总表

| 命令 | 用途 | 风险 | 需审批 | 示例 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| `rs-service passes --sat-id <id> --hours 24` | 单星过境窗口 | read | 否 | `rs-service passes --sat-id 40118 --hours 24` | 空列表 → 放宽 `--min-elev` 或延长 `--hours`；先确认 TLE 未过期 |
| `rs-service passes --sat-id <id> --hours 24 --lat <lat> --lon <lon>` | 指定 AOI 过境 | read | 否 | `rs-service passes --sat-id 40118 --hours 48 --lat 39.90 --lon 116.40` | 经纬度越界 → 检查 WGS84 取值 |
| `rs-service status` | 查询前检查 TLE 新鲜度 | read | 否 | `rs-service status` | 同步 `abandoned` → 见 `tle-health/COMMANDS.md` |
| `mcp__rs-service__next_passes` | 过境窗口（MCP） | read | 否 | `{"sat_id": 40118, "hours": 24, "lat": 30.27, "lon": 120.16, "min_elev": 5}` | 同 CLI；`sat_id` 不存在返回 `ok:false` |

## 逐条说明

### `rs-service passes --sat-id 40118 --hours 24`

- 用途：返回 AOS/TCA/LOS、最高仰角、时长、太阳高度、是否可光学成像与 `accuracy_note`。
- 风险：read。
- 示例：
  ```bash
  rs-service passes --sat-id 40118 --hours 24 --lat 30.27 --lon 120.16 --min-elev 5
  ```
- 失败处理：
  - 返回空 `passes`：先确认 AOI 与窗口，再降 `--min-elev`（如 0° 看全部几何过境）；仍为空则查 `tle_age_hours`。
  - `satellite not found`：NORAD 不在 102 颗展示集，先 `list_satellites`。
  - TLE > 7 天：拒绝给出过境结论，提示先同步。

### `rs-service status`

- 用途：查 `tle_max_age_hours`、最近同步状态；过境查询前的必查项。
- 风险：read。
- 示例：`rs-service status`
- 失败处理：`last_run.status=abandoned` 时当天不再重试，按次日 03:00 自动恢复；不要连环 `sync`。

### MCP 等价调用

| MCP 工具 | 参数 | 返回 |
| --- | --- | --- |
| `mcp__rs-service__next_passes` | `sat_id`、`hours`、`lat`、`lon`、`min_elev` | 过境列表 + `tle_age_hours` + `accuracy_note` |

多颗星：先 `mcp__rs-service__list_satellites` 缩小范围，再逐颗 `next_passes`，避免一次全量 102 颗。

## 输出口径（必须随结果一起说）

- 时间按北京时间展示，UTC 值来自 `aos_utc`/`tca_utc`/`los_utc`。
- 过境时间误差约 ±1 分钟；足迹边缘 ±2–5 km；SGP4 在 LEO 约 1 km/天。
- 星历库当前只含 **102 颗 LEO**；9 颗 GEO 已于 2026-10-21 从库中移除（详见 `docs/PHASE2-REQUIREMENTS.md` §4.4.3），查询 GEO 会返回 `not_found`。
- 云量：Phase 2 暂未接入实时预报，`passes` 出参没有 `cloud_cover_pct`，不得声称"云量可用"。
- SAR 不看太阳高度；光学看最高仰角 ≥10° 且太阳高度 >10°。
- 与 MCP 结果不一致时，以 MCP/CLI 同源结果为准；不要用前端缓存数字反推。
