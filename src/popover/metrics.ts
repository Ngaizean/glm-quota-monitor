export interface RollingTokenSnapshot {
  timestamp: string;
  tokens_24h: number | null;
}

export interface DailyRollingTokens {
  date: string;
  tokens: number;
}

/**
 * tokens_24h 是每个采样时刻的滚动 24 小时快照，不是增量。
 * 日柱状图因此取每天时间戳最新的快照，不能把同日采样相加。
 */
export function aggregateDailyRollingTokens(
  points: readonly RollingTokenSnapshot[],
): DailyRollingTokens[] {
  const latestByDay = new Map<string, RollingTokenSnapshot>();

  for (const point of points) {
    const date = point.timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const current = latestByDay.get(date);
    if (!current || point.timestamp > current.timestamp) latestByDay.set(date, point);
  }

  return [...latestByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, point]) => ({
      date,
      tokens: Math.max(Number.isFinite(point.tokens_24h) ? point.tokens_24h ?? 0 : 0, 0),
    }));
}

/** 等距下采样，始终保留首尾点，避免长时间范围把数千个 SVG 节点塞入图表。 */
export function downsampleEvenly<T>(points: readonly T[], maxPoints = 240): T[] {
  const limit = Math.max(Math.floor(maxPoints), 2);
  if (points.length <= limit) return [...points];

  const result: T[] = [];
  const lastIndex = points.length - 1;
  for (let index = 0; index < limit; index += 1) {
    result.push(points[Math.round((index * lastIndex) / (limit - 1))]);
  }
  return result;
}

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  return normalized === "RMB" ? "CNY" : normalized || "CNY";
}

/** 单线图选择样本最多的币种；同数时保持首次出现的币种，结果可预测。 */
export function selectDominantCurrency<T extends { currency: string }>(
  points: readonly T[],
): { currency: string; points: T[] } {
  if (points.length === 0) return { currency: "CNY", points: [] };

  const counts = new Map<string, number>();
  for (const point of points) {
    const currency = normalizeCurrency(point.currency);
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }

  let currency = normalizeCurrency(points[0].currency);
  let maximum = counts.get(currency) ?? 0;
  for (const [candidate, count] of counts) {
    if (count > maximum) {
      currency = candidate;
      maximum = count;
    }
  }

  return {
    currency,
    points: points.filter((point) => normalizeCurrency(point.currency) === currency),
  };
}
