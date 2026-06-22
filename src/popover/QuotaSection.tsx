import { useTranslation } from "react-i18next";
import type { QuotaLimit } from "../types";
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
type QuotaCategory = "hourly" | "weekly" | "monthly";

/** 根据 type+unit 判定额度类别，无法判定时用重置周期兜底 */
function classifyLimit(limit: QuotaLimit): QuotaCategory | null {
  // 优先用 (type, unit) 组合精确匹配
  if (limit.type === "TOKENS_LIMIT") {
    if (limit.unit === 3) return "hourly";   // 5h 窗口
    if (limit.unit === 6) return "weekly";   // 周额度
  }
  if (limit.type === "TIME_LIMIT") {
    return "monthly";                          // 月度
  }
  if (limit.type === "MCP_MONTHLY") {
    return "monthly";
  }
  // 兜底：用重置周期判定（nextResetTime 与现在的差值）
  if (limit.nextResetTime > 0) {
    const hoursLeft = (limit.nextResetTime - Date.now()) / 3600000;
    if (hoursLeft < 24) return "hourly";
    if (hoursLeft < 14 * 24) return "weekly";
    return "monthly";
  }
  return null;
}

const CATEGORY_TITLE_KEY: Record<QuotaCategory, string> = {
  hourly: "quota.token5hTitle",
  weekly: "quota.weeklyTitle",
  monthly: "quota.mcpMonthlyTitle",
};

/** 渲染顺序：5h 窗口 → 周额度 → 月度（按紧迫度递减） */
const RENDER_ORDER: QuotaCategory[] = ["hourly", "weekly", "monthly"];

export default function QuotaSection({ limits, isOffline }: Props) {
  const { t } = useTranslation();

  // 分类所有额度，按 category 去重（同一类别只保留第一个）
  const classified = new Map<QuotaCategory, QuotaLimit>();
  for (const limit of limits) {
    const category = classifyLimit(limit);
    if (category && !classified.has(category)) {
      classified.set(category, limit);
    }
  }

  const ordered = RENDER_ORDER
    .map((cat) => classified.get(cat))
    .filter((l): l is QuotaLimit => Boolean(l));

  return (
    <div className="px-4 py-3 space-y-3.5 relative">
      {isOffline && (
        <div className="absolute top-2 right-3 text-[9px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
          {t('account.offlineData')}
        </div>
      )}
      {ordered.map((limit) => {
        const category = classifyLimit(limit)!;
        const titleKey = CATEGORY_TITLE_KEY[category];
        return (
          <QuotaBar
            key={category}
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
