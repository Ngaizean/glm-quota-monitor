function formatResetTime(ts: number): string {
  if (!ts) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return "即将重置";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d`;
  return `${hours}h ${mins}m`;
}

function QuotaBar({ title, percentage, resetTime }: {
  title: string; percentage: number; resetTime: number;
}) {
  const gradientClass =
    percentage > 85
      ? "bg-gradient-to-r from-red-400 to-red-500"
      : percentage > 60
        ? "bg-gradient-to-r from-amber-400 to-amber-500"
        : "bg-gradient-to-r from-emerald-400 to-emerald-500";

  const dotColor =
    percentage > 85
      ? "bg-red-500"
      : percentage > 60
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
          <span className="text-[11px] text-[var(--color-text-secondary)]">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--color-text-tertiary)]">
            重置 {formatResetTime(resetTime)}
          </span>
          <span className="text-xs font-semibold tabular-nums text-[var(--color-text-primary)] w-10 text-right">
            {percentage}%
          </span>
        </div>
      </div>
      <div className="w-full h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${gradientClass} transition-all duration-700 ease-out`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

interface QuotaLimit {
  type: string;
  percentage: number;
  nextResetTime: number;
}

interface Props {
  limits: QuotaLimit[];
}

export default function QuotaSection({ limits }: Props) {
  const tokensLimit = limits.find((l) => l.type === "TOKENS_LIMIT");
  const timeLimit = limits.find((l) => l.type === "TIME_LIMIT");

  return (
    <div className="px-4 py-3 space-y-3">
      {tokensLimit && (
        <QuotaBar title="Token 额度" percentage={tokensLimit.percentage} resetTime={tokensLimit.nextResetTime} />
      )}
      {timeLimit && timeLimit.percentage > 0 && (
        <QuotaBar title="时间窗口" percentage={timeLimit.percentage} resetTime={timeLimit.nextResetTime} />
      )}
    </div>
  );
}
