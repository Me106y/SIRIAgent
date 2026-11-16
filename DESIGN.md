# DESIGN.md

> SIRIAgent 的视觉与交互基线。新组件先对齐这里的 token 与规则；与本文件冲突时，先改文档再改代码。
> 产品上下文见 `PRODUCT.md`，需求见 `docs/PHASE2-REQUIREMENTS.md` 与 `docs/PRD-v2.0.0.md`。

## 1. Visual Theme & Atmosphere

深空科技风，但不做“霓虹赛博”。背景是近黑的深蓝，信息层级靠留白、细边框与低饱和面板建立；青色（cyan）只用于主操作、进度与焦点，琥珀色（amber）只用于 KPI 数值与需要注意的结论，红色只用于错误/危险，绿色只用于完成/可行。

- 关键词：克制、可读、仪器感、可追溯。
- 不做：大面积渐变、玻璃拟态、发光描边堆叠、装饰性粒子。
- 地球是视觉主体；面板是“仪表”，不抢地球的注意力。

## 2. Color Palette

### 应用（深色，唯一主题）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `#040a12` | 页面底色 |
| `--panel` | `#081426` | 面板 |
| `--panel-2` | `#0b1a30` | 次级面板 / hover |
| `--line` | `#162a44` | 分隔线、边框 |
| `--line-soft` | `#102138` | 弱分隔 |
| `--ink` | `#dbe8f7` | 主文字 |
| `--muted` | `#7f95ad` | 辅助文字 |
| `--accent` | `#22d3ee` | 主操作、进度、焦点 |
| `--accent-2` | `#2dd4bf` | 进度渐变终点 |
| `--violet` | `#a78bfa` | 次级强调（少量） |
| `--danger` | `#f87171` | 错误 |
| `--warn` | `#fbbf24` | 注意 / 未达标 |
| `--ok` | `#34d399` | 完成 / 可行 |

### 报告（深色 / 浅色）

| 语义 | 深色 | 浅色 |
| --- | --- | --- |
| 背景 | `#070b10` | `#f4f7fa` |
| 面板 | `#0d141c` | `#ffffff` |
| 主文字 | `#dfe8f1` | `#101c26` |
| 辅助文字 | `#7d93a8` | `#536575` |
| 青色 | `#48c7d9` | `#0b6e83` |
| 琥珀 | `#f0a52b` | `#a9540a` |
| 地图底 | `#0d1a24` | `#edf3f7` |

报告必须支持 `?theme=dark|light` 与 `prefers-color-scheme` 之外的显式切换；打印/导出 PDF 强制浅色。

## 3. Typography

- 无衬线：`"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif`
- 等宽：`"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace`（数字、时间、NORAD、run_id）
- 应用基准 14px，行高 1.6；报告正文 15px，行高 1.7。

### 字号阶梯（应用）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--text-xs` | 12px | 标签、角标、最小可读字号；**禁止更小** |
| `--text-sm` | 13px | 辅助说明、次要信息 |
| `--text-base` | 14px | 正文、表单、按钮 |
| `--text-lg` | 16px | 区块标题 |
| `--text-xl` | 20px | 页面级标题 |
| `--text-2xl` | 26px | 抽屉标题 / 首屏大标题 |

### 报告字号

| 元素 | 值 |
| --- | --- |
| 正文 / 表格 | 15px |
| 辅助 `.lede` | 14px |
| 标签 `.context .k` / `.strip .lab` | 12.5px |
| 小字 / 脚注 | 12px |
| H2 | 19px |
| KPI 数值 | 24px |

数字用 `font-variant-numeric: tabular-nums`，避免跳动。

## 4. Spacing & Layout

- 间距基数 4px；常用 4 / 8 / 12 / 16 / 24 / 32 / 48。
- 圆角：小控件 6px、输入/卡片 10px、面板/抽屉 14px；不用胶囊形容器（chip 除外）。
- 边框：1px `--line`；hover 提升到 `--accent` 的 35% 透明，不改变尺寸。
- 阴影：`--shadow-card` 用于浮层，`--shadow-panel` 用于常驻面板；深色下阴影要轻，避免“脏边”。
- 三栏：左 1/3 星历、右 2/3 对话；顶部 60px。1280 / 1440 / 1920 无横向溢出，<1024 单列堆叠。
- 抽屉：左侧 240–260px 导轨 + 主区；主区单列流式，不因宽屏而变成多列。

## 5. Components

### 按钮

- Primary：青色实底或青色描边 + 深色文字；只用于“下一步 / 开始求解 / 生成报告”。
- Ghost：透明底 + `--line` 边框；用于“上一步 / 调整参数 / 取消”。
- 危险：仅用于删除/中断，默认不出现。
- 所有按钮高度 ≥ 36px，触控目标 ≥ 40px；focus-visible 用 2px 青色外描边。

### 面板 / 卡片

- 背景 `--panel`，1px `--line`，圆角 14px；标题 16px，正文 14px，辅助 13px。
- 卡片内边距 16–20px；卡片之间 16px；不嵌套超过两层。

### 表单

- Label 13px `--muted`；输入 14px、高 40px、背景 `--panel-2`。
- 错误文案紧贴字段下方，红色；不要用 placeholder 代替 label。

### 进度（成图抽屉）

- 结构：阶段列表 + 进度条 + 当前阶段文案 + 已用时间。
- 阶段：读取卫星/TLE → 网格 → 传播与过境机会（`N/总数`）→ 云量（开启时）→ 选星（贪心 1/2、ILP 2/2）→ 指标 → 回放。
- 已完成用勾，当前用青色描边 + spinner，未开始灰；**不显示 ETA**。
- 进度条 6px 高、圆角 999px、青色渐变；`transition: width 400ms ease`。

### 报告

- 左侧 288px 目录 + 主区；主区单列。
- 首屏：标题 → KPI 条（4 格）→ 窗口上下文 → 四节。
- 地图 `width:100%`、`aspect-ratio:16/9`，回放轴与图例随容器铺满；不再有 `max-width:780px`。
- 表格 15px，行高 ≥44px；长表横向滚动，不压缩字号。
- 未达标：标题“未达标，全目录上限 X%”，KPI 显示实际达标面积与全目录上限，正文给放宽建议。

### 状态

- 空态：一句解释 + 一个主操作，不用插画。
- 错误：`--danger` 边框 + 可读原因 + 重试/返回。
- 加载：骨架或 spinner + 文案；超过 2s 必须说明当前在做什么。

## 6. Motion

- 进入/退出：160–240ms `ease-out`；抽屉 220ms，overlay 180ms。
- 进度条宽度 400ms；spinner 800ms 线性。
- 不使用视差、自动播放的装饰动画；尊重 `prefers-reduced-motion`。

## 7. Themes

- 应用只有深色主题；不要新增浅色应用主题，除非同时提供全站对比度与地图配色方案。
- 报告有深/浅两套；切换只改 CSS 变量，不重绘布局。打印/PDF 强制浅色，避免整页深底。

## 8. Accessibility

- 可读正文 ≥12px（应用）/15px（报告）；不使用 `zoom` 或 `transform: scale()` 放大文字。
- 文字与背景对比度 ≥4.5:1；辅助文字不低于 4.5:1（必要时提高 `--muted`）。
- 键盘可达：Tab 顺序符合视觉顺序，焦点可见；ESC 关闭抽屉；抽屉打开时锁 `body` 滚动。
- 图表不只靠颜色：报告图例带卫星名，地图点/图例成对出现；颜色不足时用文字标签兜底。
- 所有图标按钮带 `aria-label`；进度用 `role="status" aria-live="polite"`。

## 9. Do / Don't

- Do：用等宽字体排数字；用留白分组；用一条边框代替一块阴影；让 KPI 数字比标签大两档。
- Do：先保证 1280 宽的可读性，再考虑 1920 的舒展。
- Don't：把 10–11px 用作正文；用颜色单独表达“可行/不可行”；在抽屉里再套抽屉；用渐变文字。
- Don't：为了“科技感”加发光、噪点、扫描线；这些会和地球影像抢注意力。

## 10. Implementation Notes

- 应用 token 在 `web/src/styles.css` 的 `:root`；报告 token 在 `../RS-Service/src/rs_service/report/report.html.j2` 的 `:root` / `:root[data-theme="light"]`。
- 字号下限已统一：应用 <12px 的声明全部提升到 12px；报告正文 15px、辅助 14px。
- 新组件优先复用 `plan-*`、`history-*`、`agent-*` 的既有类；新增类必须在本文件登记用途。
- 改动界面后跑 `cd web && pnpm build`，并在 1280 / 1440 / 1920 三档检查无横向溢出。
