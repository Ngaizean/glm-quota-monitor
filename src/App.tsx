import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import Popover from "./popover/Popover";
import Settings from "./settings/Settings";

const SCREEN_H = window.screen.availHeight;

function App() {
  const [page, setPage] = useState<"quota" | "settings">("quota");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleOpenSettings = useCallback(() => setPage("settings"), []);
  const handleBack = useCallback(() => setPage("quota"), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let pending = false;
    const observer = new ResizeObserver(([entry]) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const h = entry.contentRect.height;
        invoke("fit_window_size", { height: Math.min(h, SCREEN_H) });
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef}>
      <div style={{ display: page === "quota" ? "block" : "none" }}>
        <Popover onOpenSettings={handleOpenSettings} screenHeight={SCREEN_H} />
      </div>
      <div style={{ display: page === "settings" ? "block" : "none" }}>
        <Settings onBack={handleBack} screenHeight={SCREEN_H} />
      </div>
    </div>
  );
}

export default App;
