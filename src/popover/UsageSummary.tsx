import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { TokenUsageSummary, TokenUsagePeriod } from "../types";

/** 格式化 token 数量：>=1亿显示亿，>=1万显示万，否则显示原始值 */
function formatTokens(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  if (n >= 1) return `${n.toFixed(0)}`;
  return "0";
}

function SummaryCard({ data, label }: { data: TokenUsagePeriod; label: string }) {
  return (
    <div className="flex-1 rounded-xl bg-[var(--color-bg-secondary)] p-3 space-y-2 min-w-0 border border-[var(--color-border-subtle)]">
      <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-widest">
        {label}
      </div>
      <div className="text-[15px] font-bold tabular-nums text-[var(--color-text-primary)] leading-none">
        {formatTokens(data.total_tokens)}
      </div>
      <div className="text-[9px] text-[var(--color-text-tertiary)]">
        {data.total_calls > 0 ? `${data.total_calls.toFixed(0)} 次调用` : "无数据"}
      </div>
    </div>
  );
}

export default function UsageSummary({ accountId }: { accountId: string }) {
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    invoke<TokenUsageSummary>("get_usage_summary", { accountId })
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
        Token 使用量
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {periods.map(({ data, label }) => (
          <SummaryCard key={label} data={data} label={label} />
        ))}
      </div>
    </div>
  );
}
