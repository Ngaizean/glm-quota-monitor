import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
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
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatChartTime, formatCurrency, resolveDisplayLocale, type DisplayLocale } from "../lib/formatters";
import type { DeepSeekBalancePoint } from "../types";
import { downsampleEvenly, selectDominantCurrency } from "./metrics";

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  currency: string;
  locale: DisplayLocale;
}

function CustomTooltip({ active, payload, label, currency, locale }: CustomTooltipProps) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-lg px-2.5 py-1.5 shadow-md text-[11px]">
      <div className="text-[var(--color-text-tertiary)] mb-1">{label}</div>
      <div className="text-emerald-500 font-medium tabular-nums">
        {t("trendChart.balanceLabel")}: {formatCurrency(payload[0].value, currency, locale)}
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
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<number>(1);
  const resource = useAsyncResource(
    () => invoke<DeepSeekBalancePoint[]>("get_deepseek_balance_history", { accountId, days: range }),
    [accountId, refreshKey, range],
    { enabled: Boolean(accountId), clearOnLoad: true },
  );
  const raw = resource.data ?? [];
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);

  const selected = useMemo(() => selectDominantCurrency(raw), [raw]);
  const data = useMemo(() => downsampleEvenly(selected.points, 240).map((point) => ({
    ...point,
    label: formatChartTime(point.timestamp, range, locale),
  })), [selected.points, range, locale]);

  const maxTotal = Math.max(...data.map((d) => d.totalBalance), 0);
  const yMax = Math.max(maxTotal * 1.1, 1);

  return (
    <div className="mt-2 px-1">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t("deepseekPane.balanceChartTitle")}
        </div>
        <div className="flex items-center gap-0.5" role="tablist" aria-label={t("deepseekPane.balanceChartTitle")}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`px-1.5 py-0.5 rounded text-xs tabular-nums transition-colors ${
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
      {resource.loading && (
        <div role="status" aria-live="polite" className="px-2 py-2 text-[11px] text-[var(--color-text-tertiary)]">
          {t("common.loading")}
        </div>
      )}
      {resource.error && (
        <div role="status" className="px-2 py-2 text-[11px] text-[var(--color-danger)]">
          {t("common.error")}
        </div>
      )}
      {!resource.loading && !resource.error && data.length < 2 && (
        <div role="status" className="px-2 py-2 text-[11px] text-[var(--color-text-tertiary)]">
          {t("deepseekPane.noData")}
        </div>
      )}
      {!resource.loading && !resource.error && data.length >= 2 && (
        <>
          <div className="h-[100px]" role="img" aria-label={t("deepseekPane.balanceChartTitle")}>
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
              tickFormatter={(v: number) => formatCurrency(v, selected.currency, locale)}
            />
            <Tooltip content={<CustomTooltip currency={selected.currency} locale={locale} />} />
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
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{t("trendChart.balanceLabel")}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
