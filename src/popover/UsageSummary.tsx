import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { TokenUsageSummary, TokenUsagePeriod, TokenHistoryPoint } from "../types";

function formatTokens(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  if (n >= 1) return `${n.toFixed(0)}`;
  return "0";
}

function getStatusColor(pct: number): string {
  if (pct > 85) return "var(--color-danger)";
  if (pct > 60) return "var(--color-warning)";
  return "var(--color-success)";
}

/** 环形进度条 SVG */
function RingGauge({ pct, size = 44, stroke = 4 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fill = circumference * (Math.min(pct, 100) / 100);
  const color = getStatusColor(pct);

  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-bg-tertiary)" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference - fill}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
      />
    </svg>
  );
}

/** 今日卡片 — 水位 + 环形进度 */
function TodayCard({ data, tokenPct }: { data: TokenUsagePeriod; tokenPct: number | null }) {
  const pct = tokenPct ?? 0;
  const color = getStatusColor(pct);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-3 py-3 flex-1 min-w-0">
      <RingGauge pct={pct} />
      <div className="min-w-0">
        <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] tracking-wider">今日</div>
        <div className="text-[18px] font-bold tabular-nums leading-tight" style={{ color }}>
          {pct > 0 ? `${Math.round(pct)}%` : "—"}
        </div>
        <div className="text-[9px] text-[var(--color-text-tertiary)]">
          {data.total_tokens > 0 ? `${formatTokens(data.total_tokens)} token` : "无数据"}
        </div>
      </div>
    </div>
  );
}

/** 时段卡片 — 总量 + 日均 + 趋势箭头 */
function PeriodCard({ data, label, days, prevTokens }: { data: TokenUsagePeriod; label: string; days: number; prevTokens?: number }) {
  const avg = data.total_tokens / days;
  const trend = prevTokens && prevTokens > 0 ? ((data.total_tokens - prevTokens) / prevTokens * 100) : null;
  const trendUp = trend !== null && trend > 0;

  return (
    <div className="flex-1 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-3 py-2.5 min-w-0">
      <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-[13px] font-bold tabular-nums text-[var(--color-text-primary)] leading-none">
          {formatTokens(data.total_tokens)}
        </span>
        {trend !== null && (
          <span className={`text-[9px] font-medium ${trendUp ? "text-amber-500" : "text-emerald-500"}`}>
            {trendUp ? "↑" : "↓"}{Math.abs(trend).toFixed(0)}%
          </span>
        )}
      </div>
      <div className="text-[9px] text-[var(--color-text-tertiary)] mt-0.5">
        均值 {formatTokens(avg)}/天
      </div>
    </div>
  );
}

/** 纯 CSS 柱状趋势图 — 按天聚合 token 消耗量 */
function TrendBars({ data }: { data: TokenHistoryPoint[] }) {
  if (data.length < 2) return null;

  // 按天聚合：最近的在前，只取最近 7 天
  const dailyMap = new Map<string, number>();
  for (const pt of data) {
    const day = pt.timestamp.slice(0, 10);
    const tokens = pt.tokens_24h ?? 0;
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + tokens);
  }
  const days = Array.from(dailyMap.entries()).slice(-7);
  if (days.length < 2) return null;

  const maxVal = Math.max(...days.map(([, v]) => v), 1);
  const dayLabels = ["日", "一", "二", "三", "四", "五", "六"];

  return (
    <div>
      <div className="text-[9px] font-bold text-[var(--color-text-tertiary)] tracking-wider px-0.5 mb-2">
        每日消耗
      </div>
      <div className="rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-3 py-3">
        <div className="flex items-end gap-1.5 h-[60px]">
          {days.map(([day, val], i) => {
            const h = Math.max((val / maxVal) * 100, 3);
            const d = new Date(day + "T00:00:00");
            const isToday = i === days.length - 1;
            const barColor = isToday
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--color-accent)]/40";

            return (
              <div key={day} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <div className="w-full flex-1 flex items-end">
                  <div
                    className={`w-full rounded-t-sm ${barColor} transition-all duration-500 animate-progress`}
                    style={{ height: `${h}%` }}
                    title={`${formatTokens(val)} token`}
                  />
                </div>
                <span className="text-[7px] text-[var(--color-text-tertiary)] tabular-nums">
                  {dayLabels[d.getDay()]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function UsageSummary({ accountId, tokenPct }: { accountId: string; tokenPct: number | null }) {
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

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <TodayCard data={summary.today} tokenPct={tokenPct} />
        <div className="flex flex-col gap-2 flex-1">
          <PeriodCard data={summary.last_7d} label="近 7 天" days={7} prevTokens={summary.today.total_tokens * 7} />
          <PeriodCard data={summary.last_30d} label="近 30 天" days={30} prevTokens={summary.last_7d.total_tokens * 4} />
        </div>
      </div>
      <TrendBars data={history} />
    </div>
  );
}
