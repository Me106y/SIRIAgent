# 版本与发布规则

> 适用范围：`SIRIAgent` 与 `RS-Service` 两个仓库。本文是版本规则的唯一事实源；两个仓库的 `AGENTS.md` 只保留摘要并链接到这里。
>
> 当前基线：两个仓库均为 `0.1.0`（2026-11-07 建立）。规则从本文件合并后开始执行。

## 1. 版本真源

- 每个仓库根目录一个 `VERSION` 文件，内容为一行纯文本版本号（如 `0.2.0`），是唯一真源。
- 同步字段：
  - `SIRIAgent`：`web/package.json` 的 `version`；
  - `RS-Service`：`pyproject.toml` 的 `version`。
- 两处与 `VERSION` 不一致即为缺陷；PR 自检时核对。

## 2. 版本级别

采用 SemVer 2.0.0（`MAJOR.MINOR.PATCH`）。

### 2.1 `0.x` 阶段（Phase 2 验收前）

| 级别 | 什么时候用 |
| --- | --- |
| MINOR（`0.y.0`） | 新功能、新接口、新任务、新页面，以及**对外行为或口径变化**（如 task1 改为面积口径） |
| PATCH（`0.y.z`） | 修复、样式/文案、性能、依赖升级、纯文档 |
| MAJOR | `0.x` 阶段不使用；破坏性变更按 MINOR 处理 |

Phase 2 验收（`docs/PHASE2-REQUIREMENTS.md` §1.3）通过后再打 `1.0.0`。

### 2.2 `1.0.0` 之后

| 级别 | 什么时候用 |
| --- | --- |
| MAJOR | 破坏性变更：删改 REST 路径/字段、MCP 工具名/入参、报告结构或口径不兼容、数据库迁移不可逆、需要人工回滚 |
| MINOR | 向后兼容的新能力：新任务、新页面、新接口字段、新 skill、行为口径变化 |
| PATCH | 修复、样式/文案、性能、依赖升级、纯文档 |

## 3. 什么时候 bump

- **每个合并到 `main` 的 PR 必须 bump 一次**，且只升一级。版本单元是 PR，不是 commit、也不是发布批次。
- 纯文档、纯配置的 PR 也按 PATCH bump，不设例外。
- 同一 PR 只做一件事（既有规则），版本对应这一件事。
- 不允许跳级（如 `0.1.1 → 0.3.0`）；紧急回滚除外，需在 PR 正文说明。
- 本规则首次落地的 PR（建立 `0.1.0` 基线）不 bump。

### 并行 PR 冲突

两个 PR 同时改 `VERSION` 必然冲突，这是预期行为：

- 后合并者 rebase 到最新 `main`，按自己的改动类型重新定版本；
- 自己也是 MINOR → 顺延到下一个 MINOR；自己是 PATCH → 用 `下一个 PATCH`；
- 不加版本文件锁，不预留版本号。

## 4. 一个版本要改的文件

1. `VERSION`；
2. `CHANGELOG.md` 顶部新增该版本条目；
3. 对应打包字段（`web/package.json` 或 `pyproject.toml`）；
4. 若本次改到展示点，确保版本从真源读取（不要硬编码）。

### 展示点（目标状态）

- `SIRIAgent`：`/api/health` 返回 `version`；设置菜单/关于处显示“平台 vX · 星历服务 vY”。
- `RS-Service`：`/api/v1/health` 返回 `version`；报告页脚显示生成它的 RS-Service 版本。
- 报告页脚只写 `RS-Service` 版本，不写 `SIRIAgent` 版本；同一份报告可能被不同前端打开。
- 版本号不写进 `accuracy_note`，精度声明只讲精度。

> 展示点与自动 tag 尚未接入，当前最小要求是 `VERSION` + `CHANGELOG` + 打包字段；改到上述文件时顺带补齐。

## 5. CHANGELOG 格式

采用 Keep a Changelog 的简版结构，只写用户可感知的变化，不写 commit 列表：

```markdown
## [0.2.0] - 2026-11-07

### Added

- 新增 task6：给定星数最小化面积加权平均重访。

### Changed

- task1 达标判定改为“至少成像一次”的面积口径。

### Fixed

- 修复隧道断开后追问被当成未回答的问题。
```

- 新条目加在最上方，日期用北京时间的日期。
- 同一版本内按 Added / Changed / Fixed / Removed 分组，没有的组不写。
- 不维护 `[Unreleased]` 段；未合并的改动写在 PR 正文里。

## 6. tag 与回滚

- 合并后打 `v<version>`（如 `v0.2.0`），两个仓库各自打。合并即部署，tag 标记“线上跑过这个版本”，不是发布许可。
- CI 自动打 tag 落地前，由合并者手工执行：

  ```bash
  git tag -a v0.2.0 -m "v0.2.0"
  git push origin v0.2.0
  git push gitee v0.2.0
  ```

- 不删 tag、不复用版本号。回滚到旧行为时发新的 PATCH，并在 CHANGELOG 写 `Reverted`。
- tag 创建失败可补打；版本本身以 `VERSION` 为准。

## 7. 两仓独立与依赖

- 两个仓库各自编号，不共用一个“平台版本”。
- 界面或文档需要同时展示时，并排写两个版本，不产生第三个号。
- `SIRIAgent` 依赖 `RS-Service` 的新能力时，在 CHANGELOG 写 `requires RS-Service >=x.y.z`；跨仓 PR 先合被依赖方，再合调用方。

## 8. 数据库与迁移

- Alembic revision 是独立体系，不替代版本号，也不跟着版本号改名。
- MAJOR 级变更要求迁移可回滚，或在合并前有备份；这条写进 PR 的风险与回滚一节。

## 9. 预发布

- 当前没有预发环境，默认不启用预发布版本。
- 确需灰度时用 `x.y.z-rc.N`（如 `0.3.0-rc.1`），验证通过后打正式 `0.3.0`；两个 tag 都保留，CHANGELOG 写清差异。

## 10. PR 自检

提交 PR 前逐条核对：

- [ ] `VERSION` 相对 `origin/main` 升了一级，且只升一级；
- [ ] `CHANGELOG.md` 顶部有该版本条目，内容与改动一致；
- [ ] `web/package.json` / `pyproject.toml` 的 `version` 与 `VERSION` 一致；
- [ ] 若改变对外行为，PR 正文写了影响面与回滚方式；
- [ ] 合并后打了 `v<version>` tag（或注明由合并者补打）。

## 11. 自动化现状

脚本与 CI 校验尚未落地（`scripts/version.py`、PR 检查与自动 tag 计划随 A7 的最小 CI 一起补）。在自动化就位前，上述检查靠 PR 自检与评审兜底；规则本身不变。
