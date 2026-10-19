import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";

/**
 * Cesium 运行时改为在 Globe 组件里按需注入（见 web/src/lib/cesium.ts），
 * 这里把插件自动注入的阻塞式 <script>/<link> 去掉，首屏不再等 1.7 MB 的 Cesium.js。
 * widgets.css 已由 main.tsx 打进主 CSS，无需重复的 <link>。
 */
function stripCesiumTags(): Plugin {
  return {
    name: "strip-cesium-tags",
    enforce: "post",
    transformIndexHtml(html: string) {
      return html
        .replace(/\s*<script[^>]*src="[^"]*\/Cesium\.js"[^>]*><\/script>/g, "")
        .replace(/\s*<link[^>]*href="[^"]*\/widgets\.css"[^>]*>/g, "");
    },
  };
}

export default defineConfig({
  plugins: [react(), cesium(), stripCesiumTags()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 5000,
  },
});
