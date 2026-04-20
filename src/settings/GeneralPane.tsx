import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Toggle from "../lib/Toggle";

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
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-primary)] block">刷新间隔</span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">自动更新额度数据</span>
          </div>
          <span className="text-[12px] font-bold tabular-nums text-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-0.5 rounded-md">
            {refreshInterval} min
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={30}
          value={refreshInterval}
          onChange={(e) => handleIntervalChange(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-[var(--color-text-tertiary)]">
          <span>1 min</span>
          <span>30 min</span>
        </div>
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[var(--color-text-primary)] block">开机自启</span>
          <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
            登录时自动启动应用
          </span>
        </div>
        <Toggle checked={autoStart} onChange={handleAutoStartToggle} />
      </div>
    </div>
  );
}
