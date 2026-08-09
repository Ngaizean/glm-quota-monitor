import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../types";
import { getPlatformAccounts, groupGlmAccountsByAlias } from "./accountModel";
import { useAccountsController } from "./useAccountsController";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function account(id: string, platform?: string, alias = id): Account {
  return {
    id,
    alias,
    purpose: `${id}-purpose`,
    platform,
    level: null,
    is_active: true,
    is_primary: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function mockInitialLoad(accounts: Account[]) {
  invokeMock.mockImplementation((command: string, args?: { accountId?: string }) => {
    if (command === "list_accounts") return Promise.resolve(accounts);
    if (command === "get_agent_bindings") return Promise.resolve([]);
    if (command === "get_default_model") return Promise.resolve("glm-5.2");
    if (command === "read_local_codex_auth") return Promise.resolve({ exists: true });
    if (command === "mask_deepseek_api_key") return Promise.resolve(`masked:${args?.accountId}`);
    if (command === "delete_account") return Promise.resolve();
    return Promise.resolve(undefined);
  });
}

describe("账号视图模型", () => {
  it("兼容旧 GLM 账号并按平台、别名稳定分组", () => {
    const accounts = [
      account("legacy", undefined, "Team A"),
      account("codex", "codex"),
      account("glm", "ZHIPU", "Team A"),
      account("deepseek", "deepseek"),
    ];

    expect(getPlatformAccounts(accounts, "zhipu").map(({ id }) => id)).toEqual(["legacy", "glm"]);
    expect(getPlatformAccounts(accounts, "codex").map(({ id }) => id)).toEqual(["codex"]);
    expect(Object.keys(groupGlmAccountsByAlias(accounts))).toEqual(["Team A"]);
    expect(groupGlmAccountsByAlias(accounts)["Team A"].map(({ id }) => id)).toEqual(["legacy", "glm"]);
  });
});

describe("useAccountsController", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("删除必须先确认，并防止确认按钮双击重复删除", async () => {
    const target = account("glm-1", "zhipu", "Work");
    mockInitialLoad([target]);
    const { result } = renderHook(() => useAccountsController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.requestDelete(target));
    expect(invokeMock).not.toHaveBeenCalledWith("delete_account", expect.anything());

    await act(async () => {
      await Promise.all([
        result.current.confirmDelete(),
        result.current.confirmDelete(),
      ]);
    });

    expect(invokeMock.mock.calls.filter(([command]) => command === "delete_account")).toEqual([
      ["delete_account", { id: "glm-1" }],
    ]);
  });

  it("并行加载 DeepSeek mask，单个失败不会阻断其他账号", async () => {
    const accounts = [account("ds-ok", "deepseek"), account("ds-fail", "deepseek")];
    mockInitialLoad(accounts);
    invokeMock.mockImplementation((command: string, args?: { accountId?: string }) => {
      if (command === "list_accounts") return Promise.resolve(accounts);
      if (command === "get_agent_bindings") return Promise.resolve([]);
      if (command === "get_default_model") return Promise.resolve("glm-5.2");
      if (command === "read_local_codex_auth") return Promise.resolve({ exists: true });
      if (command === "mask_deepseek_api_key" && args?.accountId === "ds-ok") return Promise.resolve("sk-****good");
      if (command === "mask_deepseek_api_key") return Promise.reject(new Error("mask failed"));
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useAccountsController());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.maskedKeys["ds-ok"]).toBe("sk-****good"));

    expect(result.current.accounts).toHaveLength(2);
    expect(result.current.accountErrors["ds-fail"]).toContain("mask failed");
  });

  it("关闭密钥对话框或切换平台后立即清空明文 key", async () => {
    const target = account("ds-1", "deepseek");
    mockInitialLoad([target]);
    invokeMock.mockImplementation((command: string, args?: { accountId?: string }) => {
      if (command === "list_accounts") return Promise.resolve([target]);
      if (command === "get_agent_bindings") return Promise.resolve([]);
      if (command === "get_default_model") return Promise.resolve("glm-5.2");
      if (command === "read_local_codex_auth") return Promise.resolve({ exists: true });
      if (command === "mask_deepseek_api_key") return Promise.resolve("sk-****");
      if (command === "get_deepseek_api_key_raw" && args?.accountId === "ds-1") return Promise.resolve("sk-plain-secret");
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useAccountsController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.openDeepseekSecret(target));
    expect(result.current.secretDialog?.secret).toBe("sk-plain-secret");
    act(() => result.current.closeSecretDialog());
    expect(result.current.secretDialog).toBeNull();

    await act(async () => result.current.openDeepseekSecret(target));
    expect(result.current.secretDialog?.secret).toBe("sk-plain-secret");
    act(() => result.current.changePlatform("codex"));
    expect(result.current.secretDialog).toBeNull();
  });

  it("快速切换模型 picker 时，旧请求不会把模型串到新账号", async () => {
    const first = account("glm-a", "zhipu");
    const second = account("glm-b", "zhipu");
    const modelsA = deferred<string[]>();
    const modelsB = deferred<string[]>();
    mockInitialLoad([first, second]);
    invokeMock.mockImplementation((command: string, args?: { accountId?: string }) => {
      if (command === "list_accounts") return Promise.resolve([first, second]);
      if (command === "get_agent_bindings") return Promise.resolve([]);
      if (command === "get_default_model") return Promise.resolve("glm-5.2");
      if (command === "read_local_codex_auth") return Promise.resolve({ exists: true });
      if (command === "fetch_models" && args?.accountId === "glm-a") return modelsA.promise;
      if (command === "fetch_models" && args?.accountId === "glm-b") return modelsB.promise;
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useAccountsController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => { void result.current.openPicker("claude_code", "glm-a"); });
    act(() => { void result.current.openPicker("claude_code", "glm-b"); });
    await act(async () => modelsA.resolve(["glm-a-only"]));

    expect(result.current.picker?.accountId).toBe("glm-b");
    expect(result.current.pickerModels).toEqual([]);

    await act(async () => modelsB.resolve(["glm-b-only"]));
    expect(result.current.picker?.accountId).toBe("glm-b");
    expect(result.current.pickerModels).toEqual(["glm-b-only"]);
  });
});
