import { describe, expect, it } from "vitest";
import { formatCurrency } from "../lib/formatters";
import { aggregateDailyRollingTokens, downsampleEvenly, selectDominantCurrency } from "./metrics";

describe("popover metrics", () => {
  it("同一天的 tokens_24h 是滚动快照，取最后一个而不是求和", () => {
    const result = aggregateDailyRollingTokens([
      { timestamp: "2026-08-09T08:00:00Z", tokens_24h: 100 },
      { timestamp: "2026-08-09T09:00:00Z", tokens_24h: 120 },
      { timestamp: "2026-08-09T10:00:00Z", tokens_24h: 150 },
    ]);

    expect(result).toEqual([{ date: "2026-08-09", tokens: 150 }]);
    expect(result[0].tokens).not.toBe(370);
  });

  it("下采样保留首尾且不超过上限", () => {
    const input = Array.from({ length: 1000 }, (_, index) => index);
    const result = downsampleEvenly(input, 100);

    expect(result).toHaveLength(100);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(999);
  });

  it("选择点数最多的币种并保留币种信息", () => {
    const result = selectDominantCurrency([
      { currency: "USD", value: 1 },
      { currency: "CNY", value: 2 },
      { currency: "CNY", value: 3 },
    ]);

    expect(result.currency).toBe("CNY");
    expect(result.points).toHaveLength(2);
  });

  it("按真实币种格式化 CNY 与 USD", () => {
    const cny = formatCurrency(12.5, "CNY", "zh-CN");
    const usd = formatCurrency(12.5, "USD", "en-US");

    expect(cny).toContain("¥");
    expect(usd).toContain("$");
    expect(usd).not.toContain("¥");
  });
});
