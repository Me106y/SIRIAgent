import ReactDOM from "react-dom/client";
import "cesium/Build/Cesium/Widgets/widgets.css";

import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
