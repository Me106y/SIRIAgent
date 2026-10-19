# tle-health 命令清单

检查星历同步状态、TLE 年龄、失败重试与数据源健康度。
同步策略：每天 03:00 Asia/Shanghai，最多 1 次 + 3 次重试；失败当天停止，次日自动恢复；状态写入 `sync_state`。

风险等级：`read` / `write` / `exec` / `network`；Phase 2 不拦截，"需审批"一律为否。
**不要手动触发同步，除非用户明确要求**；诊断优先用 `status` 与 `sync_status`。

## 命令总表

| 命令 | 用途 | 风险 | 需审批 | 示例 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| `rs-service status` | 卫星数、TLE 年龄、最近同步 | read | 否 | `rs-service status` | DB 打不开 → 检查路径与服务单元 |
| `rs-service sync --dry-run` | 只抓取解析、不写库 | network | 否 | `rs-service sync --dry-run` | CelesTrak TLS EOF/超时 → 稍后重试或次日自动恢复 |
| `rs-service sync` | 正式同步并写库 | network + write | 否 | `rs-service sync` | 重试用尽 → `abandoned`，当天不再发起 |
| `rs-service sync --force` | 忽略熔断的排障同步 | network + write | 否 | `rs-service sync --force --max-retries 1` | 仅人工排障；失败仍按当天停止 |
| `mcp__rs-service__sync_status` | 同步状态（MCP） | read | 否 | `{}` | 无 `last_run` → 尚未同步，提示首日 03:00 |

## 逐条说明

### `rs-service status`

- 用途：输出 `satellites`、`tle_current`、`tle_max_age_hours`、最近一次 `sync_run` 与 `sync_state`。
- 风险：read。
- 示例：
  ```bash
  rs-service status
  ```
- 判断口径：
  - `tle_max_age_hours ≤ 72`：正常。
  - `72 < age ≤ 168`：可用，但必须标注"精度下降 / degraded"。
  - `> 168`（7 天）：拒绝给出过境/轨迹结论。

### `rs-service sync --dry-run`

- 用途：验证 CelesTrak 连通性与解析，不写库；适合排障。
- 风险：network（只读，不产生写入）。
- 示例：`rs-service sync --dry-run`
- 失败处理：
  - TLS EOF / 超时：CelesTrak 偶发不可达，按"当天停止、次日恢复"处理；不要连续重试。
  - HTTP 403/429：被限流，等待次日或降低频率。
  - 解析失败：保留上一版 `tle_current`，错误写入 `sync_item_error`。

### `rs-service sync`

- 用途：正式同步 111 颗 TLE/OMM，写入 `tle_record`、`tle_current`、`sync_run`、`sync_state`。
- 风险：network + write（写本地库）。
- 示例：`rs-service sync`
- 失败处理：
  - 最多 3 次重试，用尽后 `status=abandoned`、`consecutive_failures+1`；当天不再发起。
  - `HTTP 304 Not Modified` 不算失败（幂等）。
  - 数据库被占用时不要并发跑 sync；先停其它写入进程。

### `rs-service sync --force`

- 用途：忽略 `circuit_open_until` 的人工排障入口。
- 风险：network + write。
- 示例：`rs-service sync --force --max-retries 1`
- 失败处理：仍失败则回到"当天停止"；如实报告 `error_code`/`error_message`，不要反复 force。

### MCP 等价调用

| MCP 工具 | 参数 | 返回 |
| --- | --- | --- |
| `mcp__rs-service__sync_status` | — | 最近同步、重试次数、连续失败、`max_tle_age_hours`、`accuracy_note` |

## 故障对照表

| 现象 | 判断 | 处理 |
| --- | --- | --- |
| `max_tle_age_hours` > 72 | TLE 偏旧 | 结果标 `degraded`；≥ 7 天拒绝过境结论 |
| `last_run.status=abandoned` | 当日同步失败 | 当天不再重试；次日 03:00 自动恢复 |
| `consecutive_failures ≥ 3` | 连续多日失败 | 检查网络/代理与 CelesTrak 可达性，必要时 `--dry-run` 定位 |
| `circuit_open_until` 非空 | 熔断中 | 人工排障才用 `--force`，否则等待 |
| 查不到某颗星 | 不在 111 颗展示集 | 用 `list_satellites` 核对，不擅自扩大目录 |
