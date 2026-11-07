# 排障手册 — 错误现象与真正原因

> **用途**：界面报错、MCP/CLI 返回 `ok:false`、测试失败时，**先按现象查这里**，拿到证据再改代码；不要凭猜测动 skill、模型或参数。
> **边界**：需求与验收仍以 [`docs/PHASE2-REQUIREMENTS.md`](PHASE2-REQUIREMENTS.md) 为准，本文件只记排障，不写需求。
> **维护**：每修一个新错误补一条，格式见文末§9；修完的条目保留"真正原因"，不要只写"已修复"。

> **2026-11-05 变更**：`imaging-plan` 已不是 DSH skill，成图改由右栏“卫星成图”抽屉 + RS-Service 承担；本文涉及该 skill 的条目仅作历史参考。

## 0. 怎么用

1. 记下界面/日志里的**原始文本**（中文提示、错误码、异常名），在 §1 速查表里找关键词。
2. 按条目的"确认"命令取证据：会话日志、`journalctl`、`curl`、服务状态。
3. 对照"真正原因"判断是不是同一类；不是就新加一条，不要硬套。
4. 修完跑"回归"，把结果补在条目末尾；涉及服务的，确认**加载的是新代码**（重启）。

排查顺序（从外到内，逐层排除）：

```text
浏览器/SSE → Cloudflare 隧道 → gunicorn/Flask(app.py) → DSH SDK/node
→ MCP/REST(rs-service) → planner/DB → skill 文档
```

## 1. 速查表

| 现象（原文/关键词） | 先怀疑 | 条目 |
| --- | --- | --- |
| `连接中断：Error in input stream` | 隧道断连 / SSE 没有续读 | [E1](#e1-连接中断error-in-input-stream) |
| `user did not answer the question` | 回合被取消或断线，不是用户跳过 | [E2](#e2-user-did-not-answer-the-question) |
| `missing_params` 里有 `target_coverage_pct` | 模式判定 / MCP 进程还是旧代码 | [E3](#e3-missing_params-target_coverage_pct) |
| `409`、`上一轮仍在流式读取` | 上一回合没结束 | [E4](#e4-409上一轮仍在流式读取) |
| `turn_not_found`、`会话回合已过期` | 回合 TTL / 服务重启 | [E5](#e5-回合已过期turn_not_found) |
| `bad_params` | 参数越界（N、窗口、覆盖率） | [E6](#e6-bad_params) |
| 报告渲染失败、`FileNotFoundError` | 求解 `ok:false` 没落盘 | [E7](#e7-报告渲染失败) |
| 报告标题/数字与模式不符、未覆盖数偏小 | 模板口径 / 抽稀计数 | [E8](#e8-报告结论或数字不对) |
| `提交失败，请重试`、`提交失败：网络中断` | 答复 POST 被隧道打断 / 非幂等 | [E11](#e11-提交失败请重试) |
| 光学覆盖出现在 23:xx / 夜间，覆盖率异常高 | 缺太阳高度门限 | [E12](#e12-光学覆盖里出现夜间过境) |
| 给定 N 颗也报 `target_unreachable`、`best_coverage_pct=0.0` | 窗口内云量/太阳过滤后无可用访问 | [E14](#e14-给定-n-颗也报-target_unreachablebest_coverage_pct00) |
| 报告链接点击报错，但文件确实存在 | linkify 二次嵌套 / href 不是 /api/files | [E13](#e13-报告链接点击报错文件其实存在) |
| 报告“达标面积”恒为 `0.0%`，时间覆盖率只有零点几 | task1 面积口径被 90% 单格时间阈值顶掉 | [E15](#e15-报告达标面积恒为-00) |
| `rs-service: command not found`、`uv: command not found` | 不在 PATH | [E9](#e9-command-not-found) |
| `530`、`1033`、`502`、`503` | 隧道 / 本机服务 | [E10](#e10-隧道与网关错误) |

## E1. 连接中断：Error in input stream

**现象**

- 前端提示：`连接中断：Error in input stream。已保留已收到的内容；可以直接重试。`
- 会话日志最后一条是 `tool/call`（通常是 `ask_user_question`），后面没有 `tool/result`/`step/end`。
- 过一会儿模型又对同一个问题再问一次，但浏览器什么也收不到。

**首次发现**：2026-10-20 19:57，会话 `siriagent-ed627662-d66f-4ba6-9870-8f96f09b586f`（后缀 `f09b586f`）。

**确认**

```bash
# 1) 隧道是否在抖：19:57:22 / 19:57:24 / 19:57:36 连续断连（下列命令输出 UTC，+8 才是本地时间）
journalctl --user -u cloudflared --since '2026-10-20 19:50' --until '2026-10-20 20:05' \
  | grep -E 'Lost connection|ended abruptly|TLS handshake'

# 2) 会话尾部：最后一条是不是没有结果的 tool/call
S=~/.dsh-siriagent/sessions/--home-siri-~684C~9762-SIRIAgent--/siriagent-ed627662-d66f-4ba6-9870-8f96f09b586f
zstd -dc "$S/session.v4.jsonl.zstd" | jq -r 'select(.time != null) | "\(.time/1000|todate) \(.type)"' | tail -15
```

**真正原因**（两层，缺一不可）

1. **外部**：Cloudflare 隧道抖动（WiFi/热点切换、边缘 TLS 超时）。浏览器 `fetch` 读 SSE 抛出的原文就是 `Error in input stream`——这是**浏览器/中间层的读错误**，不是 DSH 的业务错误。
2. **代码**：旧实现把"一条 SSE = 一轮对话"：
   - `app.py` 的 SSE `generate()` 在 `finally` 里调 `cancel_questions()`，把**断线**误判成"用户没回答"；
   - 只取消问题、**不停回合**，模型继续跑；19:57:49 返回 `Error: user did not answer the question`，19:57:52 又对着已断开的流重问，回合挂住单轮锁；
   - 前端只有一次性 `fetch`，断了就结束，不能续读。

**修复**

- 回合化：`POST /api/chat/turns` 建回合，`GET /api/chat/turns/{id}/events?cursor=N` 续读；事件带 `id:`，支持 `Last-Event-ID`。
- 断线只 `detach`，**不取消问题**；无人续读 180 s 回收（`DSH_TURN_ORPHAN_GRACE`），回合保留 900 s（`DSH_TURN_TTL`）。
- 前端用同一 `turn_id` + 游标自动重连；`closed` 事件表示真正结束。
- 代码：`sdk_runtime.py` 的 `Turn`/`start`/`attach`/watchdog，`app.py` 的 `/api/chat/turns`，`web/src/api.ts` 的 `streamTurn`。

**回归**

1. 发一句会触发追问的话（如"请使用 imaging-plan 技能，做一份编成方案"），等提问卡片出现；
2. 不回答，直接断开页面/网络 20 s，再回来：应看到"正在重连…"，问题仍可提交；
3. 也可用游标验证补发（把 `<id>` 换成当前 `turn_id`）：

```bash
curl -sN 'http://127.0.0.1:8000/api/chat/turns/<id>/events?cursor=0' | tail -3
# 期望：续读到已有事件；断线期间不应出现 error，也不应出现 "user did not answer"
```

**注意**：再看到这句话，先查隧道和 `turn_id` 续读，**不要**去改模型、改 skill 参数或加超时。

## E2. user did not answer the question

**现象**：`ask_user_question` 的 tool result 是 `Error: user did not answer the question`；模型随后可能原样重问。

**真正原因**

- **不是**用户点了"跳过"（跳过会返回 `answers:[{id,selected:[]}]`）。
- 旧版：SSE 断线 → `cancel_questions()` → 以这个错误结案（见 E1）。
- 新版：只有**显式取消**（`/api/chat/cancel`）或**回合被回收**（180 s 无人续读）才会出现。

**确认**

```bash
# 回合是否已关闭/被取消
curl -s -m 5 "http://127.0.0.1:8000/api/chat/turns/<turn_id>/events?cursor=0" | tail -5
# 看是否有 notice "已取消本轮"
```

**正确处理**：不要立刻原样重问。先把"已经拿到哪些参数、还差哪一个"说清楚，等用户回复；规则见 `skills/imaging-plan/SKILL.md` 的"用户没回答 / 提问超时怎么办"。

## E3. missing_params: target_coverage_pct

**现象**：`max_coverage_for_n` / `min_sats_for_revisit` 调用 `plan_coverage` 返回：

```json
{"ok": false, "error": "missing_params", "missing": ["target_coverage_pct"]}
```

**两个真因，都要查**

1. **语义错**（旧代码）：`planner.solve` 无条件要求覆盖率。给定 N 颗时覆盖率是**输出**，重访模式也不该要它。
2. **进程旧**：改了 `RS-Service` 但只重启了 `rs-service-api`，**没重启 `rs-service-mcp`**，MCP 跑的还是旧代码。2026-10-20 20:08 的端到端就撞到这一条：模型发现 MCP 仍报旧错，只能改走 CLI。

**确认**

```bash
# 文件改动时间 vs MCP 进程启动时间
stat -c '%y %n' ~/桌面/RS-Service/src/rs_service/astro/planner.py
systemctl --user show rs-service-mcp -p ActiveEnterTimestamp
# 直接按模式验证：N 模式不带 target 应成功（ok=true）
~/桌面/RS-Service/.venv/bin/rs-service plan coverage \
  --mode max_coverage_for_n --aoi 330900 --max-res 10 --n-sats 2 --hours 24 --types optical --no-persist \
  | jq '.ok'
```

**修复**

- `missing_params` 按模式判定：只有 `min_sats_for_coverage` 必填 `target_coverage_pct`；
- 给定 N 颗的 `target_coverage_pct` 即使传了也忽略（不判"未达标"）；
- 改完 `systemctl --user restart rs-service-mcp rs-service-api`。

**回归**：`cd ~/桌面/RS-Service && uv run pytest`；再调一次 MCP 的 `plan_coverage`（`max_coverage_for_n`，不带 target）。

## E4. 409：上一轮仍在流式读取

**现象**：`POST /api/chat/turns` 返回 `409 {"busy": true, "error": "上一轮仍在流式读取…"}`。

**真正原因**：上一回合还没结束（仍有 SSE 订阅者，或刚断线还在 180 s 宽限期内）。旧前端遇到 409 会回退到 `/api/chat`，**另起一个 headless 进程**，等于同一句话跑两遍。

**处理**

- 等这一轮结束，或点"停止"（`/api/chat/cancel`）；
- 180 s 无人续读后自动回收；
- 前端已区分 `TurnBusyError`：只提示，不回退、不重跑。

## E5. 回合已过期（turn_not_found）

**现象**：续读返回 `404 {"error": "turn_not_found"}`；前端提示"会话回合已过期"。

**真正原因**：回合默认只保留 900 s（`DSH_TURN_TTL`），或服务重启后内存里的回合没了；浏览器还拿着旧 `turn_id`。

**处理**：重新发一句即可（不是断线，不需要改代码）。要更长的重连窗口就调大 `DSH_TURN_TTL`。

## E6. bad_params

**现象**：`{"ok": false, "error": "bad_params", "field": "n_sats", "allowed": [1, 20]}`。

**真正原因**：参数越界——`n_sats` 不在 1–20、`hours` 不在 1–336、覆盖率不在 1–100、重访上限 ≤0。
旧版没有这个错误码，会一路跑到 `target_unreachable`，看起来像"算不出来"，其实是参数错。

**处理**：按 `field` + `allowed` 让用户改值，不要夹带默认值硬跑。

## E7. 报告渲染失败

**现象**：`render.sh`/`render.py` 报 `FileNotFoundError`、`JSONDecodeError`、`NameError`/`KeyError`（例如 `name 'none' is not defined`）。

**真正原因**（按概率）

1. 求解返回 `ok:false`（如 `target_unreachable`），CLI **不会写** `--out` 文件，后续却去渲染它；
2. 只拿到 MCP 的结果文本，没落成文件就调用 `render.sh`；
3. 用旧 JSON（缺 `mode`/`headline`/`uncovered_point_count` 等新字段）配新模板；
4. 渲染器代码把"空值"写成 Jinja 的 `none`（Python 里必须写 `None`）——2026-10-20 实际踩过一次。

**确认**

```bash
jq '.ok' reports/<名称>.json          # 必须是 true
ls -l reports/<名称>.json             # 存在且非空
```

**修复**：先解决求解错误再渲染；出报告固定走 CLI `--out`（同一组参数只解一次）；旧 JSON 重新求一次。渲染器只接受 `{ok:true, data:{...}}`。

## E8. 报告结论或数字不对

**现象（两种，2026-10-20 都出现过）**

1. 给定 3 颗星的报告标题写成"覆盖 90%，需要 3 颗星"——它把覆盖率当成输入了；
2. 报告写"有 577 个格点从未被覆盖"，但 `plan.coverage_pct=80.9%`、6033 个格点，真实未覆盖应是 **1155**。

**真正原因**

1. 模板标题写死为"覆盖率模式"，没有按 `mode` 分支；
2. 用 `uncovered_points`（给地图**抽稀**过的坐标）来数个数，抽稀步长 2 就直接少一半。

**修复**

- `render.py` 按 `mode` 生成标题与达标结论；
- `plan_coverage` 增加 `uncovered_point_count`（未抽稀），报告统计用它；`uncovered_points` 只给地图画点。

**回归**

```bash
# 覆盖率的自洽检查：1 - uncovered/grid.points ≈ coverage_pct
jq '{cov:.data.plan.coverage_pct, uncovered:.data.plan.uncovered_point_count, grid:.data.grid.points}' reports/<名称>.json
```

## E9. command not found

**现象**：`rs-service: command not found`、`uv: command not found`。

**真正原因**：CLI 没进 PATH（`rs-service` 只在 `~/桌面/RS-Service/.venv/bin/`；`uv` 在 `~/.local/bin/`）。模型可能先试 `uv run rs-service`，失败后再换路径，浪费一轮，甚至重复求解。

**处理**：固定绝对路径。

```bash
~/桌面/RS-Service/.venv/bin/rs-service plan coverage ...   # 不要依赖 PATH
```

## E10. 隧道与网关错误

**现象**：Cloudflare `530`/`1033`，或本机 `502`/`503`。

**真正原因**

- `1033`/`530`：边缘找不到在线 tunnel（4 条 HA 连接全掉），**不是应用 5xx**；热点休眠/切换后常见，通常 10–60 s 自愈。
- `502`：SIRIAgent 反代到 RS-Service（8766）失败；`503`：本机服务没起或 DSH 不可用。

**确认**（详见 README 的"Cloudflare 隧道 1033 排障"）

```bash
curl -fsS http://127.0.0.1:20241/metrics | grep cloudflared_tunnel_ha_connections
ss -tlnp | grep -E ':(8000|8765|8766) '
curl -s http://127.0.0.1:8000/api/health
systemctl --user status siriagent-demo rs-service-api rs-service-mcp
```

**处理**：`systemctl --user start cloudflared-healthcheck.service` 手动跑一次；服务没起就按 §6 的重启命令起。隧道本身不稳时，应用层只能保证"短抖动可续读"（E1），长时间断网仍需重发。

## E11. 提交失败，请重试

**现象**：问题卡片下方出现"提交失败，请重试"（新版文案："提交失败：网络中断，请再试一次"）；选项已经选好，但答复没有生效。会话日志里这个 `ask_user_question` **只有 `tool/call`、没有 `tool/result`**。

**首次发现**：2026-10-20 20:44，会话 `siriagent-a0334bc4-bf05-438b-8b07-056b1145cee0`（截图中的 `1145cee0`）。

**真正原因**

1. 答复 POST `/api/question/answer` 和 SSE 走同一条抖动隧道；隧道中断时浏览器拿到的不是 200（常见 502/504），旧前端把它当**最终失败**，不重试；
2. 服务端的问题仍在等待（没有 `tool/result`），所以既不是"用户没提交"，也不是"问题失效"；
3. 如果请求其实已到服务端、只是**响应丢了**，旧服务端对重复 `callId` 返回 `ok:false`，前端会永远显示失败、无法自愈。

**确认**

```bash
# 1) 会话里该 ask_user_question 是否有 tool/result
S=~/.dsh-siriagent/sessions/--home-siri-~684C~9762-SIRIAgent--/<会话目录>
zstd -dc "$S/session.v4.jsonl.zstd" | jq -r 'select(.type=="tool/call") | .data.name' | tail -3

# 2) 服务端是否记录到答复；同一时刻隧道是否中断
journalctl --user -u siriagent-demo -n 50 --no-pager | grep -E "answer (ok|miss)|turn (start|resume|abort)"
journalctl --user -u cloudflared --since '10 min ago' | grep -E "ended abruptly|context canceled"
```

**修复**

- `manager.answer` 按 `callId` **幂等**（已答复表保留 900 s）：重复提交返回 `true`，响应丢失后的重试也能自愈；
- 前端 `answerQuestion` 对网络错误 / 5xx / 408 / 429 **自动重试 5 次**（单次 10 s 超时，最坏约 1 分钟）；
- 失败文案区分"网络中断（可重试）"与"问题已失效（本轮结束，请重发）"；
- 后端记录 `answer ok/miss`、`turn start/resume/abort` 日志，便于下次直接取证。

**回归**

```bash
# 同一个 callId 连续提交两次：都应 ok:true，且只推进一个问题
curl -s -X POST http://127.0.0.1:8000/api/question/answer \
  -H 'Content-Type: application/json' \
  -d '{"callId":"<callId>","answers":[{"id":"mode","selected":["<label>"]}]}'
```

**注意**：看到"提交失败"先看会话里有没有 `tool/result`，再决定重试还是重发；**不要直接重启服务**（会丢掉当前回合）。
前端是 SPA，修复后需要**刷新一次页面**才会加载带重试逻辑的新 bundle；刷新前打开的旧标签页仍会直接报失败。

## E12. 光学覆盖里出现夜间过境

**现象**：报告覆盖图在 23:xx 仍显示大片"光学"覆盖（时间轴如 `10-27 23:26 · 100%`）；1 m 光学两颗星就报 100%，与常识不符。

**首次发现**：2026-10-21 10:24 的杭州 1 m / 90% 报告。Jilin-1 Kuanfu 02A 的两段"覆盖"在 15:34Z / 15:26Z（北京 23:34 / 23:26），杭州太阳高度 **-72°**。

**确认**

```bash
# 同一过境的可用性判定：夜间光学应为 false
python3 - <<'PY'
from datetime import datetime, UTC
from rs_service.astro.solar import sun_altitude_deg
print(sun_altitude_deg(datetime(2026,10,27,15,26,tzinfo=UTC), 30.28, 120.15))
PY
# 过境接口里该时刻的 optical_imaging_ok / sun_elev_deg
# MCP next_passes 或 passes.find_passes 查看
```

**真正原因**：`planner.solve` 只做了云量过滤（`_apply_cloud`），**从未调用 `sun_altitude_deg`**；白天过境被 95–100% 云量剔除，夜间低云过境反而留下，于是"夜间光学"成了唯一可用访问，覆盖率被高估。

**修复**

- `_apply_sun`：optical / hyperspectral 的每个 hit 按"该时刻 + 该格点"的太阳高度过滤，门限取 `settings.optical_sun_min_deg`（默认 10°，环境变量 `RS_OPTICAL_SUN_MIN_DEG`）；
- `ALGO_VERSION` 升到 `plan-0.2`；notes 写明"夜间过境不计入覆盖"；
- MCP 增 `optical_sun_min_deg`，CLI 增 `--sun-min`；
- 修复后：1 m 光学、90%、14 天上限 **78.27%**（不可达）；同 AOI/窗口的 5 m 光学 90% 需 **5 颗**。

**回归**：`uv run pytest tests/test_planner_filters.py`（夜间 hit 必须被剔除）；重算报告看时间轴不再出现 23:xx 的光学覆盖。

**注意**：不要用"关掉云量过滤"或"降低目标"来掩盖夜间覆盖；先看时间轴时刻的太阳高度。

## E13. 报告链接点击报错（文件其实存在）

**现象**：Agent 回复里的 `reports/x.html` 看起来是链接，点开却 404/403/错误页；SSH 里 `ls` 文件确实在 `reports/`。

**确认**

```bash
# 文件接口本身是好的（绝对路径与 reports/ 相对路径都应 200）
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:8000/api/files?path=%2Fhome%2Fsiri%2F%E6%A1%8C%E9%9D%A2%2FSIRIAgent%2Freports%2Fningbo-optical-5m-90pct.html'
# 看前端 linkify 的输出：是否出现 [[...]...](...%5D(...)) 这类嵌套
```

**真正原因**：`Markdown.tsx` 的 linkify 对**已经是 markdown 链接**的本地路径又跑了一遍裸路径替换：
`[reports/x.html](/home/.../x.html)` 被改成嵌套的 `[[x.html](/api/files?...%5D(...))`，
href 里混进了 `]`/`(`；同时模型给的 href 是 `/home/...`，浏览器不会自动走 `/api/files`。

**修复**：抽出 `web/src/lib/fileLinks.ts`——先把已有本地链接的目标改写成 `/api/files?path=...`，
再用占位符保护整段链接，最后才对裸路径/行内代码做替换；绝对与相对路径都交给 `/api/files` 解析。

**回归**：`node` 单测 abs-link / rel-link / bare / code / external / image 六种输入；构建后点报告链接应 200。

**注意**：不要只改 `/api/files` 或把报告挪到 `static/`；问题在前端拼接。

## E14. 给定 N 颗也报 target_unreachable、best_coverage_pct=0.0

**现象**：`rs-service plan coverage --mode max_coverage_for_n`（或 `plan_coverage`）返回
`{"ok": false, "error": "target_unreachable", "best_coverage_pct": 0.0}`；CLI 不落盘，报告无法渲染。
首次发现：2026-10-21 14:10，温州 `330300` / 光学 / 5 m / 3 颗 / 24 h。

**确认**：

```bash
# 逐星看 raw → sun → cloud 的保留数；某个计数归零就能定位是哪层过滤
cd ~/桌面/RS-Service && .venv/bin/python - <<'PY'
from datetime import UTC, datetime, timedelta
from rs_service.db.session import session_scope
from rs_service.astro import coverage as cv, cloud
from rs_service.astro.planner import _candidates, _plan_grid, _apply_sun, _apply_cloud, resolve_aoi
from rs_service.astro.propagate import satellite_from_omm

t0 = datetime.now(UTC)
with session_scope() as s:
    aoi = resolve_aoi(s, "330300")
    cands = _candidates(s, 5.0, ["optical"])
    grid = _plan_grid(aoi["rings"], aoi["area_km2"], cands)
    series = cloud.series_for(float(grid.lat.mean()), float(grid.lon.mean()), t0, 24)
    print("cloud min/max", min(v for _, v in series), max(v for _, v in series))
    for c in cands:
        sat = satellite_from_omm(c.omm)
        c.mask, c.hits = cv.satellite_coverage(sat, grid, t0, t0 + timedelta(hours=24), c.swath_km)
        raw = sum(len(x) for x in (c.hits or []))
        _apply_sun(c, grid, t0, 10.0)
        sun = sum(len(x) for x in (c.hits or []))
        _apply_cloud(c, series, t0, 70.0)
        if raw:
            print(c.name, raw, sun, sum(len(x) for x in (c.hits or [])))
PY
```

**真正原因**：不是求解器坏。`_greedy` 在太阳/云量过滤后没有任何命中（`chosen` 为空）就回 0。
温州该 24 h 窗口逐小时云量 98–100%，仅有的三次白天过境（Kuanfu 02A / HJ-2A / GF-2）全被
`_apply_cloud` 剔除；72 h 仍为 0，168 h 放晴后 3 颗可到 100%。关云量过滤的几何上限是 94.57%，
但那是编成理论上限，不是业务可用覆盖。

**处理**：不要关云量过滤硬凑覆盖率。按"延长窗口（先问用户）/ 增加 SAR / 明确标注只出几何上限"
三选一，并把实际窗口写进结论。

**回归**：同参数改成 `--hours 168` 应返回 `ok:true`、`coverage_pct=100.0`，并正常落盘渲染。

**注意**：`--no-cloud-filter` 只用于定位"几何可达性"，不能当业务方案；
给定 N 颗模式里的 `target_unreachable` 不等于"目标定得太高"。

## E15. 报告“达标面积”恒为 0.0%

**现象**：task1（最少星达到覆盖率）报告首屏显示“达标面积（目标 90%）0.0%”，
旁边的“时间覆盖率”只有 0.5% 左右；换卫星、换窗口仍是 0。抽屉里的结果卡同样是 0.0%。

**确认**

```bash
# 1) 看这次求解用的单格时间阈值；90 就是踩到此条
jq '.selection.recommended_result.temporal_coverage_target_pct,
    .summary_cards.qualified_area_pct,
    .summary_cards.city_mean_temporal_coverage_pct' reports/imaging-plan/latest/plan.json

# 2) 看逐格时间覆盖率的上限（LEO 72 h 通常 <1%）
jq '[.coverage_map.geojson.features[].properties.temporal_coverage_pct] | max' \
  reports/imaging-plan/latest/plan.json
```

**真正原因**：task1 是**面积口径**——目标区域至少成像一次（内部时间阈值 0.001%），
用面积加权算“达标面积”；单格时间覆盖率 ≥90% 是 task3 的门槛，不是 task1 的。
LEO 卫星在 72 h 内对单个 5 km 网格的累计覆盖通常不到 1%，90% 在物理上不可达，
所以 `qualified_area_pct` 必然是 0。让 task1 改回面积口径的修复提交在
`agent/plan-tle-auto-e547316` 分支上、PR #7 合并之后才推上去，没进 main，
于是旧行为又回来了。

**修复**：`plan_api.PlanCreate.to_spec()` 对 task1 固定 0.001% 时间阈值、面积目标
默认 90%（旧客户端传的 `temporal_coverage_target_pct` 直接忽略）；
`adapter._annotate_result()` 对 task1 不再暴露内部时间阈值，只返回 `area_pct`；
报告与抽屉改为面积口径，task1 不再显示时间覆盖率与薄弱区。

**回归**

```bash
# 提交 task1 后：targets.temporal_coverage_pct 为 null，area_pct=90
curl -s http://127.0.0.1:8766/api/v1/plans/<job_id> | \
  jq '.result.targets, .result.summary_cards.qualified_area_pct'
# 杭州 72 h、默认 90% 面积目标应得到 nonzero（全城至少成像一次时 100%）
```

**注意**：不要让用户把“目标覆盖率”调到 10% 来凑非 0——那会改变 task1 的含义，
而且结果仍然不是面积口径。单格时间覆盖率只适用于 task3。

## 新增条目模板

```markdown
## E<n>. <一句话现象>

**现象**：界面/日志原文（可复制），首次发现的时间与会话 id。
**确认**：能复现/取证的 1–3 条命令。
**真正原因**：外部因素 + 代码因素分开写；写清楚"为什么会被误判"。
**修复**：改了哪个文件/接口/配置；是否需要重启服务。
**回归**：一条能证明修好了的命令或步骤。
**注意**：再遇到时不要做什么（防止误修）。
```

## 附：常用排障命令

```bash
# 服务状态与最近日志
systemctl --user status siriagent-demo rs-service-api rs-service-mcp
journalctl --user -u siriagent-demo -n 100 --no-pager
journalctl --user -u rs-service-mcp -n 100 --no-pager

# 会话记录（zstd 压缩的 JSONL）
S=$(ls -dt ~/.dsh-siriagent/sessions/--home-siri-~684C~9762-SIRIAgent--/*/ | head -1)
zstd -dc "$S/session.v4.jsonl.zstd" | jq -c 'select(.type|test("user/message|assistant/message|tool/call|tool/result"))' | tail -20

# 当前回合事件（不带 cursor 从头补发）
curl -sN 'http://127.0.0.1:8000/api/chat/turns/<turn_id>/events?cursor=0'

# 健康检查
curl -s http://127.0.0.1:8000/api/health | jq '{ok,dsh_ready,frontend}'
curl -s http://127.0.0.1:8766/api/v1/health | jq '{ok,satellites}'

# 测试与构建
cd ~/桌面/RS-Service && uv run pytest
cd ~/桌面/SIRIAgent/web && pnpm build
```
