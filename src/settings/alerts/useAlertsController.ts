import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Account } from "../../types";
import {
  alertScopeKey,
  getEffectiveRules,
  getOverrides,
  patchRuleLayer,
} from "./alertModel";
import type { AlertRule, AlertRulePatch, AlertRuleType } from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAlertsController() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rulesByScope, setRulesByScope] = useState<Record<string, AlertRule[]>>({});
  const [muted, setMuted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [mutating, setMutating] = useState<Set<string>>(() => new Set());
  const [errorsByScope, setErrorsByScope] = useState<Record<string, string>>({});

  const mountedRef = useRef(true);
  const selectedIdRef = useRef<string | null>(null);
  const rulesRef = useRef<Record<string, AlertRule[]>>({});
  const initializeRequestIdRef = useRef(0);
  const loadVersionRef = useRef(0);
  const mutationVersionsRef = useRef<Record<string, number>>({});
  const queuesRef = useRef<Record<string, Promise<void>>>({});

  const replaceScopeRules = useCallback((accountId: string | null, rules: AlertRule[]) => {
    const scope = alertScopeKey(accountId);
    rulesRef.current = { ...rulesRef.current, [scope]: rules };
    if (mountedRef.current) setRulesByScope(rulesRef.current);
  }, []);

  const setScopeError = useCallback((accountId: string | null, message?: string) => {
    const scope = alertScopeKey(accountId);
    setErrorsByScope((current) => {
      const next = { ...current };
      if (message) next[scope] = message;
      else delete next[scope];
      return next;
    });
  }, []);

  const loadRules = useCallback(async (accountId: string | null, showLoading = true) => {
    const version = ++loadVersionRef.current;
    if (showLoading) setRulesLoading(true);
    setScopeError(accountId);
    try {
      const rules = await invoke<AlertRule[]>("get_alert_rules", { accountId });
      if (!mountedRef.current || version !== loadVersionRef.current || selectedIdRef.current !== accountId) return;
      replaceScopeRules(accountId, rules);
    } catch (error) {
      if (!mountedRef.current || version !== loadVersionRef.current || selectedIdRef.current !== accountId) return;
      replaceScopeRules(accountId, []);
      setScopeError(accountId, errorMessage(error));
    } finally {
      if (mountedRef.current && version === loadVersionRef.current && selectedIdRef.current === accountId) {
        setRulesLoading(false);
      }
    }
  }, [replaceScopeRules, setScopeError]);

  const reloadScopeRules = useCallback(async (accountId: string | null) => {
    const rules = await invoke<AlertRule[]>("get_alert_rules", { accountId });
    if (mountedRef.current) replaceScopeRules(accountId, rules);
  }, [replaceScopeRules]);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++initializeRequestIdRef.current;
    const initialize = async () => {
      const [accountsResult, mutedResult] = await Promise.allSettled([
        invoke<Account[]>("list_accounts"),
        invoke<boolean>("get_alert_muted"),
      ]);
      if (!mountedRef.current || requestId !== initializeRequestIdRef.current) return;
      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value);
      else setScopeError(null, errorMessage(accountsResult.reason));
      if (mutedResult.status === "fulfilled") setMuted(mutedResult.value);
      else setScopeError(null, errorMessage(mutedResult.reason));
      await loadRules(null);
      if (mountedRef.current && requestId === initializeRequestIdRef.current) setLoading(false);
    };
    void initialize();
    return () => {
      mountedRef.current = false;
      if (initializeRequestIdRef.current === requestId) initializeRequestIdRef.current += 1;
      loadVersionRef.current += 1;
    };
  }, [loadRules, setScopeError]);

  const selectAccount = useCallback((accountId: string | null) => {
    if (selectedIdRef.current === accountId) return;
    selectedIdRef.current = accountId;
    setSelectedId(accountId);
    void loadRules(accountId);
  }, [loadRules]);

  const markMutating = useCallback((key: string, active: boolean) => {
    setMutating((current) => {
      const next = new Set(current);
      if (active) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const updateRule = useCallback(async (ruleType: AlertRuleType, patch: AlertRulePatch) => {
    const accountId = selectedIdRef.current;
    const scope = alertScopeKey(accountId);
    const operationKey = `${scope}:${ruleType}`;
    const optimisticRules = patchRuleLayer(rulesRef.current[scope] ?? [], accountId, ruleType, patch);
    replaceScopeRules(accountId, optimisticRules);
    setScopeError(accountId);
    markMutating(operationKey, true);

    const version = (mutationVersionsRef.current[operationKey] ?? 0) + 1;
    mutationVersionsRef.current[operationKey] = version;
    const previousQueue = queuesRef.current[scope] ?? Promise.resolve();
    const request = previousQueue.then(async () => {
      try {
        await invoke<void>("update_alert_rule", {
          ruleType,
          threshold: patch.threshold ?? null,
          enabled: patch.enabled ?? null,
          dedupeWindowMins: patch.dedupe_window_mins ?? null,
          accountId,
        });
        if (mountedRef.current) {
          replaceScopeRules(
            accountId,
            patchRuleLayer(rulesRef.current[scope] ?? [], accountId, ruleType, patch),
          );
        }
      } catch (error) {
        if (!mountedRef.current) return;
        let message = errorMessage(error);
        try {
          await reloadScopeRules(accountId);
        } catch (reloadError) {
          message = `${message} · ${errorMessage(reloadError)}`;
        }
        if (mountedRef.current) setScopeError(accountId, message);
      }
    });
    queuesRef.current[scope] = request;

    try {
      await request;
    } finally {
      if (mountedRef.current && mutationVersionsRef.current[operationKey] === version) {
        markMutating(operationKey, false);
      }
      if (queuesRef.current[scope] === request) delete queuesRef.current[scope];
    }
  }, [markMutating, reloadScopeRules, replaceScopeRules, setScopeError]);

  const resetToGlobal = useCallback(async () => {
    const accountId = selectedIdRef.current;
    if (!accountId) return;
    const scope = alertScopeKey(accountId);
    const operationKey = `${scope}:reset`;
    const version = (mutationVersionsRef.current[operationKey] ?? 0) + 1;
    mutationVersionsRef.current[operationKey] = version;
    markMutating(operationKey, true);
    setScopeError(accountId);
    const previousQueue = queuesRef.current[scope] ?? Promise.resolve();
    const request = previousQueue.then(async () => {
      try {
        await invoke("reset_account_overrides", { accountId });
        if (!mountedRef.current) return;
        replaceScopeRules(
          accountId,
          (rulesRef.current[scope] ?? []).filter((rule) => rule.account_id !== accountId),
        );
        await reloadScopeRules(accountId);
      } catch (error) {
        if (!mountedRef.current) return;
        let message = errorMessage(error);
        try {
          await reloadScopeRules(accountId);
        } catch (reloadError) {
          message = `${message} · ${errorMessage(reloadError)}`;
        }
        if (mountedRef.current) setScopeError(accountId, message);
      }
    });
    queuesRef.current[scope] = request;
    try {
      await request;
    } finally {
      if (mountedRef.current && mutationVersionsRef.current[operationKey] === version) {
        markMutating(operationKey, false);
      }
      if (queuesRef.current[scope] === request) delete queuesRef.current[scope];
    }
  }, [markMutating, reloadScopeRules, replaceScopeRules, setScopeError]);

  const setAlertMuted = useCallback(async (nextMuted: boolean) => {
    const previous = muted;
    setMuted(nextMuted);
    markMutating("$mute", true);
    try {
      await invoke("set_alert_muted", { muted: nextMuted });
    } catch (error) {
      setMuted(previous);
      setScopeError(null, errorMessage(error));
    } finally {
      markMutating("$mute", false);
    }
  }, [markMutating, muted, setScopeError]);

  const scope = alertScopeKey(selectedId);
  const rules = rulesByScope[scope] ?? [];
  const effectiveRules = useMemo(() => getEffectiveRules(rules), [rules]);
  const overrides = useMemo(() => getOverrides(rules, selectedId), [rules, selectedId]);
  const selectedAccount = accounts.find((account) => account.id === selectedId);

  return {
    accounts,
    selectedId,
    selectedAccount,
    rules,
    effectiveRules,
    overrides,
    muted,
    loading: loading || rulesLoading,
    rulesLoading,
    errorsByScope,
    currentError: errorsByScope[scope] ?? "",
    mutating,
    selectAccount,
    updateRule,
    resetToGlobal,
    setAlertMuted,
  };
}

export type AlertsController = ReturnType<typeof useAlertsController>;
