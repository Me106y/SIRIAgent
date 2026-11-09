# Changelog

SIRIAgent 的用户可见变化。版本规则见 [docs/VERSIONING.md](docs/VERSIONING.md)。

## [1.4.1] - 2026-11-09

### Changed

- 卫星成图抽屉不再显示“TLE 最大年龄 >72h / 结果标 degraded”的提示，按正常处理；超过 7 天仍拒绝规划。

## [1.4.0] - 2026-11-09

### Changed

- 工作步骤展示默认改为「极简」：只留思考摘要，不显示工具调用。
- 推理程度默认改为「低」，前后端默认值一致。

### Fixed

- 遥感解译的前/后图槽位支持清除已选图片。

## [1.3.0] - 2026-11-09

### Changed

- 每次购买在随机主题之外固定附带 `建筑变化` 的前后两张图（`image1.png` / `image2.png`），保证演示时总有一对变化明显的前后图；购买记录新增 `extras`。

### Fixed

- 购买页放开全局 `overflow: hidden`，长图像列表可以纵向滚动。

## [1.2.1] - 2026-11-09

### Added

- 新增 `docs/PRD-v1.2.0.md`：购买与遥感解译（变化检测）的产品需求文档。

## [1.2.0] - 2026-11-09

### Added

- 方案购买（模拟）：报告新增「购买本方案」，`/purchase/<id>` 展示成功页、方案摘要与图像列表；购买记录写入 `workspace/purchases.json`，图像复制到 `workspace/images/<purchase_id>/`。
- 遥感解译：右栏新增全屏抽屉，支持变化检测、工作区选图、拖拽或文件夹上传（PNG/JPG、≤20MB），同步检测后展示前图 / 后图 / 掩膜三联图与统计。
- 图像上传 `POST /api/uploads`，保存到 `workspace/uploads/<upload_id>/`。

### Changed

- `/api/files` 白名单收紧到 `reports/` 与 `workspace/`，`.env`、源码等不再可读。

## [1.1.0] - 2026-11-09

### Added

- 对话输入区可选择模型（DeepSeek-V4.1-Flash / DeepSeek-V4-Pro）与推理程度（关闭 / 低 / 高 / 最高）；切换模型时重建 DSH runtime 并恢复当前会话，上下文不丢。

## [1.0.0] - 2026-11-07

### Added

- Phase 2 完成：星历可视化、Agent 对话、卫星成图与四节报告全部上线，站点经 Cloudflare Access 对外运行。
- 发布自动化：合并到 `main` 后按 `VERSION` 自动打 tag，并双推 GitHub / Gitee。

### Changed

- 验收口径按实际交付更新：事件级流式、会话恢复转 Phase 3、浏览器矩阵限定 Chrome；遗留项见 `docs/PHASE2-REQUIREMENTS.md` §9.2。

## [0.1.0] - 2026-11-07

### Added

- 初始版本基线：三栏前端（卫星目录 / 3D 地球 / Agent）、卫星成图与四节报告、对话流式续读与追问卡片。
