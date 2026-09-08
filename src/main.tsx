import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import "./index.css";
import { installPreviewInvoke } from "./dev/previewInvoke";
import { initializeAppearance } from "./lib/theme";

installPreviewInvoke();
initializeAppearance();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
