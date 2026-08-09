import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TrendChart from "./TrendChart";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <>{children}</>,
  LineChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="chart-data" data-points={JSON.stringify(data)}>{children}</div>
  ),
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function point(tokenPct: number) {
  return {
    timestamp: "2026-08-09T10:00:00Z",
    token_pct: tokenPct,
    weekly_pct: 0,
    time_pct: 0,
    mcp_pct: 0,
    tokens_24h: null,
    calls: null,
  };
}

describe("TrendChart", () => {
  beforeEach(() => invokeMock.mockReset());

  it("空数据时仍显示并允许切换时间范围", async () => {
    invokeMock.mockResolvedValue([]);
    render(<TrendChart accountId="account-a" refreshKey={0} />);

    expect(screen.getByRole("tab", { name: "1天" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "7天" }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith(
      "get_token_history",
      { accountId: "account-a", days: 7 },
    ));
    expect(screen.getByRole("tab", { name: "7天" })).toHaveAttribute("aria-selected", "true");
  });

  it("晚到的旧范围请求不能覆盖新范围数据", async () => {
    const oldRequest = deferred<ReturnType<typeof point>[]>();
    const newRequest = deferred<ReturnType<typeof point>[]>();
    invokeMock.mockImplementation((command: string, args?: { days: number }) => {
      if (command !== "get_token_history" || !args) return Promise.resolve(undefined);
      return args.days === 1 ? oldRequest.promise : newRequest.promise;
    });

    render(<TrendChart accountId="account-a" refreshKey={0} />);
    fireEvent.click(screen.getByRole("tab", { name: "7天" }));

    await act(async () => newRequest.resolve([point(70), { ...point(75), timestamp: "2026-08-09T11:00:00Z" }]));
    await waitFor(() => expect(screen.getByTestId("chart-data").dataset.points).toContain('"token_pct":70'));

    await act(async () => oldRequest.resolve([point(10), { ...point(15), timestamp: "2026-08-09T11:00:00Z" }]));
    expect(screen.getByTestId("chart-data").dataset.points).toContain('"token_pct":70');
    expect(screen.getByTestId("chart-data").dataset.points).not.toContain('"token_pct":10');
  });
});
