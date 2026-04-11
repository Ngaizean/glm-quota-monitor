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

  return (
    <div className="flex-1 rounded-xl bg-[var(--color-bg-secondary)] p-3 space-y-2 min-w-0 border border-[var(--color-border-subtle)]">
      <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-widest">
        {label}
      </div>
      <div className="text-[15px] font-bold tabular-nums text-[var(--color-text-primary)] leading-none">
        {hasData && tokenPeak != null ? `${tokenPeak.toFixed(0)}%` : "--"}
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-[var(--color-text-tertiary)]">
          {hasData ? `${data.snapshot_count} 条` : "无数据"}
        </span>
        {hasData && data.peak_time_limit_pct != null && (
          <span className={`text-[9px] font-medium tabular-nums ${
            data.peak_time_limit_pct > 85 ? "text-[var(--color-danger)]"
              : data.peak_time_limit_pct > 60 ? "text-[var(--color-warning)]"
              : "text-[var(--color-success)]"
          }`}>
            {data.peak_time_limit_pct.toFixed(0)}%
          </span>
        )}
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
      <div className="space-y-2.5">
        <div className="h-3 w-20 skeleton rounded" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[70px] skeleton rounded-xl" />
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
    <div className="space-y-2.5">
      <h3 className="text-[9px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-widest px-0.5">
        额度使用峰值
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {periods.map(({ data, label }) => (
          <SummaryCard key={label} data={data} label={label} />
        ))}
      </div>
    </div>
  );
}
