import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import Popover from "./popover/Popover";
import Settings from "./settings/Settings";

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("");

  useEffect(() => {
    setWindowLabel(getCurrentWindow().label);
  }, []);

  if (!windowLabel) return null;

  if (windowLabel === "settings") {
    return <Settings />;
  }

  // 默认 popover
  return <Popover />;
}

export default App;
