# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + Vite + TypeScript + CesiumJS（前端，`web/`）；Flask（`app.py`）+ DSH Python SDK（`sdk_runtime.py`）后端，跑在 127.0.0.1:8000；星历/成图/解译数据与计算由 RS-Service（FastAPI，8765 MCP / 8766 REST）提供，浏览器只经 `/api/rs/*` 反代访问。公网经 Cloudflare Tunnel + Access 保护。

## Users

受邀演示与使用人员（无账号体系、单会话交互）：在「星历可视化 → 成图规划 → 购买方案 → 遥感解译」的主链路上工作；既可点抽屉按钮，也可在右栏对话里直接指挥 Agent。技术背景不一，依赖界面自解释与 `accuracy_note` 兜底认知。

## Product Purpose

SIRIAgent 是遥感任务平台：左 1/3 星历可视化（Cesium），右 2/3 与 DSH Agent 对话。它把「看星历、定成图方案、购买方案、遥感解译、让 Agent 分析」串成一条闭环，让使用者不用分别操作多套工具。

## Positioning

星历、成图规划与遥感解译由同一 Agent 平台承载：所有计算走 RS-Service 后端，Agent 经 MCP 直连同一组能力，界面按钮与对话指挥等价。任何结论都带 `accuracy_note`，解译结果要求人工复核——这是与「黑箱演示」相邻产品可复制的差异。

## Operating Context

- 单机演示环境（127.0.0.1 + Cloudflare Tunnel），同一时刻只跑一轮对话。
- 成图方案产物在 `reports/imaging-plan/<run_id>/`，购买记录在 `workspace/purchases.json`，工作区图像在 `workspace/images/`（购买 + `uploads/`）。
- 解译结果图落 `reports/interpret/<run_id>/`；示例图在 `demo/images/`（只读）。
- 数据目录（`~/桌面/data/`）存放固定对图「建筑变化」等模拟影像。

## Capabilities and Constraints

- 能力：星历（目录/过境/轨迹/位置）、成图规划（task1~task4）、方案购买（固定对图）、遥感解译（变化检测 FlickCD；Phase 3 扩展目标检测 YOLOX-S、语义分割 SparseMask、图像处理三算子）、DSH Agent（MCP 工具：星历 8 个 + 解译 2 个已注册）。
- 硬约束：所有对外结果带 `accuracy_note`；解译结果需人工复核；输入图最大边 2048（分割 1024）缩放；`/api/files` 只允许 PROJECT_ROOT 内文件；解译输入路径只允许 `workspace/` + `demo/`；云量按 AOI 网格代表点。
- 术语：AOI、过境、MRT/ART、TLE、SGP4、accuracy_note、run_id、purchase_id、before/after。

## Brand Commitments

名称 SIRIAgent；界面语言简体中文；报告与页面页脚带「AI 生成内容仅供参考」声明（解译报告侧）。

## Evidence on Hand

- `docs/PHASE2-REQUIREMENTS.md`（星历与成图口径）、`docs/PHASE3-REQUIREMENTS.md`（解译扩展蓝图）。
- `reports/imaging-plan/latest/`（真实求解结果）、`reports/interpret/`（真实 FlickCD 检测结果）、`demo/images/`（SIRIGeo 样例图）。
- 无用户访谈、无外部评测数据；演示场景证据以仓库运行数据为准，不虚构。

## Product Principles

1. 单一事实源：需求认 docs，接口认 RS-Service api.md，skill 认 COMMANDS.md。
2. 口径诚实：所有数字带精度声明；解译是估计，需人工复核。
3. 闭环优先：按钮与对话两条路到达同一组能力。
4. 边界清晰：浏览器永不直连 8766；文件访问白名单内。
5. 演示可达：固定对图、示例图保证任何时候点开就能跑。

## Accessibility & Inclusion

界面三档宽度（1280/1440/1920）无横向溢出，<1024 单列堆叠；简体中文 UI；抽屉支持 ESC 关闭与键盘聚焦（沿用现有实现）。
