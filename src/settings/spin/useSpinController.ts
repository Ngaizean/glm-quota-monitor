import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { supportsSpin } from "../../lib/platform";
import type { Account } from "../../types";
import { getSpinAccounts } from "./spinModel";
import type { SpinConfig, SpinNowResult, SpinStatus } from "./types";

type DraftAction =
  | { type: "replace"; config: SpinConfig | null }
  | { type: "patch"; patch: Partial<SpinConfig> };

function draftReducer(state: SpinConfig | null, action: DraftAction): SpinConfig | null {
  if (action.type === "replace") return action.config;
  return state ? { ...state, ...action.patch } : state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configEquals(left: SpinConfig | null, right: SpinConfig | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useSpinController() {
  const [status, setStatus] = useState<SpinStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, dispatchDraft] = useReducer(draftReducer, null);
  const [baseline, setBaseline] = useState<SpinConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState("");
  const [spinResult, setSpinResult] = useState<SpinNowResult | null>(null);

  const mountedRef = useRef(true);
  const initializeRequestIdRef = useRef(0);
  const draftRef = useRef<SpinConfig | null>(null);
  const draftVersionRef = useRef(0);
  const savingRef = useRef(false);
  const spinningRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++initializeRequestIdRef.current;
    const load = async () => {
      const [statusResult, accountsResult] = await Promise.allSettled([
        invoke<SpinStatus>("get_spin_status"),
        invoke<Account[]>("list_accounts"),
      ]);
      if (!mountedRef.current || requestId !== initializeRequestIdRef.current) return;
      const messages: string[] = [];
      if (statusResult.status === "fulfilled") {
        setStatus(statusResult.value);
        setBaseline(statusResult.value.config);
        draftRef.current = statusResult.value.config;
        dispatchDraft({ type: "replace", config: statusResult.value.config });
      } else {
        messages.push(errorMessage(statusResult.reason));
      }
      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value);
      else messages.push(errorMessage(accountsResult.reason));
      setError(messages.join(" · "));
      setLoading(false);
    };
    void load();
    return () => {
      mountedRef.current = false;
      if (initializeRequestIdRef.current === requestId) initializeRequestIdRef.current += 1;
    };
  }, []);

  const updateDraft = useCallback((patch: Partial<SpinConfig>) => {
    if (!draftRef.current) return;
    draftRef.current = { ...draftRef.current, ...patch };
    draftVersionRef.current += 1;
    dispatchDraft({ type: "patch", patch });
    setSpinResult(null);
  }, []);

  const updatePeakPeriod = useCallback((index: number, start: string) => {
    if (!draftRef.current) return;
    updateDraft({
      peak_periods: draftRef.current.peak_periods.map((period, periodIndex) => (
        periodIndex === index ? { ...period, start } : period
      )),
    });
  }, [updateDraft]);

  const addPeakPeriod = useCallback(() => {
    if (!draftRef.current) return;
    updateDraft({ peak_periods: [...draftRef.current.peak_periods, { start: "19:00" }] });
  }, [updateDraft]);

  const removePeakPeriod = useCallback((index: number) => {
    if (!draftRef.current || draftRef.current.peak_periods.length <= 1) return;
    updateDraft({ peak_periods: draftRef.current.peak_periods.filter((_, periodIndex) => periodIndex !== index) });
  }, [updateDraft]);

  const resetDraft = useCallback(() => {
    if (!baseline) return;
    draftRef.current = baseline;
    draftVersionRef.current += 1;
    dispatchDraft({ type: "replace", config: baseline });
    setError("");
  }, [baseline]);

  const save = useCallback(async () => {
    if (!draftRef.current || savingRef.current) return false;
    const snapshot: SpinConfig = JSON.parse(JSON.stringify(draftRef.current)) as SpinConfig;
    const version = draftVersionRef.current;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      await invoke("set_spin_config", { config: snapshot });
      if (!mountedRef.current) return false;
      setBaseline(snapshot);
      setStatus((current) => current ? { ...current, config: snapshot } : current);
      if (draftVersionRef.current === version) {
        draftRef.current = snapshot;
        dispatchDraft({ type: "replace", config: snapshot });
      }
      return true;
    } catch (saveError) {
      if (mountedRef.current) setError(errorMessage(saveError));
      return false;
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, []);

  const spinNow = useCallback(async () => {
    const accountId = draftRef.current?.account_id;
    const account = accounts.find((item) => item.id === accountId);
    if (!accountId || !account || !supportsSpin(account) || spinningRef.current) return;
    spinningRef.current = true;
    setSpinning(true);
    setError("");
    setSpinResult(null);
    try {
      const result = await invoke<SpinNowResult>("spin_now", { accountId });
      if (!mountedRef.current) return;
      setSpinResult(result);
      try {
        const refreshed = await invoke<SpinStatus>("get_spin_status");
        if (mountedRef.current) {
          setStatus((current) => current
            ? { ...current, last_spin: refreshed.last_spin, next_spin: refreshed.next_spin }
            : refreshed);
        }
      } catch {
        // 执行结果已经可靠返回；状态摘要刷新失败不覆盖该结果。
      }
    } catch (spinError) {
      if (mountedRef.current) setError(errorMessage(spinError));
    } finally {
      spinningRef.current = false;
      if (mountedRef.current) setSpinning(false);
    }
  }, [accounts]);

  const spinAccounts = useMemo(() => getSpinAccounts(accounts), [accounts]);
  const configuredAccount = accounts.find((account) => account.id === draft?.account_id) ?? null;
  const unsupportedAccount = configuredAccount && !supportsSpin(configuredAccount) ? configuredAccount : null;
  const dirty = !configEquals(draft, baseline);

  return {
    status,
    accounts,
    spinAccounts,
    unsupportedAccount,
    draft,
    dirty,
    loading,
    saving,
    spinning,
    error,
    spinResult,
    updateDraft,
    updatePeakPeriod,
    addPeakPeriod,
    removePeakPeriod,
    resetDraft,
    save,
    spinNow,
  };
}

export type SpinController = ReturnType<typeof useSpinController>;
