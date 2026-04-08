interface QuotaCardProps {
  title: string;
  percentage: number;
  resetTime: number;
  color: "blue" | "purple" | "amber" | "red";
}

function getBarColor(percentage: number, baseColor: string): string {
  if (percentage > 85) return "bg-red-500";
  if (percentage > 60) return "bg-amber-500";
  return baseColor === "blue" ? "bg-blue-500" : "bg-purple-500";
}

function formatResetTime(ts: number): string {
  if (!ts) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return "即将重置";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}天后`;
  }
  return `${hours}h ${mins}m`;
}

export default function QuotaCard({
  title,
  percentage,
  resetTime,
  color,
}: QuotaCardProps) {
  return (
    <div className="bg-neutral-800/60 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-neutral-400">{title}</span>
        <span className="text-sm font-mono font-semibold">
          {percentage}%
        </span>
      </div>
      <div className="w-full bg-neutral-700 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${getBarColor(percentage, color)}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <div className="mt-1.5 text-[10px] text-neutral-500">
        重置: {formatResetTime(resetTime)}
      </div>
    </div>
  );
}
