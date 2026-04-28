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
  error?: string | null;
  is_offline?: boolean;
}

export interface TokenHistoryPoint {
  timestamp: string;
  token_pct: number;
  time_pct: number;
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

export interface CostEstimate {
  today_cost: number;
  cost_7d: number;
  cost_30d: number;
  plan_price: number;
  daily_avg: number;
  ratio: number;
}
