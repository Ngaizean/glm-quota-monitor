import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
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
import type { DeepSeekBalancePoint } from "../types";

function formatTime(ts: string) {
  const match = ts.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 shadow-md text-[10px]">
      <div className="text-[var(--color-text-tertiary)] mb-1">{label}</div>
      <div className="text-emerald-500 font-medium tabular-nums">
        {t("trendChart.balanceLabel")}: ¥{payload[0].value.toFixed(2)}
      </div>
    </div>
  );
}

const RANGES = [1, 7, 30, 90] as const;

/**
 * DeepSeek 余额趋势（展开卡内，替代 TrendChart）。
 *
 * 读 get_deepseek_balance_history → deepseek_snapshots，**Y 轴是绝对货币域 [0, max*1.1]**，
 * 非 TrendChart 的 [0,100] 百分比。多币种账号取点数最多的币种序列画单线。
 */
export default function DeepSeekBalanceChart({
  accountId,
  refreshKey,
}: {
  accountId: string;
  refreshKey: number;
}) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState<DeepSeekBalancePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<number>(1);

  useEffect(() => {
    setLoading(true);
    invoke<DeepSeekBalancePoint[]>("get_deepseek_balance_history", { accountId, days: range })
      .then(setRaw)
      .catch(() => setRaw([]))
      .finally(() => setLoading(false));
  }, [accountId, refreshKey, range]);

  // 多币种：取点数最多的币种（通常账号只有一种），其余丢弃以保证单线连续。
  const data = useMemo(() => {
    if (raw.length === 0) return [];
    const counts = new Map<string, number>();
    for (const p of raw) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
    let best = raw[0].currency;
    let bestN = 0;
    for (const [c, n] of counts) {
      if (n > bestN) {
        best = c;
        bestN = n;
      }
    }
    return raw
      .filter((p) => p.currency === best)
      .map((p) => ({ totalBalance: p.totalBalance, label: formatTime(p.timestamp) }));
  }, [raw]);

  if (loading) {
    return (
      <div className="mt-2 px-3 py-2">
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("common.loading")}</div>
      </div>
    );
  }

  if (data.length < 2) return null;

  const maxTotal = Math.max(...data.map((d) => d.totalBalance));
  const yMax = Math.max(maxTotal * 1.1, 1);

  return (
    <div className="mt-2 px-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          {t("deepseekPane.balanceChartTitle")}
        </div>
        <div className="flex items-center gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-1.5 py-0.5 rounded text-[9px] tabular-nums transition-colors ${
                range === r
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {t(`trendChart.range${r}d`)}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[100px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 8, fill: "var(--color-text-tertiary)" }}
              axisLine={{ stroke: "var(--color-border-subtle)" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fontSize: 8, fill: "var(--color-text-tertiary)" }}
              axisLine={{ stroke: "var(--color-border-subtle)" }}
              tickLine={false}
              tickFormatter={(v: number) => `¥${v >= 100 ? Math.round(v) : v.toFixed(0)}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="totalBalance"
              stroke="#10b981"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: "#10b981" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-0.5 rounded bg-emerald-500" />
          <span className="text-[9px] text-[var(--color-text-tertiary)]">{t("trendChart.balanceLabel")}</span>
        </div>
      </div>
    </div>
  );
}
