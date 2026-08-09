export const ALERT_RULE_TYPES = ["token_5h", "mcp_monthly", "reset_soon", "idle_account"] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export interface AlertRule {
  id: number;
  rule_type: AlertRuleType;
  threshold: number;
  enabled: boolean;
  account_id: string | null;
  dedupe_window_mins: number;
}

export type AlertRulePatch = Partial<Pick<AlertRule, "threshold" | "enabled" | "dedupe_window_mins">>;
