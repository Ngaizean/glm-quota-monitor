import { useTranslation } from "react-i18next";
import type { QuotaLimit } from "../types";
import { clampPercentage, partitionQuotaLimits } from "../lib/quota";
import { getStatusLevel, statusColorVar, statusGradientVar } from "../lib/ui";

function formatResetTime(ts: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!ts) return t('quota.resetSoon');
  const diff = ts - Date.now();
  if (diff <= 0) return t('quota.resetSoon');
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return t('quota.resetDays', { count: Math.floor(hours / 24) });
  return t('quota.resetHours', { hours, minutes: mins });
}

interface QuotaBarProps {
  title: string;
  percentage: number;
  resetTime: number;
}

function QuotaBar({ title, percentage, resetTime }: QuotaBarProps) {
  const { t } = useTranslation();
  const normalizedPercentage = clampPercentage(percentage);
  const level = getStatusLevel(normalizedPercentage);
  const colorVar = statusColorVar(level);
  const gradientVar = statusGradientVar(level);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span aria-hidden="true" className="inline-block w-[5px] h-[5px] rounded-full shrink-0" style={{ backgroundColor: colorVar }} />
          <span className="text-xs font-medium text-[var(--color-text-secondary)] truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] text-[var(--color-text-tertiary)] tabular-nums">
            {formatResetTime(resetTime, t)}
          </span>
          <span className="text-[13px] font-bold tabular-nums w-11 text-right" style={{ color: colorVar }}>
            {Math.round(normalizedPercentage)}%
          </span>
        </div>
      </div>
      <div
        className="w-full h-[6px] bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={normalizedPercentage}
      >
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${normalizedPercentage}%`,
            background: gradientVar,
            transition: "width 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>
    </div>
  );
}

interface Props {
  limits: QuotaLimit[];
  isOffline?: boolean;
}

/**
 * 额度类型判定逻辑
 *
 * GLM API 返回的额度通过 type + unit 字段组合区分（重置周期为真相来源）：
 *   - TOKENS_LIMIT + unit=3 → 5 小时滚动窗口（重置 ~5h）
 *   - TOKENS_LIMIT + unit=6 → 周额度（重置 ~7 天，部分账号启用）
 *   - TIME_LIMIT  + unit=5 → 月度额度（重置 ~30 天，含 MCP/search 工具用量）
 *   - MCP_MONTHLY         → MCP 月度（历史兼容）
 *
 * 注意：API 可能返回多个同 type 的额度（如两个 TOKENS_LIMIT），
 * 必须按 (type, unit) 组合查找，不能用 find() 只取第一个。
 */
type QuotaCategory = "hourly" | "weekly" | "time" | "mcp" | "sparkHourly" | "sparkWeekly";

const CATEGORY_TITLE_KEY: Record<QuotaCategory, string> = {
  hourly: "quota.token5hTitle",
  weekly: "quota.weeklyTitle",
  time: "quota.mcpMonthlyTitle",
  mcp: "quota.mcpMonthlyTitle",
  sparkHourly: "quota.spark5hTitle",
  sparkWeekly: "quota.sparkWeeklyTitle",
};

/** 渲染顺序：5h 窗口 → 周额度 → Spark 5h → Spark 周 → 月度 */
const RENDER_ORDER: QuotaCategory[] = ["hourly", "weekly", "sparkHourly", "sparkWeekly", "time", "mcp"];

export default function QuotaSection({ limits, isOffline }: Props) {
  const { t } = useTranslation();

  const partitioned = partitionQuotaLimits(limits);
  const ordered = RENDER_ORDER.flatMap((category) => {
    const limit = partitioned[category];
    return limit ? [{ category, limit }] : [];
  });
  const unknown = partitioned.other.filter((limit) => limit.type !== "DEEPSEEK_BALANCE");

  return (
    <div className="px-4 py-3 space-y-3.5 relative">
      {isOffline && (
        <div className="absolute top-2 right-3 text-[11px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
          {t('account.offlineData')}
        </div>
      )}
      {ordered.map(({ category, limit }) => {
        const titleKey = CATEGORY_TITLE_KEY[category];
        return (
          <QuotaBar
            key={category}
            title={t(titleKey)}
            percentage={limit.percentage}
            resetTime={limit.nextResetTime}
          />
        );
      })}
      {unknown.map((limit, index) => (
        <QuotaBar
          key={`${limit.type}-${limit.unit ?? "unknown"}-${index}`}
          title={limit.type || t("usage.noData")}
          percentage={limit.percentage}
          resetTime={limit.nextResetTime}
        />
      ))}
      {ordered.length === 0 && unknown.length === 0 && (
        <div className="text-[11px] text-[var(--color-text-tertiary)] py-2">{t('usage.noData')}</div>
      )}
    </div>
  );
}
