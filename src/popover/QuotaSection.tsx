import type { QuotaLimit } from "../types";

function formatResetTime(ts: number): string {
  if (!ts) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return "即将重置";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}天`;
  return `${hours}时${mins}分`;
}

function getStatusColors(pct: number) {
  if (pct > 85) return {
    bar: "bg-gradient-to-r from-red-400 to-rose-500",
    dot: "bg-red-500",
    text: "text-[var(--color-danger)]",
  };
  if (pct > 60) return {
    bar: "bg-gradient-to-r from-amber-400 to-orange-400",
    dot: "bg-amber-500",
    text: "text-[var(--color-warning)]",
  };
  return {
    bar: "bg-gradient-to-r from-emerald-400 to-teal-500",
    dot: "bg-emerald-500",
    text: "text-[var(--color-success)]",
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
            {Math.round(percentage)}%
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

interface Props {
  limits: QuotaLimit[];
  isOffline?: boolean;
}

export default function QuotaSection({ limits, isOffline }: Props) {
  const tokensLimit = limits.find((l) => l.type === "TOKENS_LIMIT");
  const mcpLimit =
    limits.find((l) => l.type === "TIME_LIMIT") ??
    limits.find((l) => l.type === "MCP_MONTHLY");

  return (
    <div className="px-4 py-3 space-y-4 relative">
      {isOffline && (
        <div className="absolute top-2 right-3 text-[8px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 rounded">
          离线数据
        </div>
      )}
      {tokensLimit && (
        <QuotaBar title="Token 额度" percentage={tokensLimit.percentage} resetTime={tokensLimit.nextResetTime} />
      )}
      {mcpLimit && (
        <QuotaBar title="MCP 调用额度" percentage={mcpLimit.percentage} resetTime={mcpLimit.nextResetTime} />
      )}
    </div>
  );
}
