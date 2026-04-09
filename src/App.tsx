import { useState } from "react";
import Popover from "./popover/Popover";
import Settings from "./settings/Settings";

function App() {
  const [page, setPage] = useState<"quota" | "settings">("quota");

  if (page === "settings") {
    return <Settings onBack={() => setPage("quota")} />;
  }

  return <Popover onOpenSettings={() => setPage("settings")} />;
}

export default App;
