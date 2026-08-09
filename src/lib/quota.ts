import type { QuotaLimit } from "../types";

export type QuotaStatus = "healthy" | "warning" | "critical";

export interface PartitionedQuotaLimits {
  hourly?: QuotaLimit;
  weekly?: QuotaLimit;
  time?: QuotaLimit;
  mcp?: QuotaLimit;
  sparkHourly?: QuotaLimit;
  sparkWeekly?: QuotaLimit;
  balance?: QuotaLimit;
  other: QuotaLimit[];
}

export interface QuotaSummary {
  primary: QuotaLimit | null;
  secondary: QuotaLimit | null;
  maxPercentage: number;
  status: QuotaStatus;
}

export function clampPercentage(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 100);
}

export function getQuotaStatus(percentage: number): QuotaStatus {
  const normalized = clampPercentage(percentage);
  if (normalized >= 85) return "critical";
  if (normalized >= 60) return "warning";
  return "healthy";
}

/** 按后端稳定的 type + unit 契约分类；未知类型保留在 other 中，不做时间启发式猜测。 */
export function partitionQuotaLimits(limits: readonly QuotaLimit[]): PartitionedQuotaLimits {
  const result: PartitionedQuotaLimits = { other: [] };

  for (const limit of limits) {
    const type = limit.type.trim().toUpperCase();
    let key: Exclude<keyof PartitionedQuotaLimits, "other"> | null = null;

    if (type === "TOKENS_LIMIT") {
      if (limit.unit === 6) key = "weekly";
      else if (limit.unit === 3 || limit.unit == null) key = "hourly";
    } else if (type === "TIME_LIMIT") {
      key = "time";
    } else if (type === "MCP_MONTHLY") {
      key = "mcp";
    } else if (type === "SPARK_5H") {
      key = "sparkHourly";
    } else if (type === "SPARK_WEEKLY") {
      key = "sparkWeekly";
    } else if (type === "DEEPSEEK_BALANCE") {
      key = "balance";
    }

    if (!key) {
      result.other.push(limit);
    } else if (!result[key]) {
      result[key] = limit;
    } else {
      // 重复类别不应静默丢失，保留给调用方诊断。
      result.other.push(limit);
    }
  }

  return result;
}

function firstDistinct(
  candidates: Array<QuotaLimit | undefined>,
  excluded?: QuotaLimit,
): QuotaLimit | null {
  return candidates.find((candidate) => candidate && candidate !== excluded) ?? null;
}

export function getQuotaSummary(limits: readonly QuotaLimit[]): QuotaSummary {
  const parts = partitionQuotaLimits(limits);
  const primary = firstDistinct([
    parts.hourly,
    parts.sparkHourly,
    parts.time,
    parts.mcp,
    parts.weekly,
    parts.sparkWeekly,
  ]);
  const secondary = firstDistinct([
    parts.weekly,
    parts.sparkWeekly,
    parts.mcp,
    parts.time,
    parts.hourly,
    parts.sparkHourly,
  ], primary ?? undefined);

  const percentageLimits = [
    parts.hourly,
    parts.weekly,
    parts.time,
    parts.mcp,
    parts.sparkHourly,
    parts.sparkWeekly,
    ...parts.other,
  ].filter((limit): limit is QuotaLimit => Boolean(limit));
  const maxPercentage = percentageLimits.reduce(
    (maximum, limit) => Math.max(maximum, clampPercentage(limit.percentage)),
    0,
  );

  return {
    primary,
    secondary,
    maxPercentage,
    status: getQuotaStatus(maxPercentage),
  };
}
