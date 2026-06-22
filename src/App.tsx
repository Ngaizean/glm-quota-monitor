import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Popover from "./popover/Popover";
import Settings from "./settings/Settings";

function App() {
  const [page, setPage] = useState<"quota" | "settings">("quota");
  const containerRef = useRef<HTMLDivElement>(null);
  const SCREEN_H = useMemo(() => window.screen.availHeight, []);

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
  }, [SCREEN_H]);

  return (
    <div ref={containerRef}>
      <div key={page} className="animate-fade-in">
        {page === "quota" && (
          <Popover onOpenSettings={handleOpenSettings} screenHeight={SCREEN_H} />
        )}
        {page === "settings" && (
          <Settings onBack={handleBack} screenHeight={SCREEN_H} />
        )}
      </div>
    </div>
  );
}

export default App;
