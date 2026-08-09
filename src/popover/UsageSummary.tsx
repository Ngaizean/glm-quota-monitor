import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TokenUsageSummary, TokenUsagePeriod, TokenHistoryPoint } from "../types";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatTokens, resolveDisplayLocale } from "../lib/formatters";
import { clampPercentage } from "../lib/quota";
import { getStatusLevel, statusColorVar } from "../lib/ui";
import { aggregateDailyRollingTokens } from "./metrics";

function getStatusColor(pct: number): string {
  return statusColorVar(getStatusLevel(pct));
}

/** 环形进度条 SVG */
function RingGauge({ pct, label, emptyLabel, size = 44, stroke = 4 }: { pct: number | null; label: string; emptyLabel: string; size?: number; stroke?: number }) {
  const hasPercentage = pct !== null && Number.isFinite(pct);
  const normalizedPercentage = clampPercentage(pct ?? 0);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fill = circumference * (normalizedPercentage / 100);
  const color = getStatusColor(normalizedPercentage);

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 -rotate-90"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={hasPercentage ? normalizedPercentage : undefined}
      aria-valuetext={hasPercentage ? `${Math.round(normalizedPercentage)}%` : emptyLabel}
    >
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
  const { t, i18n } = useTranslation();
  const hasPercentage = tokenPct !== null && Number.isFinite(tokenPct);
  const pct = clampPercentage(tokenPct ?? 0);
  const color = getStatusColor(pct);
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);

  return (
    <div className="flex items-center gap-3 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-3 py-3 flex-1 min-w-0">
      <RingGauge pct={tokenPct} label={t("usage.today")} emptyLabel={t("usage.noData")} />
      <div className="min-w-0">
        <div className="text-[11px] font-bold text-[var(--color-text-tertiary)] tracking-wider">{t('usage.today')}</div>
        <div className="text-[18px] font-bold tabular-nums leading-tight" style={{ color }}>
          {hasPercentage ? `${Math.round(pct)}%` : "—"}
        </div>
        <div className="text-[11px] text-[var(--color-text-tertiary)]">
          {data.total_tokens > 0 ? `${formatTokens(data.total_tokens, locale)} ${t('usage.token')}` : t('usage.noData')}
        </div>
      </div>
    </div>
  );
}

/** 趋势箭头 — 今日日均 vs 时段日均 */
function TrendArrow({ todayDaily, periodDaily }: { todayDaily: number; periodDaily: number }) {
  if (periodDaily === 0 || todayDaily === 0) return null;
  const ratio = todayDaily / periodDaily;
  const pct = Math.abs(ratio - 1) * 100;
  if (pct < 1) return null; // 差异 < 1% 不显示

  const up = ratio > 1;
  const color = up ? "var(--color-danger)" : "var(--color-success)";
  const arrow = up ? "↑" : "↓";

  return (
    <span className="text-[11px] font-bold tabular-nums ml-1" style={{ color }}>
      {arrow}{pct >= 100 ? `${ratio.toFixed(1)}x` : `${Math.round(pct)}%`}
    </span>
  );
}

/** 时段卡片 — 总量 + 日均 + 趋势箭头 */
function PeriodCard({ data, label, days, todayDaily }: { data: TokenUsagePeriod; label: string; days: number; todayDaily: number }) {
  const { t, i18n } = useTranslation();
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);
  const avg = data.total_tokens / days;

  return (
    <div className="flex-1 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-bold text-[var(--color-text-tertiary)] tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-[13px] font-bold tabular-nums text-[var(--color-text-primary)] leading-none">
          {formatTokens(data.total_tokens, locale)}
        </span>
      </div>
      <div className="flex items-center text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
        <span>{t('usage.dailyAvg', { value: formatTokens(avg, locale) })}</span>
        <TrendArrow todayDaily={todayDaily} periodDaily={avg} />
      </div>
    </div>
  );
}

/** 纯 CSS 柱状趋势图 — 按天聚合 token 消耗量 */
function TrendBars({ data }: { data: TokenHistoryPoint[] }) {
  const { t, i18n } = useTranslation();
  if (data.length < 2) return null;

  const days = aggregateDailyRollingTokens(data).slice(-7);
  if (days.length < 2) return null;

  const maxVal = Math.max(...days.map(({ tokens }) => tokens), 1);
  const dayLabels = t("weekdays.short", { returnObjects: true }) as string[];
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);

  return (
    <div>
      <div className="text-[11px] font-bold text-[var(--color-text-tertiary)] tracking-wider px-0.5 mb-2">
        {t('usage.dailyConsumption')}
      </div>
      <div className="rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] px-3 py-3">
        <div className="flex items-end gap-1.5 h-[60px]">
          {days.map(({ date: day, tokens: val }, i) => {
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
                    role="progressbar"
                    aria-label={`${day} ${t('usage.token')}`}
                    aria-valuemin={0}
                    aria-valuemax={maxVal}
                    aria-valuenow={val}
                    title={`${formatTokens(val, locale)} ${t('usage.token')}`}
                  />
                </div>
                <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
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

export default function UsageSummary({ accountId, tokenPct, refreshKey }: { accountId: string; tokenPct: number | null; refreshKey: number }) {
  const { t } = useTranslation();
  const resource = useAsyncResource(async () => {
    const [summary, history] = await Promise.all([
      invoke<TokenUsageSummary>("get_usage_summary", { accountId }),
      invoke<TokenHistoryPoint[]>("get_token_history", { accountId, days: 30 }).catch(() => []),
    ]);
    return { summary, history };
  }, [accountId, refreshKey], { enabled: Boolean(accountId), clearOnLoad: true });

  if (resource.loading) {
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

  if (resource.error || !resource.data) {
    return (
      <div role="status" className="text-[11px] text-[var(--color-text-tertiary)] py-2">
        {resource.error ? t("common.error") : t("usage.noData")}
      </div>
    );
  }

  const { summary, history } = resource.data;

  const todayDaily = summary.today.total_tokens; // 今日总量即今日日均

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <TodayCard data={summary.today} tokenPct={tokenPct} />
        <div className="flex flex-col gap-2 flex-1">
          <PeriodCard data={summary.last_7d} label={t('usage.last7d')} days={7} todayDaily={todayDaily} />
          <PeriodCard data={summary.last_30d} label={t('usage.last30d')} days={30} todayDaily={todayDaily} />
        </div>
      </div>
      <TrendBars data={history} />
    </div>
  );
}
