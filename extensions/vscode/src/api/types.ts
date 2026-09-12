// ========== API 响应类型 ==========

export interface ApiResponse<T> {
  code: number;
  msg?: string;
  data?: T;
  success: boolean;
}

// ========== 额度查询 ==========

export interface QuotaLimit {
  type: string;
  percentage: number;
  nextResetTime: number;
  unit?: number | null;
  number?: number;
  usage?: number;
  currentValue?: number;
  remaining?: number;
  usageDetails?: UsageDetail[];
}

export interface UsageDetail {
  modelCode: string;
  usage: number;
}

export interface QuotaData {
  limits: QuotaLimit[];
  level: string;
  last_active?: string;
  error?: string;
  is_offline?: boolean;
}

/** 主额度类型（5 小时/周窗口）：V2 token 制或 V3 积分制（2026-07-30 起）。 */
const PRIMARY_LIMIT_TYPES = ['TOKENS_LIMIT', 'CREDIT_LIMIT'] as const;

/** 与桌面端一致：优先 5 小时窗口（unit=3），旧数据/仅周额度时回退首个主额度窗口。 */
export function preferredTokenLimit(quota: QuotaData): QuotaLimit | undefined {
  const primary = (limit: QuotaLimit) =>
    (PRIMARY_LIMIT_TYPES as readonly string[]).includes(limit.type);
  return quota.limits.find((limit) => primary(limit) && limit.unit === 3)
    ?? quota.limits.find((limit) => primary(limit) && limit.unit == null)
    ?? quota.limits.find(primary);
}

// ========== 模型用量 ==========

export interface ModelUsageData {
  x_time: string[];
  modelCallCount: (number | null)[];
  tokensUsage: (number | null)[];
  totalUsage: TotalModelUsage;
}

export interface TotalModelUsage {
  totalModelCallCount: number;
  totalTokensUsage: number;
}

// ========== 工具用量 ==========

export interface ToolUsageData {
  toolUsage: ToolUsageItem[];
}

export interface ToolUsageItem {
  tool: string;
  count: number;
}

// ========== 模型列表 ==========

export interface ModelListResponse {
  data: ModelInfo[];
}

export interface ModelInfo {
  id: string;
}

// ========== 内部类型 ==========

export interface AccountInfo {
  id: string;
  alias: string;
  apiKey: string;
  isPrimary: boolean;
}

export interface RefreshResult {
  maxPct: number;
  quotas: Record<string, QuotaData>;
}

export interface AlertState {
  lastAlertedPct: number;
  lastAlertedTime: number;
}
