# Third-Party Notices

本仓库的源码以 MIT 发布（见 `LICENSE`）。以下第三方组件/资产随本项目使用或计划使用，版权归各自作者所有。

## 文档构建

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| [Python-Markdown](https://github.com/Python-Markdown/markdown) | BSD-3-Clause | `scripts/build_requirements_html.py` 生成 HTML 版需求文档 |

## 计划依赖（前端）

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 `@deepseek-ai/dsh-client-ui-primitives` | MIT | Markdown/KaTeX/Shiki/Diff/Terminal/JsonTree 等表现层 |
| [CesiumJS](https://github.com/CesiumGS/cesium) | Apache-2.0 | 3D 地球与卫星轨迹 |
| [satellite.js](https://github.com/shashwatak/satellite-js) | MIT | 前端 SGP4 推演 |
| [React](https://github.com/facebook/react) | MIT | 前端框架 |
| [Vite](https://github.com/vitejs/vite) | MIT | 构建工具 |

## 计划依赖（字体/资产）

| 资产 | 许可证 | 用途 |
| --- | --- | --- |
| Montserrat | SIL Open Font License 1.1 | 界面字体（若采用） |
| Natural Earth | Public Domain | Cesium 本地底图 |

## 说明

- 本项目与 DeepSeek 无隶属关系；文案使用 "built on DeepSeek Harness" 描述依赖关系，不使用其商标作为项目名。
- 若后续引入新的第三方代码或资产，在本文件追加条目，并在对应源码目录保留原始版权声明。
