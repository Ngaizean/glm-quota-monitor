import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeepSeekBalanceBadge from "./DeepSeekBalanceBadge";
import DeepSeekBalanceBar from "./DeepSeekBalanceBar";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("DeepSeek 余额币种", () => {
  beforeEach(() => invokeMock.mockReset());

  it("紧凑额度没有币种字段时不伪造人民币符号", () => {
    render(<DeepSeekBalanceBadge quota={{
      limits: [{ type: "DEEPSEEK_BALANCE", percentage: 0, nextResetTime: 0, currentValue: 12.5 }],
      level: null,
      last_active: null,
    }} />);

    expect(screen.getByTitle("账户余额")).not.toHaveTextContent("¥");
  });

  it("富余额按每条记录的 CNY/USD 币种显示", async () => {
    invokeMock.mockResolvedValue({
      isAvailable: true,
      balances: [
        { currency: "CNY", total: 12.5, granted: 2, toppedUp: 10.5 },
        { currency: "USD", total: 3.5, granted: 1, toppedUp: 2.5 },
      ],
      models: [],
      level: null,
      lastActive: null,
    });

    render(<DeepSeekBalanceBar accountId="deepseek-a" refreshKey={0} />);

    expect(await screen.findByText((content) => content.includes("¥12.50"))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("US$3.50"))).toBeInTheDocument();
  });
});
