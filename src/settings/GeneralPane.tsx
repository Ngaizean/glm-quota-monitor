import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative w-9 h-5 rounded-full transition-colors duration-200 shrink-0 ${
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-bg-tertiary)]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

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
      <div className="bg-[var(--color-bg-secondary)] rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-text-primary)]">刷新间隔</span>
          <span className="text-[11px] font-semibold tabular-nums text-[var(--color-accent)]">
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
          <span>1min</span>
          <span>30min</span>
        </div>
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-[var(--radius-md)] border border-[var(--color-border-subtle)] p-3 flex items-center justify-between">
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
