function formatResetTime(ts: number): string {
  if (!ts) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return "即将重置";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d`;
  return `${hours}h ${mins}m`;
}

function getStatusColors(pct: number) {
  if (pct > 85) return {
    bar: "bg-gradient-to-r from-red-400 to-rose-500",
    dot: "bg-red-500",
    text: "text-red-600",
  };
  if (pct > 60) return {
    bar: "bg-gradient-to-r from-amber-400 to-orange-400",
    dot: "bg-amber-500",
    text: "text-amber-600",
  };
  return {
    bar: "bg-gradient-to-r from-emerald-400 to-teal-500",
    dot: "bg-emerald-500",
    text: "text-[var(--color-text-primary)]",
  };
}

function QuotaBar({ title, percentage, resetTime }: {
  title: string; percentage: number; resetTime: number;
}) {
  const colors = getStatusColors(percentage);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-[5px] h-[5px] rounded-full ${colors.dot}`} />
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--color-text-tertiary)] tabular-nums">
            {formatResetTime(resetTime)}
          </span>
          <span className={`text-[13px] font-bold tabular-nums w-12 text-right ${colors.text}`}>
            {percentage}%
          </span>
        </div>
      </div>
      <div className="w-full h-[6px] bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colors.bar} animate-progress`}
          style={{ width: `${Math.min(percentage, 100)}%`, transition: "width 0.7s cubic-bezier(0.16, 1, 0.3, 1)" }}
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
    <div className="px-4 py-3 space-y-4">
      {tokensLimit && (
        <QuotaBar title="Token 额度" percentage={tokensLimit.percentage} resetTime={tokensLimit.nextResetTime} />
      )}
      {timeLimit && timeLimit.percentage > 0 && (
        <QuotaBar title="时间窗口" percentage={timeLimit.percentage} resetTime={timeLimit.nextResetTime} />
      )}
    </div>
  );
}
