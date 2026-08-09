import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowLayout } from "./hooks/useWindowLayout";
import { getPreviewPage, isTauriRuntime } from "./lib/runtime";
import Popover from "./popover/Popover";
import Settings from "./settings/Settings";

type AppPage = "quota" | "settings";

const PAGE_WIDTH: Record<AppPage, number> = {
  quota: 420,
  settings: 760,
};

function App() {
  const [page, setPage] = useState<AppPage>(() => getPreviewPage() ?? "quota");
  const containerRef = useRef<HTMLDivElement>(null);
  const [screenHeight, setScreenHeight] = useState(() => window.screen.availHeight);

  const handleOpenSettings = useCallback(() => setPage("settings"), []);
  const handleBack = useCallback(() => setPage("quota"), []);

  useEffect(() => {
    const updateScreen = () => setScreenHeight(window.screen.availHeight);
    window.addEventListener("resize", updateScreen);
    window.addEventListener("focus", updateScreen);
    return () => {
      window.removeEventListener("resize", updateScreen);
      window.removeEventListener("focus", updateScreen);
    };
  }, []);

  useWindowLayout(containerRef, {
    width: Math.min(PAGE_WIDTH[page], Math.max(360, window.screen.availWidth - 32)),
    maxHeight: screenHeight,
    enabled: isTauriRuntime(),
    onError: (error) => console.error("failed to fit application window", error),
  });

  return (
    <div ref={containerRef}>
      <div className="app-screen animate-fade-in" data-page={page}>
        {page === "quota" && (
          <Popover onOpenSettings={handleOpenSettings} screenHeight={screenHeight} />
        )}
        {page === "settings" && (
          <Settings onBack={handleBack} screenHeight={screenHeight} />
        )}
      </div>
    </div>
  );
}

export default App;
