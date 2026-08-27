import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RelayUsagePanel from "./RelayUsagePanel";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("RelayUsagePanel", () => {
  beforeEach(() => invokeMock.mockReset());

  it("展示中转站余额以及今日和累计用量", async () => {
    invokeMock.mockResolvedValue({
      isValid: true,
      planName: "钱包余额",
      mode: "unrestricted",
      balance: 480,
      remaining: 480,
      unit: "USD",
      today: { cost: 1.5, actualCost: 1.2, totalTokens: 100, inputTokens: 60, outputTokens: 40, requests: 3 },
      total: { cost: 20, actualCost: 18, totalTokens: 1000, inputTokens: 600, outputTokens: 400, requests: 30 },
      fetchedAt: "2026-08-27T16:00:00+08:00",
    });

    render(<RelayUsagePanel refreshKey={0} />);

    expect(await screen.findByText("US$480.00")).toBeInTheDocument();
    expect(screen.getByText("今日用量")).toBeInTheDocument();
    expect(screen.getByText("累计用量")).toBeInTheDocument();
    expect(screen.getByText("1.5")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });
});
