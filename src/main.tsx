import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const isSettingsWindow = getCurrentWindow().label === "settings";

if (isSettingsWindow) {
  document.body.dataset.window = "settings";
}

const Settings = React.lazy(() => import("./Settings"));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettingsWindow ? (
      <React.Suspense fallback={null}>
        <Settings />
      </React.Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
