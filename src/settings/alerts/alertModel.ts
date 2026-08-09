import type { AlertRule, AlertRuleType } from "./types";

export const GLOBAL_ALERT_SCOPE = "$global";
export const PERCENT_RULES = new Set<AlertRuleType>(["token_5h", "mcp_monthly"]);
export const IDLE_PRESETS = [30, 60, 120, 240, 480] as const;
export const RESET_PRESETS = [5, 10, 15, 30, 60] as const;
export const DEDUPE_PRESETS = [30, 60, 120, 240] as const;

export function alertScopeKey(accountId: string | null): string {
  return accountId ?? GLOBAL_ALERT_SCOPE;
}

export function getEffectiveRules(rules: readonly AlertRule[]): Map<AlertRuleType, AlertRule> {
  const effective = new Map<AlertRuleType, AlertRule>();
  for (const rule of rules) if (rule.account_id === null) effective.set(rule.rule_type, rule);
  for (const rule of rules) if (rule.account_id !== null) effective.set(rule.rule_type, rule);
  return effective;
}

export function getOverrides(rules: readonly AlertRule[], accountId: string | null): Set<AlertRuleType> {
  return new Set(
    rules
      .filter((rule) => accountId !== null && rule.account_id === accountId)
      .map((rule) => rule.rule_type),
  );
}

export function patchRuleLayer(
  rules: readonly AlertRule[],
  accountId: string | null,
  ruleType: AlertRuleType,
  patch: Partial<Pick<AlertRule, "threshold" | "enabled" | "dedupe_window_mins">>,
): AlertRule[] {
  const index = rules.findIndex((rule) => rule.rule_type === ruleType && rule.account_id === accountId);
  if (index >= 0) {
    const next = [...rules];
    next[index] = { ...next[index], ...patch };
    return next;
  }
  if (accountId === null) return [...rules];
  const base = rules.find((rule) => rule.rule_type === ruleType && rule.account_id === null);
  if (!base) return [...rules];
  return [...rules, { ...base, ...patch, id: -Date.now(), account_id: accountId }];
}
