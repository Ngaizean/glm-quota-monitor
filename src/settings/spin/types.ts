export interface PeakPeriod {
  start: string;
}

export interface SpinConfig {
  enabled: boolean;
  mode: string;
  peak_periods: PeakPeriod[];
  lead_minutes: number;
  fixed_time: string;
  account_id: string | null;
  lead_hours?: number | null;
  peak_start?: string | null;
  peak_end?: string | null;
}

export interface SpinStatus {
  config: SpinConfig;
  last_spin: string | null;
  next_spin: string | null;
}

export interface SpinNowResult {
  executed: boolean;
  message: string;
}
