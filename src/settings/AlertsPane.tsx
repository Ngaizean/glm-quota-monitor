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

export default function AlertsPane() {
  const [rules, setRules] = useState([
    { id: "token_5h", label: "5h 窗口超过阈值", desc: "Token 使用率告警", threshold: 80, enabled: true },
    { id: "weekly", label: "周额度超过阈值", desc: "每周配额告警", threshold: 90, enabled: true },
    { id: "mcp_monthly", label: "MCP 月度超过阈值", desc: "MCP 调用告警", threshold: 90, enabled: true },
  ]);

  useEffect(() => {
    for (const rule of rules) {
      invoke<string | null>("get_setting", { key: `alert_${rule.id}_threshold` }).then((v) => {
        if (v) setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, threshold: Number(v) } : r));
      });
      invoke<string | null>("get_setting", { key: `alert_${rule.id}_enabled` }).then((v) => {
        if (v !== null) setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: v === "1" } : r));
      });
    }
  }, []);

  function toggleRule(id: string) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const enabled = !r.enabled;
        invoke("set_setting", { key: `alert_${id}_enabled`, value: enabled ? "1" : "0" });
        return { ...r, enabled };
      }),
    );
  }

  function setThreshold(id: string, value: number) {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        invoke("set_setting", { key: `alert_${id}_threshold`, value: String(value) });
        return { ...r, threshold: value };
      }),
    );
  }

  return (
    <div className="space-y-2.5">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className={`bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3 transition-all duration-200 ${
            !rule.enabled ? "opacity-50" : ""
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-[var(--color-text-primary)]">{rule.label}</div>
              <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                超过 <span className="font-semibold text-[var(--color-accent)] tabular-nums">{rule.threshold}%</span> 时通知
              </div>
            </div>
            <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.id)} />
          </div>
          <div className="space-y-1.5">
            <input
              type="range"
              min={50}
              max={100}
              value={rule.threshold}
              onChange={(e) => setThreshold(rule.id, Number(e.target.value))}
              disabled={!rule.enabled}
              className="w-full disabled:opacity-30"
            />
            <div className="flex justify-between text-[9px] text-[var(--color-text-tertiary)]">
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
