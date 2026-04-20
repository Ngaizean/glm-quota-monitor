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

  if (page === "settings") {
    return (
      <div ref={containerRef}>
        <Settings onBack={handleBack} screenHeight={SCREEN_H} />
      </div>
    );
  }
  return (
    <div ref={containerRef}>
      <Popover onOpenSettings={handleOpenSettings} screenHeight={SCREEN_H} />
    </div>
  );
}

export default App;
