import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";

export interface Sub2apiConfig {
  base_url: string;
  admin_email: string | null;
  has_password: boolean;
  model: string;
  lan_ip: string | null;
}

export interface DeployResult {
  import_stats: { account_created: number; account_failed: number; errors: string[] };
  group_name: string;
  api_key: string;
  bound_account_ids: number[];
}

export interface Sub2apiAccount {
  id: number;
  name: string;
  platform: string;
  type: string;
  status: string;
}

export interface Sub2apiGroup {
  id: number;
  name: string;
  platform: string;
  status: string;
}

function errMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSub2apiController() {
  const [config, setConfig] = useState<Sub2apiConfig | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [accounts, setAccounts] = useState<Sub2apiAccount[]>([]);
  const [groups, setGroups] = useState<Sub2apiGroup[]>([]);

  const loadConfig = useCallback(async () => {
    setError("");
    try {
      setConfig(await invoke<Sub2apiConfig>("get_sub2api_config"));
    } catch (e) {
      setError(errMessage(e));
    }
  }, []);

  const saveConfig = useCallback(async (patch: {
    base_url?: string;
    admin_email?: string;
    admin_password?: string;
    model?: string;
  }) => {
    setError("");
    setBusy("save");
    try {
      await invoke("set_sub2api_config", patch);
      await loadConfig();
      setNotice("已保存");
      return true;
    } catch (e) {
      setError(errMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  }, [loadConfig]);

  const testConnection = useCallback(async (password?: string) => {
    setError("");
    setBusy("test");
    try {
      const result = await invoke<{ accounts: number; groups: number }>(
        "sub2api_test_connection",
        password ? { password } : undefined,
      );
      setNotice(`连接正常：${result.accounts} 个账号 / ${result.groups} 个分组`);
      return true;
    } catch (e) {
      setError(errMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  }, []);

  const deploy = useCallback(async (json: string, password?: string) => {
    setError("");
    setBusy("deploy");
    try {
      const result = await invoke<DeployResult>("sub2api_deploy", {
        json,
        ...(password ? { password } : {}),
      });
      return result;
    } catch (e) {
      setError(errMessage(e));
      return null;
    } finally {
      setBusy("");
    }
  }, []);

  const applyLocal = useCallback(async (apiKey: string) => {
    setError("");
    setBusy("applyLocal");
    try {
      const result = await invoke<{ backup: string; base_url: string; model: string }>(
        "sub2api_apply_local",
        { apiKey },
      );
      setNotice(`已写入本机 ~/.codex/config.toml（备份: ${result.backup.split("/").pop() ?? ""}）`);
      return true;
    } catch (e) {
      setError(errMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  }, []);

  const applyRemote = useCallback(async (host: string, apiKey: string, password?: string) => {
    setError("");
    setBusy("applyRemote");
    try {
      const result = await invoke<{ base_url: string; model: string }>("sub2api_apply_remote", {
        host,
        apiKey,
        ...(password ? { password } : {}),
      });
      setNotice(`已写入 ${host} 的 ~/.codex/config.toml（${result.base_url}）`);
      return true;
    } catch (e) {
      setError(errMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    setError("");
    setBusy("status");
    try {
      const result = await invoke<{ accounts: Sub2apiAccount[]; groups: Sub2apiGroup[] }>(
        "sub2api_status",
      );
      setAccounts(result.accounts);
      setGroups(result.groups);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy("");
    }
  }, []);

  const topup = useCallback(async (amount: number, password?: string) => {
    setError("");
    setBusy("topup");
    try {
      const balance = await invoke<number>("sub2api_topup", {
        amount,
        ...(password ? { password } : {}),
      });
      setNotice(`充值成功，当前余额 ${balance}`);
      return true;
    } catch (e) {
      setError(errMessage(e));
      return false;
    } finally {
      setBusy("");
    }
  }, []);

  return {
    config,
    busy,
    error,
    notice,
    accounts,
    groups,
    loadConfig,
    saveConfig,
    testConnection,
    deploy,
    applyLocal,
    applyRemote,
    refreshStatus,
    topup,
    setError,
  };
}

export type Sub2apiController = ReturnType<typeof useSub2apiController>;
