<!-- 标题：<type>(<scope>): <英文祈使句>；正文中文。 -->

## 做了什么

<!-- 一句话，与 PR 标题一致 -->

## 为什么

<!-- 需求文档章节 / issue；不要写“优化体验”这类空话 -->

## 改了哪一层

- [ ] 前端 `web/`
- [ ] 后端 `app.py` / `sdk_runtime.py`
- [ ] skill / MCP / 接口字段
- [ ] 文档 / 部署 / 配置
- [ ] 跨仓：RS-Service PR #

## 硬规则自查（碰了哪层勾哪层）

- [ ] 星历：结果带 `accuracy_note`；TLE 72h/7d 处理正确；非公开卫星未泄漏分辨率
- [ ] 交互：`ask_user_question` 一次一问；断线用 `turn_id` + 游标续读
- [ ] 前端：1280/1440/1920 无横向溢出；WebGL 不可用时有 2D 降级
- [ ] 文件与凭据：`/api/files` 未越界；无 `.env`、密钥、`web/dist/`、`reports/` 入库

## 怎么验证

<!-- 贴命令与结果；界面改动写清三档宽度的结果 -->

```sh
cd web && pnpm build
```

## 风险与回滚

<!-- 要重启哪个 systemd 单元；出问题怎么撤回 -->

---
<!-- agent 提的 PR：在最上方第一行加 This is by an automated agent, not a human. -->
