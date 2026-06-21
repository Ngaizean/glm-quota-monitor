import { useTranslation } from "react-i18next";
import type { QuotaLimit, QuotaLimitType } from "../types";
import { getStatusLevel, statusBgClass, statusColorVar, statusGradientVar } from "../lib/ui";

function formatResetTime(ts: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!ts) return t('quota.resetSoon');
  const diff = ts - Date.now();
  if (diff <= 0) return t('quota.resetSoon');
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return t('quota.resetDays', { count: Math.floor(hours / 24) });
  return t('quota.resetHours', { hours, minutes: mins });
}

/** 紧凑格式化绝对值：大数用万/亿，小数保留适当精度 */
function formatAbsolute(n: number | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  if (n >= 100) return Math.round(n).toString();
  if (n >= 1) return n.toFixed(n < 10 ? 1 : 0);
  return n.toFixed(2);
}

interface QuotaBarProps {
  title: string;
  percentage: number;
  resetTime: number;
  used?: number;
  total?: number;
}

function QuotaBar({ title, percentage, resetTime, used, total }: QuotaBarProps) {
  const { t } = useTranslation();
  const level = getStatusLevel(percentage);
  const colorVar = statusColorVar(level);
  const gradientVar = statusGradientVar(level);
  const hasAbsolute = used !== undefined || total !== undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`inline-block w-[5px] h-[5px] rounded-full shrink-0 ${statusBgClass(level)}`} />
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)] truncate">{title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] text-[var(--color-text-tertiary)] tabular-nums">
            {formatResetTime(resetTime, t)}
          </span>
          <span className="text-[13px] font-bold tabular-nums w-11 text-right" style={{ color: colorVar }}>
            {Math.round(percentage)}%
          </span>
        </div>
      </div>
      <div className="w-full h-[6px] bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full animate-progress"
          style={{
            width: `${Math.min(Math.max(percentage, 0), 100)}%`,
            background: gradientVar,
            transition: "width 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
      </div>
      {hasAbsolute && (
        <div className="text-[9px] text-[var(--color-text-tertiary)] tabular-nums">
          {formatAbsolute(used)} / {formatAbsolute(total)}
        </div>
      )}
    </div>
  );
}

interface Props {
  limits: QuotaLimit[];
  isOffline?: boolean;
}

/**
 * 三种额度类型 → 标题 i18n 键映射
 *
 * 映射依据：重置周期（数据库证据，而非 API 字段名的字面含义）。
 *   - TIME_LIMIT:   重置周期约 7 天  → 周额度
 *   - TOKENS_LIMIT: 重置周期约 5 小时 → 5 小时窗口
 *   - MCP_MONTHLY:  重置周期约 30 天  → MCP 月度
 *
 * 注意：API 的 type 字段名与实际周期不符（TIME_LIMIT 实为周额度），
 * 此处以重置周期为准。详见 context.md 额度类型纠正章节。
 */
const LIMIT_TITLE_KEY: Record<string, string> = {
  TIME_LIMIT: "quota.weeklyTitle",
  TOKENS_LIMIT: "quota.token5hTitle",
  MCP_MONTHLY: "quota.mcpMonthlyTitle",
};

/** 渲染顺序：5h 窗口 → 周额度 → MCP 月度（按紧迫度递减） */
const RENDER_ORDER: QuotaLimitType[] = ["TOKENS_LIMIT", "TIME_LIMIT", "MCP_MONTHLY"];

export default function QuotaSection({ limits, isOffline }: Props) {
  const { t } = useTranslation();

  // 按预定义顺序去重渲染（同类型只取第一条）
  const seen = new Set<string>();
  const ordered = RENDER_ORDER
    .map((type) => limits.find((l) => l.type === type && !seen.has(type) && seen.add(type)))
    .filter((l): l is QuotaLimit => Boolean(l));

  return (
    <div className="px-4 py-3 space-y-3.5 relative">
      {isOffline && (
        <div className="absolute top-2 right-3 text-[9px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
          {t('account.offlineData')}
        </div>
      )}
      {ordered.map((limit) => {
        const titleKey = LIMIT_TITLE_KEY[limit.type] ?? "quota.tokenTitle";
        return (
          <QuotaBar
            key={limit.type}
            title={t(titleKey)}
            percentage={limit.percentage}
            resetTime={limit.nextResetTime}
            used={limit.usage}
            total={limit.number}
          />
        );
      })}
      {ordered.length === 0 && (
        <div className="text-[10px] text-[var(--color-text-tertiary)] py-2">{t('usage.noData')}</div>
      )}
    </div>
  );
}
