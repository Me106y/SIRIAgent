# Changelog

SIRIAgent 的用户可见变化。版本规则见 [docs/VERSIONING.md](docs/VERSIONING.md)。

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
