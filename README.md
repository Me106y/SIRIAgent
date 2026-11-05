# SIRIAgent

面向遥感任务的双栏平台：左 1/3 星历可视化，右 2/3 Agent。它**不修改** `SIRI-Agent` 项目，只在自己的目录里运行。

> 需求范围、优先级与验收标准见 [`docs/PHASE2-REQUIREMENTS.md`](docs/PHASE2-REQUIREMENTS.md)（[HTML 版](docs/PHASE2-REQUIREMENTS.html)，由 `scripts/build_requirements_html.py` 生成）。后续需求变更只改该文档，不再写入 `SIRI-Agent`。
> 遇到报错先查 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md)（现象 → 真正原因 → 确认命令 → 回归）。
>
> Agent 在本仓库的工作约定见 [`AGENTS.md`](AGENTS.md)。

![SIRIAgent 前端：左 1/3 星历、右 2/3 Agent](docs/assets/frontend.png)

运行中逐条显示思考与工具行，思考行带一行预览，`bash` 显示执行命令；回合结束后自动折叠成「工作步骤 · N 步 · X s」，点击可展开完整时间线。

![工具调用与思考态](docs/assets/chat.png)

点「杭州」飞到杭州，并用 WGS84 市界多边形让杭州边界闪烁约 6 秒：

![杭州定位](docs/assets/hangzhou.png)


## 它是什么

```text
浏览器
  │  https://siriagent.dpdns.org（Cloudflare Access 保护）
  ▼
Cloudflare Tunnel
  ▼
127.0.0.1:8000  gunicorn + Flask（本项目）
  ├─ /            → web/dist（React + Cesium）
  ├─ /api/rs/*    → 127.0.0.1:8766（RS-Service REST）
  ├─ /api/bootstrap → 首屏聚合：目录 + 星历 + 余额（一次往返）
  ├─ /api/chat/turns → 开一轮对话，返回 turn_id（事件按游标续读）
  ├─ /api/chat/turns/{id}/events?cursor=N → SSE：工具卡 + 文本（断线可续读）
  ├─ /api/balance → DeepSeek API 余额（60 s 缓存）
  ├─ /api/skills  → skills/*/SKILL.md
  └─ /api/chat    → 回退：dsh --profile headless --json
  ▼
DSH agent（DeepSeek Harness） + RS-Service（星历/MCP）
```

- 前端：`web/`，React 19 + Vite + TypeScript + CesiumJS；构建产物 `web/dist/` 由 Flask 托管。
- 历史页面：`static/index.html`，仅在 `web/dist` 不存在时兜底。
- 后端：`app.py`，Flask；`/api/rs/*` 反代到本机 RS-Service，浏览器不直连 8766。
- 首屏：Cesium 运行时按需加载；目录先读 localStorage 再后台刷新；`/api/bootstrap` 合并目录/星历/余额。目录类接口带 `ETag` 与 `Cache-Control`，位置/过境保持 `no-store`。
- 问答组件：`ask_user_question` 走 DSH SDK 问答通道，前端渲染单选/多选卡片并回传 `/api/question/answer`；DSH 侧补丁见 `deploy/dsh-sdk-questions.patch`。
- 文件打开：模型输出里的 `reports/*.html` 等路径会自动变成链接，经 `/api/files` 打开；只允许项目目录内文件（目录穿越返回 403）。
- 报告导出：imaging-plan 生成的 HTML 报告右上角有“导出 PDF”，调用浏览器打印，选择“另存为 PDF”即可；旁边可切换深/浅主题（记住选择），PDF 强制浅色。报告分“卫星构成 / 覆盖与回放 / 推荐计划 / 口径与精度”，推荐计划逐星给出 CelesTrak 来源与必选/可选原因。
- 静态资源：`/assets/*` 一年 `immutable`，`/cesium/*` 7 天；首次访问后浏览器不再重复下载 Cesium。
- Service Worker（`web/public/sw.js`）：`/cesium/*`、`/assets/*` 进 Cache Storage，首访后离线也能开；升级 Cesium 时改 `VERSION`。
- DSH：`dsh --profile headless`，每次消息一次运行；用 `--session-id` 续聊。
- 顶栏余额：`/api/balance` 读取本机 DSH 凭据并查询 DeepSeek API 余额（60 s 缓存）。
- 输入框：`/` 打开技能菜单（`skills/*/SKILL.md`），Enter 发送，Shift+Enter 换行。
- 端口：`127.0.0.1:8000`，与原来的平台一致，Tunnel 不需要改。

## 前端开发

```bash
cd "/home/siri/桌面/SIRIAgent/web"
pnpm install
pnpm dev          # 开发服务器 5173，/api 代理到 8000
pnpm build        # 产物写入 web/dist，Flask 自动托管
```

前端依赖 RS-Service 的 REST（`127.0.0.1:8766`）。星历 5 s 轮询带 15 s 超时、单飞与一次重试；后台轮询失败只保留上一帧数据，不显示错误横幅。相机控制：「聚焦」飞到选中星足迹，「杭州」飞到杭州并让市界多边形闪烁约 6 秒。时间轴 UI 暂不启用，后端 `at` 参数保留。启动顺序：

```bash
systemctl --user start rs-service-api.service   # 星历服务
systemctl --user restart siriagent-demo          # 前端 + DSH
```

## SDK 流式

问答走“回合 + 游标续读”：`POST /api/chat/turns` 先建回合拿 `turn_id`，再用
`GET /api/chat/turns/{turn_id}/events?cursor=N` 读 SSE（`tool_call` / `tool_result` /
`reasoning` / `text` / `question` / `done` / `closed`）。服务端把事件记在回合里，每 10 s 发心跳；
隧道断线只断开这一条连接，回合继续跑，前端用同一个 `turn_id` + 最后游标重连续读，
未回答的问题不会被当成“用户没回答”。无人续读的回合 180 s 后回收。
文本在回合结束时整块返回（当前 SDK 版本不吐 token delta）。SDK 起不来时前端才回退到
`/api/chat`（`dsh --profile headless --json`）；已经开始的回合不会回退，避免重复跑。

本机安装（SDK 不在仓库内）：

```bash
~/.local/bin/uv pip install --python .venv/bin/python pydantic
~/.local/bin/uv pip install --python .venv/bin/python --no-deps -e \
  /home/siri/Documents/Qoder/2026-10-18/146d1f32/deepseek-harness/python/sdk
```

- `SDK_DSH_HOME` 默认 `~/.dsh-siriagent`，首次运行会从 `~/.dsh/.credentials.yaml` 复制凭据。
- 模型默认 `deepseek-official / deepseek-flash`，可用 `DSH_PROVIDER` / `DSH_MODEL` 覆盖。
- 同一时刻只跑一轮（进程内锁）；多人并发要等 Phase 3 的会话池。

## 运行

```bash
cd "/home/siri/桌面/SIRIAgent"

# 一次性建环境（本机已用 uv 装好 Python 3.12）
~/.local/bin/uv venv --python 3.12 .venv
~/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt

# 前台启动
.venv/bin/gunicorn -w 1 --threads 4 --timeout 0 -b 127.0.0.1:8000 app:app
```

打开 <http://127.0.0.1:8000>。

### 日常启动 / 重启

四个用户级单元都已 `enable`，且 `Linger=yes`（不登录也会起）：

```bash
systemctl --user restart rs-service-api rs-service-mcp siriagent-demo cloudflared

# 只重启一个
systemctl --user restart siriagent-demo
```

MCP 有长连接时 `restart` 可能卡在 `deactivating`，用：

```bash
systemctl --user kill -s SIGKILL rs-service-mcp && systemctl --user start rs-service-mcp
```

自检：

```bash
curl -sS http://127.0.0.1:8766/api/v1/health
curl -sS -o /dev/null -w 'demo %{http_code}\n' http://127.0.0.1:8000/
ss -tlnp | grep -E ':(8000|8765|8766) '   # REST / MCP / 演示台
ss -tnp  | grep -c ':7844'                # 期望 4：Cloudflare 隧道连接
curl -sS -o /dev/null -w 'domain %{http_code}\n' https://siriagent.dpdns.org/
```

域名返回 **302 是正常的**（跳 Cloudflare Access 登录页）；如果 530/1033 才是隧道异常。

### Cloudflare 隧道 1033 排障

`Error 1033` 是 Cloudflare 边缘**找不到任何在线的 tunnel 连接**，不是应用 5xx。
`cloudflared` 进程还活着、但 4 条 HA 连接全掉时就会出现；网络抖动或热点切换后通常 10–60 秒自愈。

```bash
curl -fsS http://127.0.0.1:20241/metrics | grep -E 'cloudflared_tunnel_(ha_connections|tunnel_register_success)'
# ha_connections 期望 4；0 = 1033 状态；1–3 = 降级但可用
journalctl --user -u cloudflared --since '30 min ago' | grep -E 'Lost connection|network is unreachable|Registered tunnel'
```

自动恢复：`cloudflared-healthcheck.timer` 每分钟检查一次，HA 连接为 0 且 15 秒未恢复时重启 `cloudflared`：

```bash
systemctl --user list-timers cloudflared-healthcheck.timer
systemctl --user start cloudflared-healthcheck.service   # 手动跑一次
```

根因预防（本机当前走 iPhone 热点 `V`，2026-10-20 18:12 / 19:25 / 19:41 均有 AP 掉线或切换）：

- 长期服务优先有线/固定宽带；热点会休眠、换 AP、被运营商限速。
- 关闭 WiFi 省电：`sudo nmcli connection modify "V" wifi.powersave 2`（重连后生效）。
- 热点端关闭低数据模式；条件允许时把主机接有线，隧道配置不用改。

DSH Web（自己的 Agent GUI，可选）：

```bash
cd /home/siri/Documents/Qoder/2026-10-18/146d1f32/deepseek-harness
node --import tsx/esm apps/cli/src/bin.ts web
# 打开终端打印的带 token 的 URL（默认 http://127.0.0.1:3080）
```

## 数据库

运行库是 RS-Service 的 **PostgreSQL 18**（SIRIAgent 自己不存业务数据）：

```text
postgresql://rs_service:***@127.0.0.1:5432/rs_service
```

连接串放在 `RS-Service/.env`（已 gitignore），systemd 通过 `EnvironmentFile` 读取：

```bash
cat ~/桌面/RS-Service/.env
# RS_DATABASE_URL=postgresql+psycopg://rs_service:...@127.0.0.1:5432/rs_service
```

命令行：

```bash
psql "postgresql://rs_service:rs_service_dev@127.0.0.1:5432/rs_service" -c "\dt"
psql "postgresql://rs_service:rs_service_dev@127.0.0.1:5432/rs_service" \
  -c "select code,name from aoi where level='city' order by code;"
```

程序访问优先走 REST（不碰库连接）：

```bash
curl http://127.0.0.1:8766/api/v1/health
curl http://127.0.0.1:8766/docs          # Swagger
rs-service status                        # TLE 年龄与最近同步
```

迁移与备份：

```bash
# SQLite → PostgreSQL（已执行；源文件保留作回退）
cd ~/桌面/RS-Service
RS_DATABASE_URL=... PYTHONPATH=src .venv/bin/python scripts/sqlite_to_pg.py

# 在线备份
pg_dump -Fc "postgresql://rs_service:...@127.0.0.1:5432/rs_service" \
  -f ~/.local/share/rs-service/backups/rs-$(date +%F).dump
```

旧的 SQLite 文件 `~/.local/share/rs-service/rs.db` 只作迁移源和单测回退，不再写入。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_ROOT` | `/home/siri/Documents/Qoder/2026-10-18/146d1f32/deepseek-harness` | DSH checkout |
| `DSH_CLI` | `$DSH_ROOT/apps/cli/lib/bin.js` | 构建后的 CLI 入口 |
| `NODE_BIN` | `/home/siri/local/node-v22.20.0-linux-x64/bin/node` | node 可执行文件 |
| `DSH_TIMEOUT` | `240` | 单次 DSH 运行超时（秒） |
| `DSH_PROXY` | 无 | 可选，覆盖 HTTPS_PROXY/HTTP_PROXY |
| `MAX_MESSAGE_CHARS` | `12000` | 单条消息长度上限 |
| `AMAP_JS_KEY` | — | 高德 JS API key（AOI 地图绘制）；放 `.env`，经 `/api/config` 下发 |
| `AMAP_SECURITY_CODE` | — | 可选，高德 2.0 安全密钥 |

`headless.patch.yml` 做了两件事：

1. 让 headless 使用 DSH 已保存的凭据（默认 headless 会禁用存储凭据）；
2. 把权限固定为 `workspace-write` + `approval: never`，这样 agent 可以在本项目内读写、跑命令，但不会卡在无人应答的审批上。

## systemd（用户级）

```bash
systemctl --user disable --now siriagent        # 停掉旧项目占用的 8000
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/siriagent-demo.service <<'UNIT'
[Unit]
Description=SIRIAgent demo UI (DSH-backed)
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/siri/桌面/SIRIAgent
Environment=NODE_BIN=/home/siri/local/node-v22.20.0-linux-x64/bin/node
EnvironmentFile=-/home/siri/桌面/SIRIAgent/.env
Environment=HTTPS_PROXY=http://127.0.0.1:7890
Environment=HTTP_PROXY=http://127.0.0.1:7890
ExecStart=/home/siri/桌面/SIRIAgent/.venv/bin/gunicorn -w 1 --threads 4 --timeout 0 -b 127.0.0.1:8000 app:app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now siriagent-demo
```

## API

- `GET /api/health`：检查 DSH CLI、patch、node 是否就绪。
- `POST /api/chat`：`{"message": "...", "session_id": "..."}`，返回最终文本、session、thinking、usage、耗时。

## 已知限制

- 不是 token 级流式：DSH headless 完成后一次性返回，前端只显示“思考中”。
- 每条消息启动一个 DSH 进程，冷启动有开销；并发高时不适合。
- DSH 会话持久化在 `~/.dsh/sessions`，同一个 `session_id` 可续聊。
- 这是验证台，不是生产平台：没有平台级用户体系，依赖 Cloudflare Access。
