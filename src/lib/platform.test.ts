import { describe, expect, it } from "vitest";
import type { Account } from "../types";
import { groupAccountsByPlatform, normalizePlatform } from "./platform";

const account = (id: string, platform?: string): Account => ({
  id,
  alias: id,
  purpose: "",
  platform,
  level: null,
  is_active: true,
  is_primary: false,
});

describe("platform helpers", () => {
  it("规范化大小写并兼容旧账号", () => {
    expect(normalizePlatform("CODEX")).toBe("codex");
    expect(normalizePlatform("DeepSeek")).toBe("deepseek");
    expect(normalizePlatform(undefined)).toBe("zhipu");
    expect(normalizePlatform("unknown")).toBe("zhipu");
  });

  it("按稳定顺序分组，且保持组内原顺序", () => {
    const groups = groupAccountsByPlatform([
      account("c1", "codex"),
      account("g1"),
      account("d1", "deepseek"),
      account("g2", "ZHIPU"),
    ]);

    expect(groups.map((group) => group.platform)).toEqual(["zhipu", "codex", "deepseek"]);
    expect(groups[0].accounts.map(({ id }) => id)).toEqual(["g1", "g2"]);
  });
});
