import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export default function GeneralPane() {
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [autoStart, setAutoStart] = useState(true);

  useEffect(() => {
    invoke<string | null>("get_setting", { key: "refresh_interval" }).then((v) => {
      if (v) setRefreshInterval(Number(v));
    });
    invoke<string | null>("get_setting", { key: "auto_start" }).then((v) => {
      if (v !== null) setAutoStart(v === "1");
    });
  }, []);

  function handleIntervalChange(val: number) {
    setRefreshInterval(val);
    invoke("set_setting", { key: "refresh_interval", value: String(val) });
  }

  function handleAutoStartToggle() {
    const val = !autoStart;
    setAutoStart(val);
    invoke("set_setting", { key: "auto_start", value: val ? "1" : "0" });
  }

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-700">通用设置</h2>

      <div className="bg-gray-50 rounded-lg p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-700">刷新间隔</span>
          <span className="text-[10px] text-gray-400">{refreshInterval} 分钟</span>
        </div>
        <input type="range" min={1} max={30} value={refreshInterval}
          onChange={(e) => handleIntervalChange(Number(e.target.value))}
          className="w-full accent-blue-500 h-1" />
        <div className="flex justify-between text-[9px] text-gray-300 mt-0.5">
          <span>1min</span><span>30min</span>
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-2.5 flex items-center justify-between">
        <span className="text-xs text-gray-700">开机自启</span>
        <button onClick={handleAutoStartToggle}
          className={`w-8 h-4.5 rounded-full transition-colors relative ${autoStart ? "bg-blue-500" : "bg-gray-300"}`}>
          <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${autoStart ? "left-[14px]" : "left-0.5"}`} />
        </button>
      </div>
    </div>
  );
}
