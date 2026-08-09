import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SshHost } from "./types";
import { useCodexController } from "./useCodexController";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function installReadyMock(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    get_codex_role: "consumer",
    get_codex_gist_url: "https://gist.example/raw",
    read_local_codex_auth: {
      exists: true,
      account_id: "account-12345678",
      last_refresh: null,
      access_token_exp: "2099-01-01T00:00:00Z",
    },
    get_codex_sync_info: {
      last_upload: "2026-08-01T00:00:00Z",
      last_sync: "2026-08-02T00:00:00Z",
    },
    get_codex_auto_upload: true,
    get_codex_proxy: "http://127.0.0.1:7890",
    get_codex_auto_sync: false,
    get_ssh_override_state: [],
    list_accounts: [],
    ...overrides,
  };
  invokeMock.mockImplementation((command: string) => {
    const value = values[command];
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  });
}

describe("useCodexController", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("初始化不会读取 GitHub Token，其他配置仍可独立加载", async () => {
    installReadyMock();

    const { result } = renderHook(() => useCodexController());
    await waitFor(() => expect(result.current.initializing).toBe(false));

    expect(result.current.role).toBe("consumer");
    expect(result.current.gistUrl).toBe("https://gist.example/raw");
    expect(result.current.githubToken).toBe("");
    expect(result.current.authSummary?.account_id).toBe("account-12345678");
    expect(result.current.syncInfo?.last_sync).toBe("2026-08-02T00:00:00Z");
    expect(result.current.autoUpload).toBe(true);
    expect(result.current.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(result.current.autoSync).toBe(false);
    expect(result.current.error).toBe("");
    expect(invokeMock).not.toHaveBeenCalledWith("get_codex_github_token");
  });

  it("仅按需读取 Token，并在关闭访问后清空原文", async () => {
    installReadyMock({ get_codex_github_token: "github-secret" });
    const { result } = renderHook(() => useCodexController());
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => { await result.current.loadGithubToken(); });
    expect(invokeMock).toHaveBeenCalledWith("get_codex_github_token");
    expect(result.current.githubToken).toBe("github-secret");
    expect(result.current.githubTokenConfigured).toBe(true);

    act(() => result.current.clearGithubToken());
    expect(result.current.githubToken).toBe("");
    expect(result.current.githubTokenConfigured).toBe(true);
  });

  it("Token 保存成功后不在 React 状态中长期保留原文", async () => {
    installReadyMock({ get_codex_github_token: "old-secret" });
    const { result } = renderHook(() => useCodexController());
    await waitFor(() => expect(result.current.initializing).toBe(false));
    await act(async () => { await result.current.loadGithubToken(); });

    act(() => result.current.setGithubToken("new-secret"));
    await act(async () => { await result.current.saveGithubToken(); });

    expect(invokeMock).toHaveBeenCalledWith("set_codex_github_token", { token: "new-secret" });
    expect(result.current.githubToken).toBe("");
    expect(result.current.githubTokenConfigured).toBe(true);
  });

  it("角色快速连续切换会串行合并，旧请求失败不能回滚新选择", async () => {
    const firstWrite = deferred<void>();
    installReadyMock({ get_codex_role: "owner" });
    invokeMock.mockImplementation((command: string, args?: { role?: string }) => {
      if (command === "set_codex_role" && args?.role === "consumer") return firstWrite.promise;
      if (command === "set_codex_role") return Promise.resolve();
      const values: Record<string, unknown> = {
        get_codex_role: "owner", get_codex_gist_url: "https://gist.example/raw",
        read_local_codex_auth: { exists: true, account_id: "a", last_refresh: null, access_token_exp: null },
        get_codex_sync_info: { last_upload: null, last_sync: null }, get_codex_auto_upload: false,
        get_codex_proxy: "", get_codex_auto_sync: true, get_ssh_override_state: [], list_accounts: [],
      };
      return Promise.resolve(values[command]);
    });
    const { result } = renderHook(() => useCodexController());
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      void result.current.setRole("consumer");
      void result.current.setRole("owner");
    });
    expect(result.current.roleSaving).toBe(true);
    expect(result.current.role).toBe("owner");
    expect(invokeMock.mock.calls.filter(([command]) => command === "set_codex_role")).toHaveLength(1);

    await act(async () => firstWrite.reject(new Error("stale role failure")));
    await waitFor(() => expect(result.current.roleSaving).toBe(false));
    expect(result.current.role).toBe("owner");
    expect(invokeMock.mock.calls.filter(([command]) => command === "set_codex_role")).toEqual([
      ["set_codex_role", { role: "consumer" }],
      ["set_codex_role", { role: "owner" }],
    ]);
    expect(result.current.error).not.toContain("stale role failure");
  });

  it.each([
    ["自动同步", "toggleAutoSync", "autoSyncSaving", "set_codex_auto_sync", "get_codex_auto_sync"],
    ["自动上传", "toggleAutoUpload", "autoUploadSaving", "set_codex_auto_upload", "get_codex_auto_upload"],
  ] as const)("%s 快速连续切换时仅串行执行并保持最新状态", async (
    _label, toggleKey, pendingKey, setCommand, getCommand,
  ) => {
    const firstWrite = deferred<void>();
    installReadyMock({ [getCommand]: false });
    let writes = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === setCommand) {
        writes += 1;
        return writes === 1 ? firstWrite.promise : Promise.resolve();
      }
      const values: Record<string, unknown> = {
        get_codex_role: "owner", get_codex_gist_url: "https://gist.example/raw",
        read_local_codex_auth: { exists: true, account_id: "a", last_refresh: null, access_token_exp: null },
        get_codex_sync_info: { last_upload: null, last_sync: null }, get_codex_auto_upload: false,
        get_codex_proxy: "", get_codex_auto_sync: false, get_ssh_override_state: [], list_accounts: [],
      };
      return Promise.resolve(values[command]);
    });
    const { result } = renderHook(() => useCodexController());
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      void result.current[toggleKey](true);
      void result.current[toggleKey](false);
    });
    expect(result.current[pendingKey]).toBe(true);
    expect(invokeMock.mock.calls.filter(([command]) => command === setCommand)).toHaveLength(1);

    await act(async () => firstWrite.resolve());
    await waitFor(() => expect(result.current[pendingKey]).toBe(false));
    expect(result.current[toggleKey === "toggleAutoSync" ? "autoSync" : "autoUpload"]).toBe(false);
    expect(invokeMock.mock.calls.filter(([command]) => command === setCommand)).toEqual([
      [setCommand, { enabled: true }],
      [setCommand, { enabled: false }],
    ]);
  });

  it("不同主机的推送 pending 可并行，完成一台不会清掉另一台", async () => {
    const firstPush = deferred<void>();
    const secondPush = deferred<void>();
    installReadyMock();
    invokeMock.mockImplementation((command: string, args?: { host?: string }) => {
      if (command === "check_ssh_passwordless") return Promise.resolve(true);
      if (command === "ssh_push_auth" && args?.host === "alpha") return firstPush.promise;
      if (command === "ssh_push_auth" && args?.host === "beta") return secondPush.promise;
      const values: Record<string, unknown> = {
        get_codex_role: "owner",
        get_codex_gist_url: "https://gist.example/raw",
        get_codex_github_token: "token",
        read_local_codex_auth: { exists: true, account_id: "a", last_refresh: null, access_token_exp: null },
        get_codex_sync_info: { last_upload: null, last_sync: null },
        get_codex_auto_upload: false,
        get_codex_proxy: "",
        get_codex_auto_sync: true,
        get_ssh_override_state: [],
        list_accounts: [],
      };
      return Promise.resolve(values[command]);
    });
    const alpha: SshHost = {
      alias: "alpha", hostname: "alpha.local", user: "me", port: 22,
      identity_file: null, has_local_key: true,
    };
    const beta: SshHost = { ...alpha, alias: "beta", hostname: "beta.local" };
    const { result } = renderHook(() => useCodexController());
    await waitFor(() => expect(result.current.initializing).toBe(false));

    act(() => {
      void result.current.pushHost(alpha);
      void result.current.pushHost(beta);
    });
    await waitFor(() => expect([...result.current.pendingHosts]).toEqual(expect.arrayContaining(["alpha", "beta"])));

    await act(async () => firstPush.resolve());
    await waitFor(() => expect(result.current.pendingHosts.has("alpha")).toBe(false));
    expect(result.current.pendingHosts.has("beta")).toBe(true);

    await act(async () => secondPush.resolve());
    await waitFor(() => expect(result.current.pendingHosts.size).toBe(0));
  });
});
