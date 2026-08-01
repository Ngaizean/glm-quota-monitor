export interface Account {
  id: string;
  alias: string;
  purpose: string;
  platform?: string;
  level: string | null;
  is_active: boolean;
  is_primary: boolean;
}

export type QuotaLimitType = "TIME_LIMIT" | "TOKENS_LIMIT" | "MCP_MONTHLY" | "DEEPSEEK_BALANCE" | (string & {});

export interface QuotaLimit {
  type: QuotaLimitType;
  percentage: number;
  nextResetTime: number;
  /** 已用量（绝对值） */
  usage?: number;
  /** 总量（绝对值） */
  number?: number;
  /** 剩余量 */
  remaining?: number;
  /** 单位（如次数/token） */
  unit?: number;
  /** 当前值（部分额度返回） */
  currentValue?: number;
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
  mcp_pct: number;
  tokens_24h: number | null;
  calls: number | null;
}

// ========== DeepSeek（绝对货币余额，非百分比；独立于 GLM/Codex 的百分比通路）==========
export interface DeepSeekBalanceEntry {
  currency: string;
  total: number;
  granted: number;
  toppedUp: number;
}

export interface DeepSeekBalanceView {
  isAvailable: boolean;
  balances: DeepSeekBalanceEntry[];
  models: string[];
  level: string | null;
  lastActive: string | null;
  error?: string | null;
  isOffline?: boolean;
}

export interface DeepSeekBalancePoint {
  timestamp: string;
  currency: string;
  totalBalance: number;
  grantedBalance: number;
  toppedUpBalance: number;
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
  unit_price: number;
  weighted: boolean;
}

export interface ToolUsageItem {
  tool: string;
  count: number;
}

export interface ToolUsageData {
  toolUsage: ToolUsageItem[];
}
