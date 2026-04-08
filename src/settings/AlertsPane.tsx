import { useState } from "react";

export default function AlertsPane() {
  const [rules, setRules] = useState([
    { id: "token_5h", label: "5h 窗口超过阈值", threshold: 80, enabled: true },
    { id: "weekly", label: "周额度超过阈值", threshold: 90, enabled: true },
    { id: "mcp_monthly", label: "MCP 月度超过阈值", threshold: 90, enabled: true },
  ]);

  function toggleRule(id: string) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }

  function setThreshold(id: string, value: number) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, threshold: value } : r)),
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">预警设置</h2>
      <div className="space-y-3">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="bg-neutral-800 rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm">{rule.label}</span>
              <button
                onClick={() => toggleRule(rule.id)}
                className={`w-9 h-5 rounded-full transition-colors relative ${
                  rule.enabled ? "bg-blue-600" : "bg-neutral-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    rule.enabled ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={100}
                value={rule.threshold}
                onChange={(e) => setThreshold(rule.id, Number(e.target.value))}
                disabled={!rule.enabled}
                className="flex-1 accent-blue-500"
              />
              <span className="text-xs text-neutral-400 w-8 text-right">
                {rule.threshold}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
