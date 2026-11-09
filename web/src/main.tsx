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

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw").catch(() => undefined);
  });
}
