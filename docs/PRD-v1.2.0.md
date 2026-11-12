# SIRIAgent v1.2.0 PRD：方案购买与遥感解译

| 项目 | 内容 |
| --- | --- |
| 目标版本 | v1.2.0（SemVer MINOR） |
| 状态 | 草案，待评审 |
| 日期 | 2026-11-09 |
| 范围 | SIRIAgent（购买、解译抽屉、工作区）+ RS-Service（变化检测后端与 MCP 工具） |
| 不在本版 | 支付/订单、删除工作区、其他解译类型、TIFF/多光谱、解译 HTML 报告、配对建议 |

## 1. 背景与目标

当前平台能制定成图方案、生成报告，但报告到"拿到图像"之间是断的；也没有任何影像解译能力。v1.2.0 把链路补成：

**制定方案 → 购买（模拟）→ 得到一组遥感影像 → 对影像做变化检测 → Agent 也能用自然语言发起同样的检测。**

两个功能同版交付；购买先跑通，作为解译的数据来源。

## 2. 术语

- **购买**：模拟购买。不接支付，只把 `data/` 中一个主题目录复制到平台工作区，并留下可追溯记录。
- **工作区**：`SIRIAgent/workspace/`，存放购买到的图像与用户上传的图像，gitignored。
- **解译**：本版只做变化检测（FlickCD 双时相模型）。
- **模拟数据**：`data/` 下 56 张 PNG 均为生成/模拟影像，不是真实卫星观测，界面必须标注。

## 3. 功能一：方案购买

### 3.1 报告里的购买入口

- 在 RS-Service 报告 `#purchase`（推荐计划）一节下方增加「购买本方案」按钮。
- 链接必须是根绝对 URL：`/purchase/<run_id>`。报告经 `/api/files` 打开，相对路径会解析成 `/api/purchase/...` 而 404。
- `run_id` 需要进入报告模板上下文：`render_report(result, run_id)`，`write_report` 同步传参。

### 3.2 购买成功页 `/purchase/<id>`

前端新增 SPA 内分支（不引 router）：`main.tsx` 读 `pathname`，`/^\/purchase\/([^/]+)$/` 渲染 `PurchasePage`，其余仍渲染 `App`。

流程：

1. 从报告点按钮打开 `/purchase/<run_id>`。
2. 页面加载时 `POST /api/purchases`，body `{run_id}`。
3. 后端生成 `purchase_id`，从 4 个可配对目录中随机选一个，复制到 `workspace/images/<purchase_id>/`，追加 `workspace/purchases.json`。
4. 成功后 `history.replaceState` 到 `/purchase/<purchase_id>`，刷新不会重复购买。
5. 直接访问 `/purchase/<purchase_id>` 只读展示，不再触发购买。

页面内容：

- 视觉居中的成功图标 + 「购买成功」。
- 轻量方案摘要：城市、时间窗、选中卫星数、达标面积、购买时间、数据目录名、图像数量。
- 「查看遥感图像」进入该 `purchase_id` 的图像列表（文件、尺寸、点击用 `/api/files` 预览）。
- 「模拟数据」标注。

### 3.3 随机数据池与复制

- 数据根：`/home/siri/桌面/data`（可配置 `PURCHASE_DATA_ROOT`）。
- 随机池只含 4 个可配对目录：`多维度全面评估火灾`、`森林覆盖变化`、`沥青路面老化评估`、`洪水检测`。
- `区域大气污染多源遥感协同监测` 是单时相多源，不进入随机池；留到后续「多源分析」解译类型。
- 复制源目录下全部文件（PNG + 说明 TXT），源目录只读，不移动、不修改。
- 每次购买生成新 `purchase_id`、新目录，不覆盖历史（重复购买同一方案会得到新目录）。

### 3.4 购买记录

`workspace/purchases.json` 追加数组，单条记录：

```json
{
  "purchase_id": "pur-20261109-a1b2c3d4",
  "run_id": "plan-...",
  "source_dir": "多维度全面评估火灾",
  "workspace_dir": "workspace/images/pur-20261109-a1b2c3d4",
  "summary": {"city": "杭州市", "window_start": "...", "window_end": "...", "sat_count": 3, "qualified_area_pct": 92.1},
  "files": [{"name": "灾前白天假彩色卫星遥感图_无标注.png", "bytes": 1234567, "width": 1254, "height": 1254}],
  "created_at": "2026-11-09T15:00:00+08:00",
  "simulated": true
}
```

API：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/purchases` | `{run_id}` → 生成购买、复制、写记录；返回记录 |
| GET | `/api/purchases/<purchase_id>` | 记录 + 文件清单 |
| GET | `/api/purchases` | 最近购买列表（工作区页/后续用） |

摘要来源：`reports/imaging-plan/<task>/<run_id>/plan.json`；读取失败时摘要留空但仍可购买。

## 4. 功能二：遥感解译（变化检测）

### 4.1 入口与布局

- 右栏 Agent 头部「卫星成图」旁增加「遥感解译」按钮，打开全屏模态（复用 `PlanDrawer` 的 overlay/shell/步骤轨/结果卡样式）。
- 抽屉分两块：
  - 上：解译功能选择（本版只有「变化检测」）、前图、后图、开始检测按钮。
  - 下：工作区图像列表（购买的 + 上传的），支持点击选入前/后槽位，也支持从文件管理器拖拽或点击上传。
- 界面上写明格式约束：**PNG / JPG，单文件 ≤20MB，最大边超过 2048 会缩放到 2048 再检测**。

### 4.2 输入

- 前/后各一张图；允许来自不同 `purchase`，也允许上传图与购买图混用。
- 上传保存到 `workspace/uploads/<upload_id>/`，保留，不自动清理。
- 前后尺寸不一致时，把后图对齐到前图尺寸，结果按前图尺寸。
- 接受 PNG / JPG；TIFF、多光谱、超 20MB 在前端与后端都拒绝。

### 4.3 后端与模型

- 放在 RS-Service：`src/rs_service/interpret/`，vendor 自 `../SIRIGeo` 的 FlickCD 代码（`encoder.py`、`decoder.py`、`flickcd_infer.py` 的滑窗/归一化/融合），保留上游来源与许可说明。
- 模型：FlickCD，双输入各 3 通道 RGB，256 方形滑窗、步长 128，输出单通道概率图，阈值 0.5，无形态学。
- 权重：`data/models/change_detection/best_model.pth`，7.9MB，随仓库入库。
- 依赖：`torch 2.7+`（cu128，支持 RTX 5090 的 sm_120）、`timm`、`opencv-python-headless`、`numpy 1.26+`。
- 算力：**GPU 优先、CPU 回退**；启动时预加载模型并检测 `torch.cuda.is_available()`；滑窗按 batch 送 GPU，避免逐块 kernel launch。
- 尺寸保护：最大边 >2048 先 `INTER_AREA` 缩放到 2048，结果标 `resized=true`。
- 超时：同步调用，服务端 55 秒主动返回可读超时错误；前端 65 秒兜底提示。
- 结果写 `reports/interpret/<run_id>/{mask.png,result.json}`，`run_id` 由后端生成。
- 本版不生成解译 HTML 报告，也不接 SIRIGeo 的 LLM 解读流水线。

### 4.4 接口（RS-Service，SIRIAgent 反代）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/interpret/images` | 工作区图像清单：`purchase_id`、相对路径、文件名、宽高、mtime |
| POST | `/api/v1/interpret/change-detection` | `{before_path, after_path}`，同步返回结果 |

返回：

```json
{
  "ok": true,
  "run_id": "int-...",
  "mask_path": "reports/interpret/int-.../mask.png",
  "before_path": "workspace/images/pur-.../灾前.png",
  "after_path": "workspace/images/pur-.../灾后.png",
  "changed_area_px": 12345,
  "changed_ratio": 0.078,
  "components": 12,
  "elapsed_ms": 4200,
  "resized": false,
  "device": "cuda",
  "accuracy_note": "变化检测为模型估计，阈值 0.5，结果需人工复核。"
}
```

路径契约：`before_path` / `after_path` 是相对 SIRIAgent 根目录的路径；RS-Service 配置 `SIRIAGENT_ROOT`（默认相邻目录），`resolve` 后必须落在 `workspace/` 内，拒绝符号链接越界与任意文件读取。

### 4.5 MCP 工具与 Agent

两个工具挂在 `mcp__rs-service__*`：

| 工具 | 入参 | 出参 |
| --- | --- | --- |
| `list_workspace_images` | 无 | 图像清单（不含二进制） |
| `detect_change` | `before_path`, `after_path` | 4.4 的返回结构 |

- 纯语言流程：用户说“用火灾那组灾前灾后做变化检测” → Agent 调 `list_workspace_images` 找路径 → 调 `detect_change` → 返回 mask 路径、变化占比、连通域数与精度声明。
- 不提供“配对建议”，Agent 自己按文件名判断。
- 新增 `skills/change-detection/SKILL.md` + `COMMANDS.md`，命令清单写明同步耗时与 2048 限制。

## 5. 工作区与文件服务

```text
SIRIAgent/
├── workspace/
│   ├── purchases.json
│   ├── images/<purchase_id>/...
│   └── uploads/<upload_id>/...
└── reports/
    └── interpret/<run_id>/{mask.png,result.json}
```

- `workspace/` 加入 `.gitignore`。
- `/api/files` 白名单收紧到 `reports/` + `workspace/`；`.env`、源码、`headless.patch.yml` 不再可读，越界返回 403。
- 前端 `fileLinks` 识别 `workspace/` 路径，Agent 输出里的 mask 路径可点击。
- 目录不能通过 `/api/files` 列出，图像清单走 4.4 的接口。

## 6. 依赖、部署与回滚

- RS-Service 新增 torch 等依赖，安装体积约 +2.5GB；autoship 首次部署会变慢。
- 权重入库；`uv pip install -e .` 后需重启 `rs-service-api` 与 `rs-service-mcp`。
- MCP 进程不热加载：改 `interpret/`、`mcp/` 后两个单元都要重启。
- 回滚：revert 对应 PR 并恢复依赖；已购买数据与解译结果保留在 `workspace/`、`reports/`，不受回滚影响。

## 7. 验收清单

1. 生成一份成图报告，报告底部出现「购买本方案」；点击后新标签打开 `/purchase/<run_id>`。
2. 成功页居中显示成功图标与方案摘要；URL 变为 `/purchase/<purchase_id>`；刷新不重复购买。
3. 「查看遥感图像」列出该目录全部文件，点击可预览；界面有「模拟数据」标注。
4. 重复购买同一方案生成新 `purchase_id`，`workspace/purchases.json` 追加记录，旧目录保留。
5. 打开「遥感解译」，能从工作区选两张图或拖拽上传；前后尺寸不一致也能检测。
6. 点击「开始检测」后显示 loading；结果展示前图 / 后图 / 掩膜三联图与变化面积、占比、连通域数、耗时。
7. 结果文件落到 `reports/interpret/<run_id>/`；最大边 >2048 的图会缩放并标 `resized`。
8. 聊天里说“用火灾那组灾前灾后做变化检测”，Agent 依次调用 `list_workspace_images`、`detect_change`，返回 mask 路径与统计。
9. GPU 可用时 `device=cuda`，不可用时回退 CPU；55 秒主动超时返回可读错误。
10. `/api/files?path=.env` 返回 403；`workspace/` 与 `reports/` 下文件正常打开。
11. `cd web && pnpm build` 绿；RS-Service `uv run pytest`、`ruff check` 绿；三档宽度无横向溢出。

## 8. 明确不做

- 支付、订单、库存、退款；购买只是模拟。
- 工作区删除/重命名/配额。
- 除变化检测外的解译类型（多源分析、目标检测等）。
- TIFF、多光谱、地理坐标与面积量算。
- 解译 HTML 报告、LLM 自动解读。
- 前后图自动配对建议。
- 大气污染目录进入随机池。

## 9. 风险

| 风险 | 缓解 |
| --- | --- |
| torch 版本与 RTX 5090（sm_120）不匹配 | 锁 2.7+ cu128，启动时打印 device；CPU 回退 |
| RS-Service 依赖变大、部署变慢 | 首次安装接受；后续走 uv 缓存 |
| MCP 同步工具阻塞其他工具 | 55 秒主动超时；同一时刻只跑一轮解译 |
| RS-Service 跨仓读取工作区 | `SIRIAGENT_ROOT` + `resolve` 限定 `workspace/` |
| 模拟数据被误当真实观测 | 购买页、解译页、结果与 Agent 回复均标「模拟数据」 |

## 10. 决策记录

| # | 决策 |
| --- | --- |
| Q1 | 购买与解译同版 v1.2.0 |
| Q2 | 保留购买记录，可重复购买，不接支付 |
| Q3 | 工作区 `SIRIAgent/workspace/images/<purchase_id>/`，复制源数据，不自动清理 |
| Q4 | 成功页带轻量摘要，查看图像进入列表 |
| Q5 | Agent 工具同步返回结果 |
| Q6 | 解译后端放 RS-Service（A） |
| Q7 | 每次新 `purchase_id`、不覆盖、保留历史 |
| Q8 | 随机池只取 4 个可配对目录，排除大气 |
| Q9 | 最大边 2048 + 缩放标注 |
| Q10 | 两张图输入，三联图 + 统计，不生成报告 |
| Q11 | 工具：`list_workspace_images`、`detect_change` |
| Q12 | 权重入库；依赖升级到 torch 2.7+ / numpy 1.26+ |
| Q13 | `/api/files` 白名单 `reports/` + `workspace/` |
| Q14 | 不做配对建议 |
| Q15 | PNG/JPG、≤20MB、2048 上限，界面写明 |
| Q16 | 启动预加载、55 秒主动超时、前端防重复提交 |
| Q17 | 成功页摘要保持轻量 |
