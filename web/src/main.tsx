import ReactDOM from "react-dom/client";
import "cesium/Build/Cesium/Widgets/widgets.css";

import App from "./App";
import { PurchasePage } from "./pages/PurchasePage";
import "./styles.css";

function Root() {
  const match = window.location.pathname.match(/^\/purchase\/([^/]+)\/?$/);
  if (match) {
    return <PurchasePage purchaseId={decodeURIComponent(match[1])} />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);

/**
 * Service Worker 自动更新：
 * - sw.js 每次构建都会被 vite 插件改写 VERSION，浏览器因此能发现新版本；
 * - 新 SW 装好后立刻 skipWaiting + clients.claim，接管当前页面；
 * - 接管发生时重载一次，用户看到的就是新版本，不用手动清缓存。
 * 只重载一次，避免 controllerchange 抖动导致刷新循环。
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw")
      .then((registration) => {
        // 回到前台时再探一次，长驻标签页也能及时升级。
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            registration.update().catch(() => undefined);
          }
        });
      })
      .catch(() => undefined);
  });
}
