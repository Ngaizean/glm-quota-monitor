import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { TokenUsageSummary, TokenUsagePeriod, TokenHistoryPoint } from "../types";

function formatTokens(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  if (n >= 1) return `${n.toFixed(0)}`;
  return "0";
}

function SummaryCard({ data, label }: { data: TokenUsagePeriod; label: string }) {
  return (
    <div className="flex-1 rounded-xl bg-[var(--color-bg-secondary)] p-3 space-y-2 min-w-0 border border-[var(--color-border-subtle)]">
      <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] tracking-wider">
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

function formatChartTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function TrendChart({ data }: { data: TokenHistoryPoint[] }) {
  if (data.length < 2) return null;

  // 粗刻度：0, 25, 50, 75, 100
  const ticks = [0, 25, 50, 75, 100];
  // 只取少量 x 轴标签
  const step = Math.max(1, Math.floor(data.length / 5));

  return (
    <div className="mt-2">
      <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] tracking-wider px-0.5 mb-2">
        用量趋势
      </div>
      <div className="h-[90px] rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-2 py-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 4, left: -18, bottom: 0 }}>
            <XAxis
              dataKey="timestamp"
              tickFormatter={formatChartTime}
              tick={{ fontSize: 8, fill: "var(--color-text-tertiary)" }}
              axisLine={false}
              tickLine={false}
              interval={step}
            />
            <YAxis
              domain={[0, 100]}
              ticks={ticks}
              tick={{ fontSize: 8, fill: "var(--color-text-tertiary)" }}
              tickFormatter={(v: number) => `${v}%`}
              axisLine={false}
              tickLine={false}
              width={24}
            />
            <Tooltip
              contentStyle={{
                fontSize: 10,
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                padding: "4px 8px",
              }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => [
                `${Math.round(Number(value))}%`,
                name === "token_pct" ? "令牌" : "MCP",
              ]}
              labelFormatter={(label: unknown) => {
                const d = new Date(String(label));
                return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:00`;
              }}
            />
            <Line
              type="monotone"
              dataKey="token_pct"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "var(--color-accent)" }}
            />
            <Line
              type="monotone"
              dataKey="time_pct"
              stroke="var(--color-success)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: "var(--color-success)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function UsageSummary({ accountId }: { accountId: string }) {
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [history, setHistory] = useState<TokenHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    Promise.all([
      invoke<TokenUsageSummary>("get_usage_summary", { accountId }).catch(() => null),
      invoke<TokenHistoryPoint[]>("get_token_history", { accountId }).catch(() => []),
    ]).then(([sum, hist]) => {
      setSummary(sum);
      setHistory(hist);
      setLoading(false);
    });
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
    { data: summary.today, label: "今日" },
    { data: summary.last_7d, label: "近 7 天" },
    { data: summary.last_30d, label: "近 30 天" },
  ];

  return (
    <div className="space-y-2.5">
      <h3 className="text-[9px] font-bold text-[var(--color-text-tertiary)] tracking-wider px-0.5">
        令牌用量
      </h3>
      <div className="grid grid-cols-3 gap-2">
        {periods.map(({ data, label }) => (
          <SummaryCard key={label} data={data} label={label} />
        ))}
      </div>
      <TrendChart data={history} />
    </div>
  );
}
