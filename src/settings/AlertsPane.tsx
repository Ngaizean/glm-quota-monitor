import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Toggle from "../lib/Toggle";

interface AlertRule {
  id: number;
  rule_type: string;
  threshold: number;
  enabled: boolean;
}

const IDLE_PRESETS = [
  { labelKey: "spinPane.presets.30min", value: 30 },
  { labelKey: "spinPane.presets.1h", value: 60 },
  { labelKey: "spinPane.presets.2h", value: 120 },
  { labelKey: "spinPane.presets.4h", value: 240 },
  { labelKey: "spinPane.presets.8h", value: 480 },
];

export default function AlertsPane() {
  const { t } = useTranslation();
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
    if (mins < 60) return `${mins} ${t('alertsPane.minutes')}`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h} ${t('alertsPane.hours')} ${m} ${t('alertsPane.minutes')}` : `${h} ${t('alertsPane.hours')}`;
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
                    ? t('alertsPane.token5h')
                    : rule.rule_type === "mcp_monthly"
                      ? t('alertsPane.mcpMonthly')
                      : t('alertsPane.idleAccount')}
                </div>
                <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">
                  {rule.rule_type === "token_5h"
                    ? t('alertsPane.token5hDesc')
                    : rule.rule_type === "mcp_monthly"
                      ? t('alertsPane.mcpMonthlyDesc')
                      : t('alertsPane.idleAccountDesc')}
                </div>
              </div>
              <Toggle checked={rule.enabled} onChange={() => toggleRule(rule.rule_type)} />
            </div>

            {isIdle ? (
              /* 空闲时间预设按钮 */
              <div className="space-y-2">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  {t('alertsPane.idleNotifyAfter', { time: formatIdleMins(rule.threshold) })}
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
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* 百分比滑块 */
              <div className="space-y-1.5">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  {t('alertsPane.notifyAbove', { threshold: rule.threshold })}
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
