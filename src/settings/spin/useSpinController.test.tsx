import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../types";
import { getSpinAccounts } from "./spinModel";
import type { SpinStatus } from "./types";
import { useSpinController } from "./useSpinController";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function account(id: string, platform?: string): Account {
  return { id, alias: id, purpose: `${id}-purpose`, platform, level: null, is_active: true, is_primary: false };
}

function status(accountId: string | null = "glm"): SpinStatus {
  return {
    config: {
      enabled: true,
      mode: "peak",
      peak_periods: [{ start: "09:00" }],
      lead_minutes: 60,
      fixed_time: "07:00",
      account_id: accountId,
    },
    last_spin: null,
    next_spin: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
}

describe("spin 账号模型", () => {
  it("选择器只包含 GLM，并兼容无 platform 的旧 GLM 账号", () => {
    const accounts = [account("legacy"), account("glm", "zhipu"), account("codex", "codex"), account("ds", "deepseek")];
    expect(getSpinAccounts(accounts).map(({ id }) => id)).toEqual(["legacy", "glm"]);
  });
});

describe("useSpinController", () => {
  beforeEach(() => invokeMock.mockReset());

  it("连续修改两个字段不会丢配置或被服务端旧状态回弹，保存发送完整草稿", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_spin_status") return Promise.resolve(status());
      if (command === "list_accounts") return Promise.resolve([account("glm", "zhipu")]);
      if (command === "set_spin_config") return Promise.resolve();
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useSpinController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.updateDraft({ mode: "fixed" });
      result.current.updateDraft({ fixed_time: "21:30" });
    });

    expect(result.current.draft?.mode).toBe("fixed");
    expect(result.current.draft?.fixed_time).toBe("21:30");
    expect(invokeMock.mock.calls.some(([command]) => command === "set_spin_config")).toBe(false);

    await act(async () => result.current.save());
    expect(invokeMock).toHaveBeenCalledWith("set_spin_config", {
      config: expect.objectContaining({ mode: "fixed", fixed_time: "21:30", lead_minutes: 60 }),
    });
    expect(result.current.draft?.fixed_time).toBe("21:30");
    expect(result.current.dirty).toBe(false);
  });

  it("非 GLM 旧配置保留但明确标记为不受支持", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_spin_status") return Promise.resolve(status("codex"));
      if (command === "list_accounts") return Promise.resolve([account("glm", "zhipu"), account("codex", "codex")]);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useSpinController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.spinAccounts.map(({ id }) => id)).toEqual(["glm"]);
    expect(result.current.unsupportedAccount?.id).toBe("codex");
    expect(result.current.draft?.account_id).toBe("codex");
  });

  it("spin_now 保留并展示 executed 结果", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_spin_status") return Promise.resolve(status());
      if (command === "list_accounts") return Promise.resolve([account("glm", "zhipu")]);
      if (command === "spin_now") return Promise.resolve({ executed: true, message: "sent" });
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useSpinController());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => result.current.spinNow());

    expect(invokeMock).toHaveBeenCalledWith("spin_now", { accountId: "glm" });
    expect(result.current.spinResult).toEqual({ executed: true, message: "sent" });
  });

  it("StrictMode 初始化重放时忽略第一代迟到响应", async () => {
    const oldStatus = deferred<SpinStatus>();
    const oldAccounts = deferred<Account[]>();
    const newStatus = deferred<SpinStatus>();
    const newAccounts = deferred<Account[]>();
    let statusRequest = 0;
    let accountRequest = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "get_spin_status") return [oldStatus.promise, newStatus.promise][statusRequest++];
      if (command === "list_accounts") return [oldAccounts.promise, newAccounts.promise][accountRequest++];
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useSpinController(), {
      wrapper: StrictModeWrapper,
      reactStrictMode: true,
    });
    await waitFor(() => expect(statusRequest).toBe(2));
    await waitFor(() => expect(accountRequest).toBe(2));
    await act(async () => {
      newStatus.resolve(status("new"));
      newAccounts.resolve([account("new", "zhipu")]);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts.map(({ id }) => id)).toEqual(["new"]);
    expect(result.current.draft?.account_id).toBe("new");

    await act(async () => {
      oldStatus.resolve(status("old"));
      oldAccounts.resolve([account("old", "zhipu")]);
    });
    expect(result.current.accounts.map(({ id }) => id)).toEqual(["new"]);
    expect(result.current.draft?.account_id).toBe("new");
  });
});
