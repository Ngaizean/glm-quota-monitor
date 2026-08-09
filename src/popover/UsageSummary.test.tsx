import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import UsageSummary from "./UsageSummary";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("UsageSummary", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_usage_summary") {
        return Promise.resolve({
          today: { label: "today", total_tokens: 0, total_calls: 0 },
          last_7d: { label: "7d", total_tokens: 0, total_calls: 0 },
          last_30d: { label: "30d", total_tokens: 0, total_calls: 0 },
        });
      }
      if (command === "get_token_history") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
  });

  it("把有效的 0% 显示为 0% 而不是缺失占位", async () => {
    render(<UsageSummary accountId="account-a" tokenPct={0} refreshKey={0} />);

    expect(await screen.findByText("0%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
