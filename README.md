# SIRIAgent

一个独立的、用于快速验证 DSH 的极简 Web 界面。它**不修改** `SIRI-Agent` 项目，只在自己的目录里运行。

> Phase 2 的范围、优先级与验收标准见 [`docs/PHASE2-REQUIREMENTS.md`](docs/PHASE2-REQUIREMENTS.md)（[HTML 版](docs/PHASE2-REQUIREMENTS.html)，由 `scripts/build_requirements_html.py` 生成）。后续需求变更只改该文档，不再写入 `SIRI-Agent`。
>
> Agent 在本仓库的工作约定见 [`AGENTS.md`](AGENTS.md)。

## 它是什么

```text
浏览器
  │  https://siriagent.dpdns.org（Cloudflare Access 保护）
  ▼
Cloudflare Tunnel
  ▼
127.0.0.1:8000  gunicorn + Flask（本项目）
  │  每次对话 spawn 一个子进程
  ▼
dsh --profile headless --json
  │  使用 DSH 已保存的凭据和模型
  ▼
DSH agent（DeepSeek Harness）
```

- 前端：`static/index.html`，原生 HTML/CSS/JS，无构建步骤。
- 后端：`app.py`，Flask，负责调用 DSH headless 并解析 NDJSON 事件。
- DSH：`dsh --profile headless`，每次消息一次运行；用 `--session-id` 续聊。
- 端口：`127.0.0.1:8000`，与原来的平台一致，Tunnel 不需要改。

## 运行

```bash
cd "/home/siri/桌面/SIRIAgent"

# 一次性建环境（本机已用 uv 装好 Python 3.12）
~/.local/bin/uv venv --python 3.12 .venv
~/.local/bin/uv pip install --python .venv/bin/python -r requirements.txt

# 前台启动
.venv/bin/gunicorn -w 1 --threads 4 --timeout 300 -b 127.0.0.1:8000 app:app
```

打开 <http://127.0.0.1:8000>。

## 配置

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_ROOT` | `/home/siri/Documents/Qoder/2026-10-18/146d1f32/deepseek-harness` | DSH checkout |
| `DSH_CLI` | `$DSH_ROOT/apps/cli/lib/bin.js` | 构建后的 CLI 入口 |
| `NODE_BIN` | `/home/siri/local/node-v22.20.0-linux-x64/bin/node` | node 可执行文件 |
| `DSH_TIMEOUT` | `240` | 单次 DSH 运行超时（秒） |
| `DSH_PROXY` | 无 | 可选，覆盖 HTTPS_PROXY/HTTP_PROXY |
| `MAX_MESSAGE_CHARS` | `12000` | 单条消息长度上限 |

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
Environment=HTTPS_PROXY=http://127.0.0.1:7890
Environment=HTTP_PROXY=http://127.0.0.1:7890
ExecStart=/home/siri/桌面/SIRIAgent/.venv/bin/gunicorn -w 1 --threads 4 --timeout 300 -b 127.0.0.1:8000 app:app
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
