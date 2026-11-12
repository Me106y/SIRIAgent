import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";
import fs from "node:fs";
import path from "node:path";

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

/**
 * 构建时把 public/sw.js 里的 __SW_VERSION__ 换成构建时间戳。
 * 每次发版 SW 字节都会变，浏览器才会重新 install/activate 并清掉旧缓存，
 * 用户不必手动「清缓存」。放在 writeBundle 阶段，覆盖 public 目录的拷贝结果。
 */
function stampServiceWorker(): Plugin {
  const version = `siria-static-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
  return {
    name: "stamp-service-worker",
    apply: "build",
    enforce: "post",
    writeBundle(options) {
      const outDir = options.dir ?? "dist";
      const swPath = path.resolve(import.meta.dirname, outDir, "sw.js");
      if (!fs.existsSync(swPath)) return;
      const stamped = fs.readFileSync(swPath, "utf8").replaceAll("__SW_VERSION__", version);
      fs.writeFileSync(swPath, stamped);
    },
  };
}

export default defineConfig({
  plugins: [react(), cesium(), stripCesiumTags(), stampServiceWorker()],
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
