export interface Account {
  id: string;
  alias: string;
  purpose: string;
  level: string | null;
  is_active: boolean;
  is_primary: boolean;
}

export interface QuotaLimit {
  type: string;
  percentage: number;
  nextResetTime: number;
}

export interface QuotaData {
  limits: QuotaLimit[];
  level: string | null;
  last_active: string | null;
}

export interface TokenUsagePeriod {
  label: string;
  /** Token 总用量 */
  total_tokens: number;
  /** 模型调用次数 */
  total_calls: number;
}

export interface TokenUsageSummary {
  today: TokenUsagePeriod;
  last_7d: TokenUsagePeriod;
  last_30d: TokenUsagePeriod;
}

export interface AgentBinding {
  agent: "claude_code" | "openclaw";
  account_id: string | null;
  label: string;
}
