import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, type PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../types";
import type { AlertRule } from "./types";
import { useAlertsController } from "./useAlertsController";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function account(id: string): Account {
  return { id, alias: id, purpose: "", platform: "zhipu", level: null, is_active: true, is_primary: false };
}

function rule(
  threshold: number,
  accountId: string | null,
  ruleType: AlertRule["rule_type"] = "token_5h",
): AlertRule {
  return {
    id: threshold,
    rule_type: ruleType,
    threshold,
    enabled: true,
    account_id: accountId,
    dedupe_window_mins: 60,
  };
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>;
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

describe("useAlertsController", () => {
  beforeEach(() => invokeMock.mockReset());

  it("A 的慢响应不会覆盖已切换到 B 的规则", async () => {
    const responseA = deferred<AlertRule[]>();
    const responseB = deferred<AlertRule[]>();
    invokeMock.mockImplementation((command: string, args?: { accountId?: string | null }) => {
      if (command === "list_accounts") return Promise.resolve([account("A"), account("B")]);
      if (command === "get_alert_muted") return Promise.resolve(false);
      if (command === "get_alert_rules" && args?.accountId === "A") return responseA.promise;
      if (command === "get_alert_rules" && args?.accountId === "B") return responseB.promise;
      if (command === "get_alert_rules") return Promise.resolve([rule(60, null)]);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useAlertsController());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.selectAccount("A"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_alert_rules", { accountId: "A" }));
    act(() => result.current.selectAccount("B"));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("get_alert_rules", { accountId: "B" }));

    await act(async () => responseB.resolve([rule(60, null), rule(82, "B")]));
    await waitFor(() => expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(82));
    await act(async () => responseA.resolve([rule(60, null), rule(71, "A")]));

    expect(result.current.selectedId).toBe("B");
    expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(82);
  });

  it("账号 A 更新失败只回滚 A，不改动当前账号 B", async () => {
    const updateA = deferred<void>();
    invokeMock.mockImplementation((command: string, args?: { accountId?: string | null }) => {
      if (command === "list_accounts") return Promise.resolve([account("A"), account("B")]);
      if (command === "get_alert_muted") return Promise.resolve(false);
      if (command === "get_alert_rules" && args?.accountId === "A") return Promise.resolve([rule(60, null), rule(70, "A")]);
      if (command === "get_alert_rules" && args?.accountId === "B") return Promise.resolve([rule(60, null), rule(80, "B")]);
      if (command === "get_alert_rules") return Promise.resolve([rule(60, null)]);
      if (command === "update_alert_rule") return updateA.promise;
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useAlertsController());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectAccount("A"));
    await waitFor(() => expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(70));

    act(() => { void result.current.updateRule("token_5h", { threshold: 95 }); });
    expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(95);
    act(() => result.current.selectAccount("B"));
    await waitFor(() => expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(80));
    await act(async () => updateA.reject(new Error("A failed")));

    expect(result.current.selectedId).toBe("B");
    expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(80);
    expect(result.current.errorsByScope.A).toContain("A failed");
    act(() => result.current.selectAccount("A"));
    await waitFor(() => expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(70));
  });

  it("同一账号的失败更新、成功更新与重置严格串行，最终以重置后的权威状态为准", async () => {
    const failedUpdate = deferred<void>();
    const successfulUpdate = deferred<void>();
    const reset = deferred<void>();
    let accountRules = [
      rule(60, null),
      rule(40, null, "mcp_monthly"),
      rule(70, "A"),
      rule(50, "A", "mcp_monthly"),
    ];
    invokeMock.mockImplementation((command: string, args?: { accountId?: string | null; ruleType?: string }) => {
      if (command === "list_accounts") return Promise.resolve([account("A")]);
      if (command === "get_alert_muted") return Promise.resolve(false);
      if (command === "get_alert_rules" && args?.accountId === "A") return Promise.resolve(accountRules);
      if (command === "get_alert_rules") return Promise.resolve([rule(60, null), rule(40, null, "mcp_monthly")]);
      if (command === "update_alert_rule" && args?.ruleType === "token_5h") return failedUpdate.promise;
      if (command === "update_alert_rule" && args?.ruleType === "mcp_monthly") {
        return successfulUpdate.promise.then(() => {
          accountRules = accountRules.map((item) => (
            item.account_id === "A" && item.rule_type === "mcp_monthly"
              ? { ...item, threshold: 80 }
              : item
          ));
        });
      }
      if (command === "reset_account_overrides") {
        return reset.promise.then(() => {
          accountRules = accountRules.filter((item) => item.account_id !== "A");
        });
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useAlertsController());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectAccount("A"));
    await waitFor(() => expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(70));

    act(() => {
      void result.current.updateRule("token_5h", { threshold: 90 });
      void result.current.updateRule("mcp_monthly", { threshold: 80 });
      void result.current.resetToGlobal();
    });

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_alert_rule", expect.objectContaining({
      ruleType: "token_5h",
    })));
    expect(invokeMock.mock.calls.filter(([command]) => command === "update_alert_rule")).toHaveLength(1);
    expect(invokeMock.mock.calls.some(([command]) => command === "reset_account_overrides")).toBe(false);

    await act(async () => failedUpdate.reject(new Error("first failed")));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("update_alert_rule", expect.objectContaining({
      ruleType: "mcp_monthly",
    })));
    expect(invokeMock.mock.calls.some(([command]) => command === "reset_account_overrides")).toBe(false);

    await act(async () => successfulUpdate.resolve());
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("reset_account_overrides", { accountId: "A" }));
    await act(async () => reset.resolve());
    await waitFor(() => expect(result.current.overrides.size).toBe(0));

    expect(result.current.effectiveRules.get("token_5h")?.threshold).toBe(60);
    expect(result.current.effectiveRules.get("mcp_monthly")?.threshold).toBe(40);
  });

  it("StrictMode 初始化重放时忽略第一代迟到响应", async () => {
    const oldAccounts = deferred<Account[]>();
    const oldMuted = deferred<boolean>();
    const newAccounts = deferred<Account[]>();
    const newMuted = deferred<boolean>();
    let accountRequest = 0;
    let mutedRequest = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_accounts") return [oldAccounts.promise, newAccounts.promise][accountRequest++];
      if (command === "get_alert_muted") return [oldMuted.promise, newMuted.promise][mutedRequest++];
      if (command === "get_alert_rules") return Promise.resolve([rule(60, null)]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useAlertsController(), {
      wrapper: StrictModeWrapper,
      reactStrictMode: true,
    });
    await waitFor(() => expect(accountRequest).toBe(2));
    await waitFor(() => expect(mutedRequest).toBe(2));
    await act(async () => {
      newAccounts.resolve([account("new")]);
      newMuted.resolve(false);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.accounts.map(({ id }) => id)).toEqual(["new"]);
    expect(result.current.muted).toBe(false);

    await act(async () => {
      oldAccounts.resolve([account("old")]);
      oldMuted.resolve(true);
    });
    expect(result.current.accounts.map(({ id }) => id)).toEqual(["new"]);
    expect(result.current.muted).toBe(false);
  });
});
