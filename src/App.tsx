import { useState, useCallback } from "react";
import Popover from "./popover/Popover";
import Settings from "./settings/Settings";

function App() {
  const [page, setPage] = useState<"quota" | "settings">("quota");

  const handleOpenSettings = useCallback(() => setPage("settings"), []);
  const handleBack = useCallback(() => setPage("quota"), []);

  if (page === "settings") {
    return <Settings onBack={handleBack} />;
  }

  return <Popover onOpenSettings={handleOpenSettings} />;
}

export default App;
