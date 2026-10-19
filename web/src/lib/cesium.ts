export type CesiumNamespace = typeof import("cesium");

declare global {
  interface Window {
    Cesium?: CesiumNamespace;
  }
}

const CESIUM_SCRIPT = "/cesium/Cesium.js";

let pending: Promise<CesiumNamespace> | null = null;

/**
 * 按需加载 Cesium：首屏先渲染目录与面板，地球组件在浏览器空闲时才拉 1.7 MB 的运行时。
 * 脚本本身是 Cesium 官方全局构建，加载一次后复用 window.Cesium。
 */
export function loadCesium(): Promise<CesiumNamespace> {
  if (pending) return pending;

  const existing = window.Cesium;
  if (existing) {
    pending = Promise.resolve(existing);
    return pending;
  }

  pending = new Promise<CesiumNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CESIUM_SCRIPT;
    script.async = true;
    script.dataset.cesiumRuntime = "true";
    script.onload = () => {
      if (window.Cesium) resolve(window.Cesium);
      else reject(new Error("Cesium global missing"));
    };
    script.onerror = () => reject(new Error("Cesium script failed"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // 失败时清掉缓存，允许用户下一次重试。
    pending = null;
    throw error;
  });

  return pending;
}
