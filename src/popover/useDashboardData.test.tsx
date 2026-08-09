import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, QuotaData } from "../types";
import { useDashboardData } from "./useDashboardData";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("useDashboardData", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    invokeMock.mockReset();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_accounts") return Promise.resolve([]);
      if (command === "refresh_all") return Promise.resolve({ max_pct: 0, quotas: {} });
      if (command === "get_codex_radar") return Promise.resolve(null);
      return Promise.resolve(undefined);
    });
  });

  it("在 React StrictMode 的 effect 重放后仍能完成初始化", async () => {
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useDashboardData(), { wrapper });

    await waitFor(() => expect(result.current.initialized).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("mount、focus、manual 并发时慢旧响应不能覆盖快新响应", async () => {
    const batches = Array.from({ length: 3 }, () => ({
      accounts: deferred<Account[]>(),
      quotas: deferred<{ max_pct: number; quotas: Record<string, QuotaData> }>(),
      radar: deferred<null>(),
    }));
    const commandIndex = new Map<string, number>();
    invokeMock.mockImplementation((command: string) => {
      const index = commandIndex.get(command) ?? 0;
      commandIndex.set(command, index + 1);
      if (command === "list_accounts") return batches[index].accounts.promise;
      if (command === "refresh_all") return batches[index].quotas.promise;
      if (command === "get_codex_radar") return batches[index].radar.promise;
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useDashboardData());
    let focusRefresh!: Promise<void>;
    let manualRefresh!: Promise<void>;
    act(() => {
      focusRefresh = result.current.refresh();
      manualRefresh = result.current.refresh();
    });

    await act(async () => {
      resolveBatch(batches[2], "new");
      await manualRefresh;
    });
    expect(result.current.accounts[0]?.id).toBe("new");
    expect(result.current.quotas).toHaveProperty("new");

    await act(async () => {
      resolveBatch(batches[1], "focus-old");
      await focusRefresh;
      resolveBatch(batches[0], "mount-old");
      await Promise.resolve();
    });
    expect(result.current.accounts[0]?.id).toBe("new");
    expect(result.current.quotas).toHaveProperty("new");
    expect(result.current.quotas).not.toHaveProperty("focus-old");
    expect(result.current.quotas).not.toHaveProperty("mount-old");
  });

  it("账号列表失败时仍立即提交成功的 quota，不等待雷达", async () => {
    const radar = deferred<null>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_accounts") return Promise.reject(new Error("accounts offline"));
      if (command === "refresh_all") return Promise.resolve({ max_pct: 10, quotas: { a: quota() } });
      if (command === "get_codex_radar") return radar.promise;
      return Promise.resolve(undefined);
    });

    const { result, unmount } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.quotas).toHaveProperty("a"));
    expect(result.current.error).toContain("accounts offline");
    expect(result.current.initialized).toBe(true);
    unmount();
    radar.resolve(null);
  });

  it("quota 失败时仍立即提交成功的账号列表，不等待雷达", async () => {
    const radar = deferred<null>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_accounts") return Promise.resolve([account("a")]);
      if (command === "refresh_all") return Promise.reject(new Error("quota offline"));
      if (command === "get_codex_radar") return radar.promise;
      return Promise.resolve(undefined);
    });

    const { result, unmount } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.accounts[0]?.id).toBe("a"));
    expect(result.current.error).toContain("quota offline");
    expect(result.current.initialized).toBe(true);
    unmount();
    radar.resolve(null);
  });

  it("卸载后忽略仍在途的响应", async () => {
    const accounts = deferred<Account[]>();
    const quotas = deferred<{ max_pct: number; quotas: Record<string, QuotaData> }>();
    const radar = deferred<null>();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_accounts") return accounts.promise;
      if (command === "refresh_all") return quotas.promise;
      if (command === "get_codex_radar") return radar.promise;
      return Promise.resolve(undefined);
    });

    const { result, unmount } = renderHook(() => useDashboardData());
    unmount();
    await act(async () => {
      accounts.resolve([account("late")]);
      quotas.resolve({ max_pct: 1, quotas: { late: quota() } });
      radar.resolve(null);
      await Promise.resolve();
    });

    expect(result.current.accounts).toEqual([]);
    expect(result.current.quotas).toEqual({});
    expect(result.current.refreshKey).toBe(0);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function account(id: string): Account {
  return { id, alias: id, purpose: "test", platform: "zhipu", level: null, is_active: true, is_primary: false };
}

function quota(): QuotaData {
  return { limits: [], level: null, last_active: null };
}

function resolveBatch(
  batch: {
    accounts: ReturnType<typeof deferred<Account[]>>;
    quotas: ReturnType<typeof deferred<{ max_pct: number; quotas: Record<string, QuotaData> }>>;
    radar: ReturnType<typeof deferred<null>>;
  },
  id: string,
) {
  batch.accounts.resolve([account(id)]);
  batch.quotas.resolve({ max_pct: 0, quotas: { [id]: quota() } });
  batch.radar.resolve(null);
}
