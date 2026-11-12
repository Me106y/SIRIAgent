# SIRIAgent Phase 3 需求文档

| 项 | 值 |
| --- | --- |
| 文档定位 | Phase 3 唯一事实源（内部开发蓝图） |
| 版本 | v0.5 |
| 状态 | M1 已落地；M2~M4 待实施 |
| 配套网页 | `docs/PHASE3-REQUIREMENTS.html`（由 `scripts/build_requirements_html.py --phase 3` 生成） |

---

## 1. 现状与目标

### 1.1 现状

- Phase 2 已验收完成（见 `docs/PHASE2-REQUIREMENTS.md` §1.3）；成图规划走右栏「卫星成图」抽屉 → RS-Service 求解 → 四节报告 → 报告内「购买本方案」跳 `/purchase/<run_id>`。
- 购买目前是模拟：`purchase.py` 每次随机复制一个主题目录（火灾 / 森林 / 沥青 / 洪水，5~22 张图）到 `workspace/images/pur-*/`，再附加「建筑变化」的 `image1.png`、`image2.png`。同一对图在工作区重复多份。
- 「遥感解译」抽屉只做变化检测（FlickCD / WHU-CD 权重），前后图从工作区选择或上传，结果内联展示。
- RS-Service 已有 `/api/v1/interpret/images` 与 `/api/v1/interpret/change-detection` REST，以及 MCP 工具 `list_workspace_images`、`detect_change`；DSH Agent 已能经 MCP（`http://127.0.0.1:8765/mcp`）跑变化检测。
- 抽屉「让 Agent 分析」目前给对话注入固定引导「重点看覆盖薄弱区、选星是否合理、云量影响」，与本阶段解译方向不符。

### 1.2 Phase 3 目标

把 SIRIAgent 的遥感解译从「变化检测单功能」扩展为 SIRIGeo 现役能力的 Web 复刻：

1. **购买与工作区收敛**：购买只提供固定一对建筑变化图（`image1.png` / `image2.png`），不再随机复制主题目录；工作区只保留一份，重复购买只引用不复制。
2. **按钮语义切换**：「让 Agent 分析」改为把这对图交给 Agent 做变化检测分析（经 MCP），不再引导覆盖薄弱区 / 选星 / 云量。
3. **解译能力扩展**：变化检测（保留）+ 目标检测 + 语义分割 + 图像处理（灰度 / Canny 边缘 / 降噪），全部以 REST + MCP 工具暴露给前端与 DSH Agent。
4. **界面重设计**：解译抽屉由 impeccable 重新设计（功能选择、输入槽位自适应、结果展示）。

### 1.3 完成口径（验收剧本）

1. 工作区重置后干净：`workspace/images/`、`workspace/uploads/`、`purchases.json` 无历史残留。
2. 生成 task1 报告 → 购买 → 购买页只展示方案摘要 + `image1/2` 两张图；工作区只有一份 `workspace/images/building-change/`，多次购买不产生新副本。
3. 点「让 Agent 分析」→ Agent 在对话里经 MCP `detect_change` 分析该对图，输出变化指标、掩膜图路径、解读与 `accuracy_note`。
4. 解译抽屉跑通：目标检测（标注图 + 计数）、语义分割（分类专题图 + 图例 + 面积占比）、图像处理三算子（各档位结果图）。
5. 在对话里直接指挥（如「把这张图做边缘检测」），Agent 能经 MCP 工具完成，不需点抽屉。
6. 界面三档宽度（1280 / 1440 / 1920）无横向溢出；`cd web && pnpm build` 与 `cd ../RS-Service && uv run pytest` 全绿。

---

## 2. 范围与不做

### 2.1 三仓边界

| 仓库 | 本阶段改动 |
| --- | --- |
| SIRIAgent | `purchase.py` 购买规则、`app.py` 路由（如需）、`web/`（PlanDrawer 按钮语义、解译抽屉重设计、PurchasePage）、`demo/images/` 示例图、PHASE2 §7.3 顺延说明 |
| RS-Service | 解译推理模块（目标检测 / 语义分割 / 图像处理）、`data/models/` 权重、REST `/api/v1/interpret/*`、MCP 工具、依赖（新增 onnxruntime） |
| SIRIGeo | **只读参考**，不做任何改动 |

- 浏览器 → Flask 8000 → RS-Service 8766 的边界不变；`/api/rs/*` 仍是唯一反代入口，DSH 经 MCP 直连 8765。
- 解译输入路径的合法根从「仅 `workspace/`」扩展为「`workspace/` + `demo/`」（示例图必须能被抽屉与 MCP 使用）；越界仍 403。

### 2.2 明确不做

| 项 | 原因 | 去向 |
| --- | --- | --- |
| SIRIGeo 的地形分析、植被检测 | SIRIGeo 已下线，非现役能力 | 后续按需 |
| SIRIGeo 的「自定义功能」与 SQLite 影像图库 | 桌面形态特有，与 Web 平台形态不符 | 后续按需 |
| SIRIGeo 的「单文件 HTML 报告 + 本地 LLM 解读」链路 | 平台已有 DSH Agent 兜底解读；抽屉保持内联结果 | 后续按需 |
| 解译任务队列 / 异步 job | 四个推理均为秒级（变化检测有 55s 预算），同步足够 | Phase 4+ |
| 模型再训练 | 一律现成预训练权重 | 不做 |
| 门禁控制（权限 / 审批 / 白名单） | 顺延 | Phase 4（原 PHASE2 §7.3 占位） |
| 工作区图像管理 UI（删除 / 重置按钮） | 重置是一次性运维动作 | 按需再加 |

---

## 3. 工作区与购买规则

### 3.1 一次性重置（M1 开工时执行）

| 对象 | 动作 |
| --- | --- |
| `workspace/images/pur-*` | 全部删除（9 个历史购买目录） |
| `workspace/uploads/*` | 全部删除 |
| `workspace/purchases.json` | 清空为 `[]` |
| `reports/interpret/` | **保留**（历史检测结果可回看） |

> `workspace/` 在 `.gitignore` 内，重置不改仓库文件；重置是运维动作，不进 PR。

### 3.2 购买新规则

- 购买不再随机选主题目录；每次购买只提供「建筑变化」固定对图：`image1.png`（变化前）、`image2.png`（变化后）。
- 工作区只保留一份：`workspace/images/building-change/`。首次购买（或目录不存在）时复制；已存在则**跳过复制**，只写购买记录（引用同一目录，不产生副本）。
- 购买记录字段：`run_id`、`summary`（方案摘要，取自 `plan.json`，与现状一致）、`image_files`（固定指向 `workspace/images/building-change/image1.png`、`image2.png`）、`created_at`；不再有 `source_dir` / `extras` / 逐文件清单。
- 购买页（`/purchase/<run_id|purchase_id>`）只展示：方案摘要卡 + 两张图（变化前 / 变化后）。多方案购买入口保留现状（报告内「购买本方案」→ 首次进入触发购买 → 刷新只读）。
- `purchase.py` 的 POOL / ALWAYS_INCLUDE 逻辑删除；`data/` 桌面目录（火灾等主题）不再被购买引用（示例图改由 §4.5 的 `demo/images/` 承担）。

---

## 4. 遥感解译能力（复刻 SIRIGeo 现役）

四个能力共用契约：**输入 = 平台内图像路径（`workspace/` 或 `demo/` 相对路径）→ 同步执行 → 输出 = 结果图路径 + 统计数字 + `accuracy_note`**。结果图落 `reports/interpret/<run_id>/`，输入图原样回显。

### 4.1 变化检测（保留，不改造）

| 项 | 口径 |
| --- | --- |
| 模型 | FlickCD（RepViT-m0 编码器 + 差异增强 + 层级解码），WHU-CD 配置权重 `RS-Service/data/models/change_detection/best_model.pth`（已在用） |
| 输入 | 前后两图（双时相）；最大边超 2048 先缩放 |
| 输出 | 变化掩膜 PNG、变化像素数、占比、连通域数、耗时、设备 |
| 阈值 | 0.5 固定（与 SIRIGeo 一致）；accuracy_note 沿用现有文案 |

### 4.2 目标检测（M2 新增）

| 项 | 口径 |
| --- | --- |
| 模型 | YOLOX-S（Megvii 官方 sdist 最小 vendor 子集）+ COCO 80 类官方权重 `models/object_detection/yolox_s.pth`（Apache-2.0，可商用）；预处理与官方 demo 一致（等比 640×640、灰边 114 填充） |
| 推理参数 | CONF 0.25 / NMS 0.45（与 SIRIGeo 一致） |
| 输入 | 单图（最大边超 2048 先缩放） |
| 输出 | 检出标注图（框 + 类别 + 置信度）、目标数、类别数、置信度均值/最低、检测框列表（sidecar）、耗时 |
| 性能 | 纯 CPU 640×640 单图约 0.15s（SIRIGeo 实测口径） |

### 4.3 语义分割（M3 新增）

| 项 | 口径 |
| --- | --- |
| 模型 | oem-lightweight SparseMask + OpenEarthMap 8 类预训练 ONNX `models/semantic_segmentation/sparsemask_openearthmap.onnx`（代码 MIT；权重谱系 CC BY-NC-SA，**限所内非商用**）；类别表与调色板随权重目录 `sparsemask_config.json` 分发 |
| 预处理 | 等比缩到长边 1024、OpenEarthMap 均值方差归一化、反射填充到 32 的整数倍 |
| 输入 | 单图 |
| 输出 | 8 类分类专题图（调色板色图 + 图例）、半透明叠加图、各类面积与占比、类别数、耗时 |
| 性能 | 纯 CPU 1024 输入约 0.6s（SIRIGeo 实测口径） |

### 4.4 图像处理（M4 新增，三算子）

| 算子 id | 名称 | 档位 | 口径 |
| --- | --- | --- | --- |
| `grayscale` | 灰度图 | 无 | BGR → 单通道灰度（带 alpha 铺白底） |
| `canny` | 边缘检测（Canny） | `soft` 30/90 · `normal` 50/150 · `sharp` 80/200 | 先 5×5 高斯平滑再 Canny 双阈值，输出黑白线稿 |
| `denoise` | 降噪 | `light` 高斯 3×3 · `medium` 中值 5×5 · `strong` NL-Means | 按强度三选一，保留主体结构 |

- 输出统一 PNG 落 `reports/interpret/<run_id>/`，文件名 = `<原文件名>_<算子>[_<档位>].png`，重名追加序号不覆盖（对齐 SIRIGeo）。
- 图像处理算子由 `opencv-python-headless` 实现，无模型依赖；参数档位是常量表（不在代码/注释外另抄）。

### 4.5 演示图源

- 从 SIRIGeo 复制对口样例到 `SIRIAgent/demo/images/`（git 入库、只读、不参与购买重置）：
  - 目标检测：`object_02.jpg`、`object_05.jpg`、`test_cars_02.jpg`、`test_cars_03.jpg`（车辆 / 人员航拍，YOLOX-S 实测可检出 `car` / `person` / `truck`；`test_cars_01` 与 `object_01` 同一张且检出异常，已弃用）；
  - 语义分割：OpenEarthMap 航拍 3 张（`aachen_1.jpg`、`accra_1.jpg`、`abancay_1.jpg`）。
- 解译抽屉图源 = 工作区图像（购买 + 上传）+ 示例图两个分区；用户上传通道保留（`workspace/uploads/`，单文件 ≤ 20MB，PNG/JPG）。

---

## 5. MCP 工具契约（DSH Agent 可直接调用）

RS-Service MCP 服务（8765）在现有基础上新增三工具；`detect_change` 与 `list_workspace_images` 保留并放宽路径根（允许 `demo/`）。

| 工具 | 入参 | 出参（要点） | 失败语义 |
| --- | --- | --- | --- |
| `list_workspace_images` | 无 | 工作区 + 示例图清单（kind/group/name/path/宽高） | `{ok:false,error}` |
| `detect_change` | `before_path`, `after_path` | 掩膜图路径、变化像素/占比、连通域、耗时、设备、`accuracy_note` | timeout 504 / forbidden 403 / 422 |
| `detect_objects` | `image_path` | 标注图路径、目标数、类别数、置信度统计、检测框列表、耗时、`accuracy_note` | 同上 |
| `segment_semantics` | `image_path` | 分类专题图、叠加图、各类面积占比、图例、耗时、`accuracy_note` | 同上 |
| `process_image` | `image_path`, `operator`(`grayscale`\|`canny`\|`denoise`), `level`（canny/denoise 档位，灰度忽略） | 结果图路径、算子、档位、耗时、`accuracy_note` | 422（算子/档位非法） |

- 全部**同步执行**；变化检测沿用 55s 内部预算，其余 <10s。不引入任务队列。
- `accuracy_note` 每个工具必带（如目标检测「YOLOX-S 估计，结果需人工复核；输入限制最大边 2048」）。
- REST 侧同步新增 `/api/v1/interpret/object-detection`、`/segment-semantics`、`/process-image`（SIRIAgent 抽屉经 `/api/rs/*` 反代调用）。

---

## 6. 「让 Agent 分析」语义

- 按钮保留在「卫星成图」抽屉的报告中（文案可由 impeccable 一并优化），点击后**不再**注入覆盖薄弱区 / 选星 / 云量引导。
- 新语义：把固定对图（`workspace/images/building-change/image1.png`、`image2.png`）的路径与购买方案摘要交给 Agent，指令为「基于遥感解译能力分析这对图（如变化检测），解读结果并给出建议」；Agent 经 MCP `detect_change` 自主执行并解读，结果（指标 + 掩膜图 + accuracy_note）在对话里呈现。
- 若固定图不存在（从未购买），按钮禁用并提示「先购买方案获得图像」。
- 覆盖薄弱区 / 选星 / 云量分析**不保留按钮入口**；用户可直接在对话里问，Agent 仍能读 `reports/imaging-plan/latest/plan.json` 与报告。

---

## 7. 界面（解译抽屉重设计，impeccable v0.3 回填）

- 范围：只重设计「遥感解译」抽屉（功能选择、输入槽位随功能自适应、结果展示）；不碰星历主界面、购买页与整体视觉体系（响应式三档与色系沿用既有规范）。
- 功能选择：抽屉顶部一行**功能分段控件**四选一（变化检测 / 目标检测 / 语义分割 / 图像处理）；沿用现有 `plan-ghost` / `plan-primary` 视觉词汇，不做新色系。
- 输入：双图功能两个槽位（变化前 / 变化后），单图功能一个槽位；**切换功能时清空不兼容的槽位**；图像处理额外给「算子 + 档位」下拉。
- 图源：两段列表——「工作区」（购买 + 上传）、「示例图」（`demo/images/`），另保留「从文件夹上传」。
- 结果：抽屉内联展示（结果图 + 指标 + `accuracy_note`）；目标检测结果带**可折叠检测框列表**；无检测结果时给空态提示换图。
- 状态：空态（提示先购买/上传）、执行中（按钮禁用 + 阶段文案）、错误（内联红条）、成功（结果卡）、无结果（空态）。
- 交互：保留 ESC 关闭与既有键盘聚焦；不生成 HTML 报告。
- **时机**：M2 开工前先跑 impeccable 设计访谈与产出，设计结论回填本节；M1 不动解译抽屉版式（已完成）。

---

## 8. 里程碑

| 里程碑 | 内容 | 验收 | 涉及仓库 |
| --- | --- | --- | --- |
| M1 工作区与按钮语义 | 一次性重置；购买新规则（固定对图、单份引用）；购买页改版；「让 Agent 分析」语义切换 | §1.3 第 1、2、3、6 条 | SIRIAgent（**已落地**：重置完成；`purchase.py` 固定对图 + `building-change` 端点；购买页/按钮语义/按钮禁用已改；`pnpm build` 绿） |
| M2 目标检测 | YOLOX-S 推理模块 + 权重下载校验 + REST + MCP + 抽屉功能选择（先跑 impeccable 设计） | §1.3 第 4、5、6 条（目标检测部分） | RS-Service + SIRIAgent（**已落地**：RS-Service PR #26；抽屉重设计 + 目标检测 UI + 示例图；`pnpm build` 绿） |
| M3 语义分割 | SparseMask ONNX 推理 + REST + MCP + 抽屉接入 | 同上（语义分割部分） | RS-Service + SIRIAgent（**已落地**：RS-Service PR #27；抽屉第三功能 + 专题图/叠加图/类别占比图例；RS-Service 1.6.0） |
| M4 图像处理 | 三算子 + 档位 + REST + MCP + 抽屉接入 | 同上（图像处理部分） | RS-Service + SIRIAgent（**已落地**：RS-Service PR #28；抽屉第四功能 + 算子/档位选择 + 原图/结果对照；RS-Service 1.7.0） |

- 实施顺序：M1 → M2 → M3 → M4；M2/M3/M4 可并行开发，但每里程碑独立 PR、独立验收、独立 bump 版本（新能力 MINOR：SIRIAgent 1.6.0 起，RS-Service 同步 MINOR）。
- 每个里程碑 PR 按 `.github/pull_request_template.md` 填写；本仓与 RS-Service 分开 PR（先合接口/后端，再合前端），正文互链。
- 模型下载：允许经 hf-mirror 等镜像获取公开权重，附 SHA256 校验与许可说明；替换基线模型的判定 = 许可不劣于基线 ∧ 遥感对口不弱于基线 ∧ 纯 CPU 单图 ≤ 2s，三者同时满足才替换，否则沿用 §4 基线（评估结论回填 §4）。

---

## 9. 决策记录（已关闭）

| # | 决策点 | 结论 | 日期 |
| --- | --- | --- | --- |
| D1 | 阶段定位 | Phase 3「遥感解译扩展」；PRD 落 `docs/PHASE3-REQUIREMENTS.md`；PHASE2 §7.3 门禁顺延 Phase 4 | 2026-11-12 |
| D2 | 工作区重置 | 一次性清理（images/、uploads/、purchases.json），reports/interpret 保留；不做常驻重置按钮 | 2026-11-12 |
| D3 | 购买新规则 | 只提供「建筑变化」固定对图；工作区单份 `workspace/images/building-change/`，重复购买只引用不复制 | 2026-11-12 |
| D4 | 按钮语义 | 「让 Agent 分析」= 交对图给 Agent 经 MCP 做变化检测并解读；覆盖/选星/云量引导移除、不设按钮 | 2026-11-12 |
| D5 | 复刻范围 | 变化检测 + 目标检测 + 语义分割 + 图像处理三算子；不做地形分析/植被检测/自定义功能/SQLite 图库 | 2026-11-12 |
| D6 | 工具化 | 四能力全部注册 MCP 工具（detect_change / detect_objects / segment_semantics / process_image）+ 对应 REST；同步执行、无队列 | 2026-11-12 |
| D7 | 模型选型 | 基线 = YOLOX-S+COCO（Apache-2.0）、SparseMask OpenEarthMap 8 类 ONNX（CC BY-NC-SA 限所内）；允许镜像下载 + SHA256；「更好」= 许可不劣 ∧ 对口不弱 ∧ CPU ≤2s | 2026-11-12 |
| D8 | 演示图源 | SIRIGeo 样例复制到 `demo/images/`（git 入库、只读）；抽屉图源 = 工作区 + 示例图 + 上传；路径合法根扩展为 workspace/ + demo/ | 2026-11-12 |
| D9 | 未提交改动 | 工作区 8 个未提交文件（SW 自动更新等）单独开修复 PR 先合 main，Phase 3 从干净 main 起步 | 2026-11-12 |
| D10 | impeccable | 只重设计解译抽屉，不碰主界面/购买页/视觉体系；M2 前先跑，结论回填 §7 | 2026-11-12 |
| D11 | 界面形态 | 抽屉功能选择 + 输入自适应 + 结果内联；不搬 HTML 报告 + 本地 LLM 链路 | 2026-11-12 |
| D12 | 里程碑 | M1 重置+购买+按钮 → M2 目标检测 → M3 语义分割 → M4 图像处理；独立 PR/验收/版本 bump | 2026-11-12 |
| D13 | 验收剧本 | §1.3 六条为 DoD | 2026-11-12 |

---

## 10. 风险与对策

| # | 风险 | 对策 |
| --- | --- | --- |
| R1 | 权重下载失败（源站 / hf-mirror 不可达） | 优先 hf-mirror；记录 SHA256 与来源；失败时该里程碑 blocked，不降级 mock |
| R2 | OpenEarthMap 权重许可（CC BY-NC-SA 限所内） | 报告与 MCP 工具文档明示；对外商用回退自训练预案（同 SIRIGeo B-R2） |
| R3 | onnxruntime 新依赖与现有 torch 环境冲突 | 在 RS-Service 单独验证导入与推理；CPU 版 onnxruntime 与 torch 共存无已知冲突，验证后再写 lock |
| R4 | 解译路径根扩展（demo/）被误用 | `_resolve_image` 白名单根 + 拒绝绝对越界；测试覆盖 demo/ 放行与越界 403 |
| R5 | 同步 MCP 调用在 Agent 回合内耗时 | 变化检测预算 55s 沿用；其余秒级；超时返回明确错误而非挂起 |
| R6 | 抽屉重设计（impeccable）与 M2 实现脱节 | 设计结论先回填 §7 再开工；实现 PR 引用设计产出 |

---

## 11. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-11-12 | v0.5 | M4 落地（§8）：RS-Service 新增图像处理三算子（`POST /api/v1/interpret/process-image`、MCP `process_image`，灰度/Canny/降噪含档位）；抽屉新增「图像处理」功能（算子 + 档位下拉、原图/结果对照、`accuracy_note`）。Phase 3 四能力全部落地 |
| 2026-11-12 | v0.4 | M3 落地（§8）：RS-Service 新增 SparseMask + OpenEarthMap 8 类语义分割（`POST /api/v1/interpret/semantic-segmentation`、MCP `segment_semantics`、onnxruntime 依赖、`fetch_models.py sparsemask`）；抽屉新增「语义分割」功能，结果展示原图/专题图/叠加图 + 8 类占比图例 + `accuracy_note` |
| 2026-11-12 | v0.3 | M2 落地（§8）：impeccable 设计访谈回填 §7（功能分段控件 / 自适应槽位 / 工作区+示例图两段 / 目标检测可折叠框列表）；解译抽屉重设计并接入目标检测；示例图入库 `demo/images/`（目标检测 4 张 + 语义分割 3 张）；RS-Service 侧 YOLOX-S 推理 + REST + MCP `detect_objects`（PR #26） |
| 2026-11-12 | v0.2 | M1 落地（§8）：工作区一次性重置；`purchase.py` 购买改为固定对图单份引用（`workspace/images/building-change/`），新增 `GET /api/purchases/building-change`；购买页只展示变化前/后两张图；「让 Agent 分析」改解译语义（把固定对图交给 Agent 跑变化检测），固定图不存在时按钮禁用 |
| 2026-11-12 | v0.1 | 初版。基于 grilling 访谈锁定 13 项决策：购买固定对图与单份工作区、「让 Agent 分析」改解译语义、复刻 SIRIGeo 现役四能力并全量 MCP 工具化、四里程碑与六条验收剧本 |
