import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export default function AlertsPane() {
  const [rules, setRules] = useState([
    { id: "token_5h", label: "5h 窗口超过阈值", threshold: 80, enabled: true },
    { id: "weekly", label: "周额度超过阈值", threshold: 90, enabled: true },
    { id: "mcp_monthly", label: "MCP 月度超过阈值", threshold: 90, enabled: true },
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
    <div className="space-y-3">
      <h2 className="text-xs font-semibold text-gray-700">预警设置</h2>
      <div className="space-y-2">
        {rules.map((rule) => (
          <div key={rule.id} className="bg-gray-50 rounded-lg p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-700">{rule.label}</span>
              <button
                onClick={() => toggleRule(rule.id)}
                className={`w-8 h-4.5 rounded-full transition-colors relative ${rule.enabled ? "bg-blue-500" : "bg-gray-300"}`}
              >
                <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${rule.enabled ? "left-[14px]" : "left-0.5"}`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input type="range" min={50} max={100} value={rule.threshold}
                onChange={(e) => setThreshold(rule.id, Number(e.target.value))}
                disabled={!rule.enabled}
                className="flex-1 accent-blue-500 h-1" />
              <span className="text-[10px] text-gray-400 w-7 text-right">{rule.threshold}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
