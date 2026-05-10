import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface HistoryPoint {
  timestamp: string;
  token_pct: number;
  time_pct: number;
  tokens_24h: number | null;
}

function formatTime(ts: string) {
  // Extract HH:MM from ISO/RFC3339 timestamp
  const match = ts.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

// formatTokens available for future use
// function formatTokens(v: number | null): string {
//   if (v === null || v === 0) return "—";
//   if (v >= 100_000_000) return (v / 100_000_000).toFixed(1) + "亿";
//   if (v >= 10_000) return (v / 10_000).toFixed(1) + "万";
//   return v.toFixed(0);
// }

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 shadow-md text-[10px]">
      <div className="text-[var(--color-text-tertiary)] mb-1">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="text-[var(--color-text-primary)] font-medium">
          {entry.dataKey === "token_pct" ? `Token: ${entry.value.toFixed(1)}%` : `Time: ${entry.value.toFixed(1)}%`}
        </div>
      ))}
    </div>
  );
}

export default function TrendChart({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const { t } = useTranslation();
  const [data, setData] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<HistoryPoint[]>("get_token_history", { accountId })
      .then((points) => setData(points))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [accountId, refreshKey]);

  if (loading) {
    return (
      <div className="mt-2 px-3 py-2">
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("common.loading")}</div>
      </div>
    );
  }

  if (data.length < 2) return null;

  const chartData = data.map((p) => ({
    ...p,
    label: formatTime(p.timestamp),
  }));

  return (
    <div className="mt-2 px-1">
      <div className="text-[10px] font-medium text-[var(--color-text-secondary)] mb-1.5">
        {t("trendChart.title")}
      </div>
      <div className="h-[100px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 2, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 8, fill: "var(--color-text-tertiary)" }}
              axisLine={{ stroke: "var(--color-border-subtle)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 8, fill: "var(--color-text-tertiary)" }}
              axisLine={{ stroke: "var(--color-border-subtle)" }}
              tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="token_pct"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: "var(--color-accent)" }}
            />
            <Line
              type="monotone"
              dataKey="time_pct"
              stroke="var(--color-success)"
              strokeWidth={1}
              dot={false}
              strokeDasharray="4 2"
              activeDot={{ r: 2, fill: "var(--color-success)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-0.5 rounded bg-[var(--color-accent)]" />
          <span className="text-[8px] text-[var(--color-text-tertiary)]">{t("trendChart.tokenUsage")}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-0.5 rounded bg-[var(--color-success)] opacity-60" style={{ borderStyle: "dashed" }} />
          <span className="text-[8px] text-[var(--color-text-tertiary)]">Time</span>
        </div>
      </div>
    </div>
  );
}
