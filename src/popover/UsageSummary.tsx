import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface PeriodSummary {
  period_label: string;
  snapshot_count: number;
  avg_token_limit_pct: number | null;
  peak_token_limit_pct: number | null;
  avg_time_limit_pct: number | null;
  peak_time_limit_pct: number | null;
}

interface UsageSummaryData {
  today: PeriodSummary;
  last_7d: PeriodSummary;
  last_30d: PeriodSummary;
}

function SummaryCard({ data, label }: { data: PeriodSummary; label: string }) {
  const hasData = data.snapshot_count > 0;
  const tokenPeak = data.peak_token_limit_pct;
  const timePeak = data.peak_time_limit_pct;

  return (
    <div className="bg-[var(--color-bg-secondary)] rounded-[var(--radius-md)] p-2.5 space-y-2 border border-[var(--color-border-subtle)]">
      <div className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
        {label}
      </div>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-tertiary)]">Token</span>
          <span className={`text-[11px] font-semibold tabular-nums ${
            !hasData ? "text-[var(--color-text-tertiary)]" : tokenPeak && tokenPeak > 85 ? "text-[var(--color-danger)]" : tokenPeak && tokenPeak > 60 ? "text-[var(--color-warning)]" : "text-[var(--color-text-primary)]"
          }`}>
            {tokenPeak != null ? `${tokenPeak.toFixed(0)}%` : "--"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-tertiary)]">Time</span>
          <span className={`text-[11px] font-semibold tabular-nums ${
            !hasData ? "text-[var(--color-text-tertiary)]" : timePeak && timePeak > 85 ? "text-[var(--color-danger)]" : timePeak && timePeak > 60 ? "text-[var(--color-warning)]" : "text-[var(--color-text-primary)]"
          }`}>
            {timePeak != null ? `${timePeak.toFixed(0)}%` : "--"}
          </span>
        </div>
      </div>
      <div className="text-[9px] text-[var(--color-text-tertiary)]">
        {data.snapshot_count} 条记录
      </div>
    </div>
  );
}

export default function UsageSummary({ accountId }: { accountId: string }) {
  const [summary, setSummary] = useState<UsageSummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    invoke<UsageSummaryData>("get_usage_summary", { accountId })
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [accountId]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-3 w-24 bg-[var(--color-bg-tertiary)] rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-[var(--color-bg-secondary)] rounded-[var(--radius-md)] animate-pulse border border-[var(--color-border-subtle)]" />
          ))}
        </div>
      </div>
    );
  }

  if (!summary) return null;

  const periods = [
    { data: summary.today, label: "Today" },
    { data: summary.last_7d, label: "7 Days" },
    { data: summary.last_30d, label: "30 Days" },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider px-0.5">
        额度使用汇总
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {periods.map(({ data, label }) => (
          <SummaryCard key={label} data={data} label={label} />
        ))}
      </div>
    </div>
  );
}
