import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Toggle from "../lib/Toggle";

interface AlertRule {
  id: number;
  rule_type: string;
  threshold: number;
  enabled: boolean;
}

const RULE_LABELS: Record<string, { label: string; desc: string }> = {
  token_5h: { label: "5h 窗口超过阈值", desc: "Token 使用率告警" },
  weekly: { label: "周额度超过阈值", desc: "每周配额告警" },
  mcp_monthly: { label: "MCP 月度超过阈值", desc: "MCP 调用告警" },
};

export default function AlertsPane() {
  const [rules, setRules] = useState<AlertRule[]>([]);

  useEffect(() => {
    invoke<AlertRule[]>("get_alert_rules").then(setRules).catch(console.error);
  }, []);

  function toggleRule(ruleType: string) {
    const rule = rules.find((r) => r.rule_type === ruleType);
    if (!rule) return;
    const enabled = !rule.enabled;
    invoke("update_alert_rule", { ruleType, enabled })
      .then(() => setRules((prev) => prev.map((r) => (r.rule_type === ruleType ? { ...r, enabled } : r))))
      .catch(console.error);
  }

  function setThreshold(ruleType: string, value: number) {
    invoke("update_alert_rule", { ruleType, threshold: value })
      .then(() => setRules((prev) => prev.map((r) => (r.rule_type === ruleType ? { ...r, threshold: value } : r))))
      .catch(console.error);
  }

  return (
    <div className="space-y-2.5">
      {rules.map((rule) => {
        const meta = RULE_LABELS[rule.rule_type] || { label: rule.rule_type, desc: "" };
        return (
          <div
            key={rule.rule_type}
            className={`bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3 transition-all duration-200 ${
              !rule.enabled ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-[var(--color-text-primary)]">{meta.label}</div>
                <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                  超过 <span className="font-semibold text-[var(--color-accent)] tabular-nums">{rule.threshold}%</span>{" "}
                  时通知
                </div>
              </div>
              <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.rule_type)} />
            </div>
            <div className="space-y-1.5">
              <input
                type="range"
                min={50}
                max={100}
                value={rule.threshold}
                onChange={(e) => setThreshold(rule.rule_type, Number(e.target.value))}
                disabled={!rule.enabled}
                className="w-full disabled:opacity-30"
              />
              <div className="flex justify-between text-[9px] text-[var(--color-text-tertiary)]">
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
