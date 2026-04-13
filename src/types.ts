export interface Account {
  id: string;
  alias: string;
  purpose: string;
  level: string | null;
  is_active: boolean;
}

export interface QuotaLimit {
  type: string;
  percentage: number;
  nextResetTime: number;
}

export interface QuotaData {
  limits: QuotaLimit[];
  level: string;
}

export interface PeriodSummary {
  period_label: string;
  snapshot_count: number;
  avg_token_limit_pct: number | null;
  peak_token_limit_pct: number | null;
  avg_time_limit_pct: number | null;
  peak_time_limit_pct: number | null;
}

export interface UsageSummaryData {
  today: PeriodSummary;
  last_7d: PeriodSummary;
  last_30d: PeriodSummary;
}
