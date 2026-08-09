import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { PREVIEW_ACCOUNTS, PREVIEW_QUOTAS, PREVIEW_RADAR } from "../dev/previewData";
import { isPreviewMode } from "../lib/runtime";
import type { Account, QuotaData } from "../types";

export interface RefreshResult {
  max_pct: number;
  quotas: Record<string, QuotaData>;
}

export interface CodexRadarData {
  best_model: string;
  best_score: number;
  probability_24h: number;
  probability_level: string;
  updated_at: string;
}

function rejectionMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export function useDashboardData() {
  const preview = isPreviewMode();
  const requestId = useRef(0);
  const mounted = useRef(false);
  const [accounts, setAccounts] = useState<Account[]>(preview ? PREVIEW_ACCOUNTS : []);
  const [quotas, setQuotas] = useState<Record<string, QuotaData>>(preview ? PREVIEW_QUOTAS : {});
  const [radar, setRadar] = useState<CodexRadarData | null>(preview ? PREVIEW_RADAR : null);
  const [loading, setLoading] = useState(!preview);
  const [initialized, setInitialized] = useState(preview);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const currentRequest = ++requestId.current;
    const canCommit = () => mounted.current && currentRequest === requestId.current;
    setLoading(true);
    setError("");

    if (isPreviewMode()) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (!canCommit()) return;
      setAccounts(PREVIEW_ACCOUNTS);
      setQuotas(PREVIEW_QUOTAS);
      setRadar(PREVIEW_RADAR);
      setRefreshKey((value) => value + 1);
      setInitialized(true);
      setLoading(false);
      return;
    }

    const accountsTask = Promise.resolve()
      .then(() => invoke<Account[]>("list_accounts"))
      .then(
        (value) => {
          if (canCommit()) setAccounts(value);
          return null;
        },
        (reason: unknown) => rejectionMessage(reason),
      );
    const quotaTask = Promise.resolve()
      .then(() => invoke<RefreshResult>("refresh_all"))
      .then(
        (value) => {
          if (canCommit()) {
            setQuotas(value.quotas);
            setRefreshKey((refreshCount) => refreshCount + 1);
          }
          return null;
        },
        (reason: unknown) => rejectionMessage(reason),
      );

    // 雷达不是完成仪表盘初始化的必要条件，不能阻塞账号与额度提交。
    void Promise.resolve()
      .then(() => invoke<CodexRadarData | null>("get_codex_radar"))
      .then((value) => {
        if (canCommit()) setRadar(value);
      })
      .catch(() => undefined);

    const coreErrors = (await Promise.all([accountsTask, quotaTask]))
      .filter((message): message is string => message !== null);
    if (!canCommit()) return;

    setError(coreErrors.join(" · "));
    setInitialized(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!preview) void refresh();
  }, [preview, refresh]);

  const setPrimary = useCallback(async (id: string) => {
    if (isPreviewMode()) {
      setAccounts((items) => items.map((account) => ({
        ...account,
        is_primary: account.id === id ? !account.is_primary : account.is_primary,
      })));
      return;
    }
    await invoke("set_primary_account", { id });
    await refresh();
  }, [refresh]);

  return {
    accounts,
    quotas,
    radar,
    setRadar,
    loading,
    initialized,
    error,
    refreshKey,
    refresh,
    setPrimary,
  };
}
