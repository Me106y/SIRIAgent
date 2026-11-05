# ephemeris-query 命令清单

查询单星星下点、轨迹、轨道高度、TLE 新鲜度与载荷参数。
CLI 是唯一实现，MCP 是薄包装；浏览器永不直连 `127.0.0.1:8766`，MCP 工具名统一带 `mcp__rs-service__` 前缀。

风险等级：`read`（只读）、`write`（写本地库/文件）、`exec`（执行外部命令）、`network`（外网请求）。
Phase 2 不做审批拦截（§2.2），"需审批"一律为否。

## 命令总表

| 命令 | 用途 | 风险 | 需审批 | 示例 | 失败处理 |
| --- | --- | --- | --- | --- | --- |
| `rs-service position --sat-id <id>` | 单星当前星下点 | read | 否 | `rs-service position --sat-id 40118` | `satellite not found` → 先用 `list_satellites` 核对 NORAD，不要猜 |
| `rs-service track --sat-id <id> --hours 2 --step 60` | 单星星下点轨迹 | read | 否 | `rs-service track --sat-id 40118 --hours 2 --step 60` | TLE 超 7 天会拒绝；先跑 `rs-service status` |
| `rs-service status` | 卫星/TLE/同步概览 | read | 否 | `rs-service status` | 数据库不可读 → 检查 `~/.local/share/rs-service/rs.db` 与服务单元 |
| `mcp__rs-service__list_satellites` | 目录筛选 | read | 否 | `{"category": "civil", "orbit": "LEO"}` | 空结果 → 放宽筛选条件 |
| `mcp__rs-service__get_satellite` | 目录 + 传感器 + TLE 元数据 | read | 否 | `{"sat_id": 40118}` | 不存在 → 回退 `list_satellites` |
| `mcp__rs-service__current_position` | 当前星下点（MCP） | read | 否 | `{"sat_id": 40118}` | 同 CLI `position` |
| `mcp__rs-service__list_positions` | 全展示集当前位置 | read | 否 | `{}` | 空 → 检查 TLE 是否已同步 |
| `mcp__rs-service__ground_track` | 星下点轨迹（MCP） | read | 否 | `{"sat_id": 40118, "hours": 2, "step_s": 60}` | `hours` 过大 → 降窗口或增大 `step_s` |

## 逐条说明

### `rs-service position --sat-id 40118`

- 用途：返回当前时刻的 WGS84 星下点、高度、TLE 年龄与 `accuracy_note`。
- 风险：read。
- 示例：`rs-service position --sat-id 40118`
- 失败处理：
  - `satellite not found`：NORAD 不在默认展示集；先 `rs-service status` 看总数，再用 MCP `list_satellites` 或前端目录确认。
  - TLE 年龄 > 72 h：结果仍返回，但需向用户标注"精度下降"。

### `rs-service track --sat-id 40118 --hours 2 --step 60`

- 用途：未来 N 小时星下点序列（经度已 unwrap），用于轨迹图。
- 风险：read。
- 示例：`rs-service track --sat-id 40118 --hours 2 --step 60`
- 失败处理：
  - TLE > 7 天：按 §4.6 拒绝过境/轨迹结论，提示先同步。
  - 点数过多：`hours` 与 `step` 的比值建议 ≤ 300 点。

### MCP 等价调用

| MCP 工具 | 参数 | 返回 |
| --- | --- | --- |
| `mcp__rs-service__list_satellites` | `category?`、`orbit?` | 卫星摘要列表 |
| `mcp__rs-service__get_satellite` | `sat_id` | 目录 + 传感器 + TLE 元数据 |
| `mcp__rs-service__current_position` | `sat_id` | 当前星下点 + `accuracy_note` |
| `mcp__rs-service__list_positions` | — | 102 颗当前位置 |
| `mcp__rs-service__ground_track` | `sat_id`、`hours`、`step_s` | 星下点序列 |

## 通用约束

- 所有输出必须带 `accuracy_note`；TLE 年龄 > 72 h 标 `degraded`，> 7 天拒绝过境/轨迹结论。
- 不要为 102 颗星逐颗拉轨迹；轨迹只对选中星按需算。
- 查询前先确认 NORAD，禁止凭名称猜 ID（历史上有 41335/43437/44312 错配）。
