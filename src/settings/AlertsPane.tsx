import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Toggle from "../lib/Toggle";
import type { Account } from "../types";

interface AlertRule {
  id: number;
  rule_type: string;
  threshold: number;
  enabled: boolean;
  account_id: string | null;
  dedupe_window_mins: number;
}

const RULE_TYPES = ["token_5h", "mcp_monthly", "reset_soon", "idle_account"] as const;
const PERCENT_RULES = new Set(["token_5h", "mcp_monthly"]);

const IDLE_PRESETS = [30, 60, 120, 240, 480];
const RESET_PRESETS = [5, 10, 15, 30, 60];
const DEDUPE_PRESETS = [30, 60, 120, 240];

export default function AlertsPane() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null = 全局默认
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    invoke<Account[]>("list_accounts").then(setAccounts).catch(() => setAccounts([]));
    invoke<boolean>("get_alert_muted").then(setMuted).catch(() => setMuted(false));
  }, []);

  useEffect(() => {
    invoke<AlertRule[]>("get_alert_rules", { accountId: selectedId })
      .then(setRules)
      .catch(() => setRules([]));
  }, [selectedId]);

  // 合并：账号级覆盖优先于全局
  const effective = new Map<string, AlertRule>();
  for (const r of rules) if (r.account_id == null) effective.set(r.rule_type, r);
  for (const r of rules) if (r.account_id != null) effective.set(r.rule_type, r);
  const overrides = new Set(
    rules.filter((r) => r.account_id != null && r.account_id === selectedId).map((r) => r.rule_type)
  );

  function ruleTitle(rt: string): string {
    switch (rt) {
      case "token_5h": return t("alertsPane.token5h");
      case "mcp_monthly": return t("alertsPane.mcpMonthly");
      case "reset_soon": return t("alertsPane.resetSoon");
      default: return t("alertsPane.idleAccount");
    }
  }
  function ruleDesc(rt: string): string {
    switch (rt) {
      case "token_5h": return t("alertsPane.token5hDesc");
      case "mcp_monthly": return t("alertsPane.mcpMonthlyDesc");
      case "reset_soon": return t("alertsPane.resetSoonDesc");
      default: return t("alertsPane.idleAccountDesc");
    }
  }

  function formatMins(mins: number): string {
    if (mins < 60) return `${mins} ${t("alertsPane.minutes")}`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0
      ? `${h} ${t("alertsPane.hours")} ${m} ${t("alertsPane.minutes")}`
      : `${h} ${t("alertsPane.hours")}`;
  }

  function update(
    rt: string,
    patch: Partial<Pick<AlertRule, "threshold" | "enabled" | "dedupe_window_mins">>
  ) {
    // 乐观更新：更新选中层（全局或账号）对应行；首次为账号创建覆盖时基于全局克隆
    setRules((prev) => {
      const idx = prev.findIndex((r) => r.rule_type === rt && r.account_id === selectedId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...patch };
        return next;
      }
      if (selectedId !== null) {
        const base = prev.find((r) => r.rule_type === rt && r.account_id === null);
        if (base) return [...prev, { ...base, ...patch, account_id: selectedId, id: -Date.now() }];
      }
      return prev;
    });
    invoke("update_alert_rule", {
      ruleType: rt,
      threshold: patch.threshold ?? null,
      enabled: patch.enabled ?? null,
      dedupeWindowMins: patch.dedupe_window_mins ?? null,
      accountId: selectedId,
    }).catch((e) => {
      console.error(e);
      invoke<AlertRule[]>("get_alert_rules", { accountId: selectedId }).then(setRules);
    });
  }

  function resetToGlobal() {
    if (!selectedId) return;
    invoke("reset_account_overrides", { accountId: selectedId })
      .then(() => invoke<AlertRule[]>("get_alert_rules", { accountId: selectedId }).then(setRules))
      .catch(console.error);
  }

  function toggleMute() {
    setMuted((prev) => {
      const v = !prev;
      invoke("set_alert_muted", { muted: v }).catch(console.error);
      return v;
    });
  }

  const isAccount = selectedId !== null;
  const selectedAccount = accounts.find((a) => a.id === selectedId);

  return (
    <div className="space-y-2.5">
      {/* 全局静音 */}
      <div className="flex items-center justify-between bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] px-3.5 py-2.5">
        <div>
          <div className="text-xs font-medium text-[var(--color-text-primary)]">{t("alertsPane.muteAll")}</div>
          <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">{t("alertsPane.muteAllDesc")}</div>
        </div>
        <Toggle checked={muted} onChange={toggleMute} />
      </div>

      {/* 账号选择器 */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setSelectedId(null)}
          className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
            selectedId === null
              ? "bg-[var(--color-accent)] text-white"
              : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {t("alertsPane.globalDefault")}
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => setSelectedId(a.id)}
            title={a.alias}
            className={`shrink-0 max-w-[120px] truncate px-2.5 py-1 rounded-lg text-[10px] font-medium transition-colors ${
              selectedId === a.id
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            {a.alias}
          </button>
        ))}
      </div>

      {isAccount && (
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-[var(--color-text-tertiary)]">
            {t("alertsPane.editingAccount", { name: selectedAccount?.alias ?? "" })}
          </div>
          <button
            onClick={resetToGlobal}
            disabled={overrides.size === 0}
            className="text-[10px] text-[var(--color-accent)] disabled:opacity-30 hover:underline"
          >
            {t("alertsPane.resetToGlobal")}
          </button>
        </div>
      )}

      {/* 规则列表 */}
      {RULE_TYPES.map((rt) => {
        const rule = effective.get(rt);
        if (!rule) return null;
        const percent = PERCENT_RULES.has(rt);
        const isReset = rt === "reset_soon";
        const presets = isReset ? RESET_PRESETS : IDLE_PRESETS;
        return (
          <div
            key={rt}
            className={`bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3 transition-all duration-200 ${
              !rule.enabled ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-medium text-[var(--color-text-primary)]">{ruleTitle(rt)}</div>
                <div className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5">{ruleDesc(rt)}</div>
              </div>
              <Toggle checked={rule.enabled} onChange={() => update(rt, { enabled: !rule.enabled })} />
            </div>

            {percent ? (
              <div className="space-y-1.5">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  {t("alertsPane.notifyAbove", { threshold: rule.threshold })}
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  value={rule.threshold}
                  onChange={(e) => update(rt, { threshold: Number(e.target.value) })}
                  disabled={!rule.enabled}
                  className="w-full disabled:opacity-30"
                />
                <div className="flex justify-between text-[9px] text-[var(--color-text-tertiary)]">
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] text-[var(--color-text-tertiary)]">
                  {isReset
                    ? t("alertsPane.notifyBefore", { time: formatMins(rule.threshold) })
                    : t("alertsPane.idleNotifyAfter", { time: formatMins(rule.threshold) })}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {presets.map((v) => (
                    <button
                      key={v}
                      disabled={!rule.enabled}
                      onClick={() => update(rt, { threshold: v })}
                      className={`flex-1 min-w-[44px] py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200 ${
                        rule.threshold === v
                          ? "bg-[var(--color-accent)] text-white shadow-sm"
                          : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                      } disabled:opacity-30`}
                    >
                      {formatMins(v)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 去重窗口 */}
            <div className="pt-1 border-t border-[var(--color-border-subtle)]">
              <div className="text-[9px] text-[var(--color-text-tertiary)] mb-1">
                {t("alertsPane.dedupeWindow")} · {formatMins(rule.dedupe_window_mins)}
              </div>
              <div className="flex gap-1.5">
                {DEDUPE_PRESETS.map((v) => (
                  <button
                    key={v}
                    disabled={!rule.enabled}
                    onClick={() => update(rt, { dedupe_window_mins: v })}
                    className={`flex-1 py-1 rounded-lg text-[9px] font-medium transition-all duration-200 ${
                      rule.dedupe_window_mins === v
                        ? "bg-[var(--color-accent)]/70 text-white"
                        : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                    } disabled:opacity-30`}
                  >
                    {formatMins(v)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
