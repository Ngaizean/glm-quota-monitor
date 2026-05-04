import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Toggle from "../lib/Toggle";

interface AlertRule {
  id: number;
  rule_type: string;
  threshold: number;
  enabled: boolean;
}

const IDLE_PRESETS = [
  { label: "30分", value: 30 },
  { label: "1时", value: 60 },
  { label: "2时", value: 120 },
  { label: "4时", value: 240 },
  { label: "8时", value: 480 },
];

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

  function formatIdleMins(mins: number): string {
    if (mins < 60) return `${mins} 分钟`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  }

  function closestPreset(mins: number): number {
    return IDLE_PRESETS.reduce((prev, curr) =>
      Math.abs(curr.value - mins) < Math.abs(prev.value - mins) ? curr : prev
    ).value;
  }

  return (
    <div className="space-y-2.5">
      {rules.map((rule) => {
        const isIdle = rule.rule_type === "idle_account";
        return (
          <div
            key={rule.rule_type}
            className={`bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3 transition-all duration-200 ${
              !rule.enabled ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-[var(--color-text-primary)]">
                  {rule.rule_type === "token_5h"
                    ? "5h 额度预警"
                    : rule.rule_type === "mcp_monthly"
                      ? "月度 MCP 额度预警"
                      : "空闲账号提醒"}
                </div>
                <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                  {rule.rule_type === "token_5h"
                    ? "5 小时窗口 Token 使用率告警"
                    : rule.rule_type === "mcp_monthly"
                      ? "月度 MCP 调用额度告警"
                      : "账号长时间未使用时提醒"}
                </div>
              </div>
              <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.rule_type)} />
            </div>

            {isIdle ? (
              /* 空闲时间预设按钮 */
              <div className="space-y-2">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  空闲超过{" "}
                  <span className="font-semibold text-[var(--color-accent)]">
                    {formatIdleMins(rule.threshold)}
                  </span>{" "}
                  时通知
                </div>
                <div className="flex gap-1.5">
                  {IDLE_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      disabled={!rule.enabled}
                      onClick={() => setThreshold(rule.rule_type, p.value)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200 ${
                        closestPreset(rule.threshold) === p.value
                          ? "bg-[var(--color-accent)] text-white shadow-sm"
                          : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                      } disabled:opacity-30`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* 百分比滑块 */
              <div className="space-y-1.5">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  超过{" "}
                  <span className="font-semibold text-[var(--color-accent)] tabular-nums">
                    {rule.threshold}%
                  </span>{" "}
                  时通知
                </div>
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
            )}
          </div>
        );
      })}
    </div>
  );
}
