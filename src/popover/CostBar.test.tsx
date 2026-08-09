import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CostBar from "./CostBar";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const estimate = {
  today_cost: 1,
  cost_7d: 7,
  cost_30d: 30,
  plan_price: 149,
  daily_avg: 1,
  ratio: 30 / 149,
  unit_price: 10,
  weighted: false,
};

describe("CostBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_cost_estimate") return Promise.resolve(estimate);
      if (command === "get_unit_price") return Promise.resolve(10);
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => vi.useRealTimers());

  async function renderLoaded(accountId = "account-a") {
    const view = render(<CostBar accountId={accountId} refreshKey={0} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return view;
  }

  it("允许保存显式的 0 值", async () => {
    await renderLoaded();
    fireEvent.change(screen.getByRole("spinbutton", { name: "包月" }), { target: { value: "0" } });
    await act(async () => vi.advanceTimersByTime(600));

    expect(invokeMock).toHaveBeenCalledWith("set_plan_price", { accountId: "account-a", price: 0 });
  });

  it("切换账号会取消旧账号尚未执行的保存", async () => {
    const { rerender } = await renderLoaded();
    fireEvent.change(screen.getByRole("spinbutton", { name: "包月" }), { target: { value: "42" } });
    rerender(<CostBar accountId="account-b" refreshKey={0} />);
    await act(async () => vi.advanceTimersByTime(600));

    expect(invokeMock).not.toHaveBeenCalledWith("set_plan_price", { accountId: "account-a", price: 42 });
  });

  it("卸载会取消尚未执行的保存", async () => {
    const { unmount } = await renderLoaded();
    fireEvent.change(screen.getByRole("spinbutton", { name: "包月" }), { target: { value: "56" } });
    unmount();
    await act(async () => vi.advanceTimersByTime(600));

    expect(invokeMock).not.toHaveBeenCalledWith("set_plan_price", { accountId: "account-a", price: 56 });
  });
});
