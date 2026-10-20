export interface AmapConfig {
  key: string;
  security?: string;
}

let pending: Promise<any> | null = null;

/** 按需加载高德 JS API 2.0（只想用地图与绘制，不涉及 Web 服务）。 */
export function loadAmap(config: AmapConfig): Promise<any> {
  const global = window as unknown as { AMap?: any; _AMapSecurityConfig?: unknown };
  if (global.AMap) return Promise.resolve(global.AMap);
  if (!config.key) return Promise.reject(new Error("缺少高德 JS API key"));
  if (config.security) {
    global._AMapSecurityConfig = { securityJsCode: config.security };
  }
  if (pending) return pending;

  pending = new Promise<any>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key)}`;
    script.async = true;
    script.onload = () => {
      if (global.AMap) resolve(global.AMap);
      else reject(new Error("高德脚本已加载但没有 AMap"));
    };
    script.onerror = () => reject(new Error("高德脚本加载失败"));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pending = null;
    throw error;
  });
  return pending;
}

export function loadAmapPlugin(AMap: any, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    AMap.plugin([name], () => resolve(), (error: unknown) => reject(error));
  });
}
