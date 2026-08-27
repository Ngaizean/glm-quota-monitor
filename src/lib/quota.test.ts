import { describe, expect, it } from "vitest";
import type { QuotaLimit } from "../types";
import { clampPercentage, getQuotaSummary, partitionQuotaLimits } from "./quota";

const limit = (partial: Partial<QuotaLimit>): QuotaLimit => ({
  type: "TOKENS_LIMIT",
  percentage: 0,
  nextResetTime: 0,
  ...partial,
});

describe("quota helpers", () => {
  it("把百分比限制在可展示范围", () => {
    expect(clampPercentage(-8)).toBe(0);
    expect(clampPercentage(62.4)).toBe(62.4);
    expect(clampPercentage(120)).toBe(100);
    expect(clampPercentage(Number.NaN)).toBe(0);
  });

  it("稳定分类额度且不修改输入", () => {
    const limits = [
      limit({ type: "MCP_MONTHLY", percentage: 25 }),
      limit({ unit: 6, percentage: 72 }),
      limit({ type: "SOMETHING_NEW", percentage: 9 }),
      limit({ unit: 3, percentage: 41 }),
      limit({ type: "TIME_LIMIT", percentage: 18 }),
    ];
    const snapshot = [...limits];

    const result = partitionQuotaLimits(limits);

    expect(result.hourly?.percentage).toBe(41);
    expect(result.weekly?.percentage).toBe(72);
    expect(result.time?.percentage).toBe(18);
    expect(result.mcp?.percentage).toBe(25);
    expect(result.other).toHaveLength(1);
    expect(limits).toEqual(snapshot);
  });

  it("摘要优先选择 5h 和周额度并返回最高风险", () => {
    const summary = getQuotaSummary([
      limit({ unit: 6, percentage: 91 }),
      limit({ unit: 3, percentage: 62 }),
    ]);

    expect(summary.primary?.percentage).toBe(62);
    expect(summary.secondary?.percentage).toBe(91);
    expect(summary.maxPercentage).toBe(91);
    expect(summary.status).toBe("critical");
  });

  it("中转余额单独分类且不参与百分比风险计算", () => {
    const relay = limit({ type: "RELAY_BALANCE", currentValue: 480, remaining: 480 });
    const result = partitionQuotaLimits([relay]);
    const summary = getQuotaSummary([relay]);

    expect(result.relayBalance).toBe(relay);
    expect(result.other).toEqual([]);
    expect(summary.primary).toBeNull();
    expect(summary.maxPercentage).toBe(0);
  });
});
