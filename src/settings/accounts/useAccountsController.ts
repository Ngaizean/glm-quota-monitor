import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account, AgentBinding } from "../../types";
import { getPlatformAccounts } from "./accountModel";
import {
  NEW_ACCOUNT_OPERATION_IDS,
  type AccountOperation,
  type AccountPlatform,
  type AgentType,
  type ModelPickerState,
  type SecretDialogState,
} from "./types";

type PendingKey = `${string}:${AccountOperation}`;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pendingKey(accountId: string, operation: AccountOperation): PendingKey {
  return `${accountId}:${operation}`;
}

export function useAccountsController() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bindings, setBindings] = useState<Record<string, string | null>>({});
  const [defaultModel, setDefaultModel] = useState("glm-5.2");
  const [codexAuthExists, setCodexAuthExists] = useState(false);
  const [maskedKeys, setMaskedKeys] = useState<Record<string, string>>({});
  const [accountErrors, setAccountErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [platform, setPlatform] = useState<AccountPlatform>("zhipu");
  const [pendingKeys, setPendingKeys] = useState<Set<PendingKey>>(() => new Set());
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [picker, setPicker] = useState<ModelPickerState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<Account | null>(null);
  const [copyDialog, setCopyDialog] = useState<Account | null>(null);
  const [editDialog, setEditDialog] = useState<Account | null>(null);
  const [secretDialog, setSecretDialog] = useState<SecretDialogState | null>(null);
  const [copiedAccountId, setCopiedAccountId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const refreshRequestRef = useRef(0);
  const pendingRef = useRef(new Set<PendingKey>());
  const modelCacheRef = useRef<Record<string, string[]>>({});
  const pickerRef = useRef<ModelPickerState | null>(null);
  const pickerRequestRef = useRef(0);
  const secretRequestRef = useRef(0);
  const copiedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    modelCacheRef.current = modelCache;
  }, [modelCache]);

  const setAccountError = useCallback((accountId: string, message?: string) => {
    setAccountErrors((current) => {
      const next = { ...current };
      if (message) next[accountId] = message;
      else delete next[accountId];
      return next;
    });
  }, []);

  const refresh = useCallback(async (showLoading = true) => {
    const requestId = ++refreshRequestRef.current;
    if (showLoading) setLoading(true);
    setGlobalError("");

    const [accountsResult, bindingsResult, modelResult, authResult] = await Promise.allSettled([
      invoke<Account[]>("list_accounts"),
      invoke<AgentBinding[]>("get_agent_bindings"),
      invoke<string>("get_default_model"),
      invoke<{ exists: boolean }>("read_local_codex_auth"),
    ]);
    if (!mountedRef.current || requestId !== refreshRequestRef.current) return;

    const loadErrors: string[] = [];
    let loadedAccounts: Account[] | null = null;
    if (accountsResult.status === "fulfilled") {
      loadedAccounts = accountsResult.value;
      setAccounts(loadedAccounts);
    } else {
      loadErrors.push(toErrorMessage(accountsResult.reason));
    }
    if (bindingsResult.status === "fulfilled") {
      const nextBindings: Record<string, string | null> = {};
      for (const binding of bindingsResult.value) nextBindings[binding.agent] = binding.account_id;
      setBindings(nextBindings);
    } else {
      loadErrors.push(toErrorMessage(bindingsResult.reason));
    }
    if (modelResult.status === "fulfilled") {
      setDefaultModel(modelResult.value || "glm-5.2");
    } else {
      loadErrors.push(toErrorMessage(modelResult.reason));
    }
    if (authResult.status === "fulfilled") {
      setCodexAuthExists(authResult.value.exists);
    } else {
      loadErrors.push(toErrorMessage(authResult.reason));
    }

    if (loadedAccounts) {
      const deepseekAccounts = getPlatformAccounts(loadedAccounts, "deepseek");
      const maskResults = await Promise.allSettled(
        deepseekAccounts.map((account) => invoke<string>("mask_deepseek_api_key", { accountId: account.id })),
      );
      if (!mountedRef.current || requestId !== refreshRequestRef.current) return;

      const nextMasks: Record<string, string> = {};
      const maskErrors: Record<string, string> = {};
      maskResults.forEach((result, index) => {
        const accountId = deepseekAccounts[index].id;
        if (result.status === "fulfilled") nextMasks[accountId] = result.value;
        else maskErrors[accountId] = toErrorMessage(result.reason);
      });
      setMaskedKeys(nextMasks);
      setAccountErrors((current) => {
        const next = { ...current };
        for (const account of deepseekAccounts) delete next[account.id];
        return { ...next, ...maskErrors };
      });
    }

    setGlobalError(loadErrors.join(" · "));
    setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      pickerRequestRef.current += 1;
      secretRequestRef.current += 1;
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
    };
  }, [refresh]);

  const runAccountOperation = useCallback(async (
    accountId: string,
    operation: AccountOperation,
    action: () => Promise<void>,
  ): Promise<boolean> => {
    const key = pendingKey(accountId, operation);
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    setPendingKeys(new Set(pendingRef.current));
    setAccountError(accountId);
    try {
      await action();
      return true;
    } catch (error) {
      setAccountError(accountId, toErrorMessage(error));
      return false;
    } finally {
      pendingRef.current.delete(key);
      if (mountedRef.current) setPendingKeys(new Set(pendingRef.current));
    }
  }, [setAccountError]);

  const isPending = useCallback((accountId: string, operation?: AccountOperation) => {
    if (operation) return pendingKeys.has(pendingKey(accountId, operation));
    return [...pendingKeys].some((key) => key.startsWith(`${accountId}:`));
  }, [pendingKeys]);

  const changePlatform = useCallback((nextPlatform: AccountPlatform) => {
    secretRequestRef.current += 1;
    pickerRequestRef.current += 1;
    pickerRef.current = null;
    setPicker(null);
    setSecretDialog(null);
    setCopyDialog(null);
    setEditDialog(null);
    setDeleteDialog(null);
    setPlatform(nextPlatform);
  }, []);

  const closePicker = useCallback(() => {
    pickerRequestRef.current += 1;
    pickerRef.current = null;
    setPicker(null);
  }, []);

  const openPicker = useCallback(async (agent: AgentType, accountId: string) => {
    if (pickerRef.current?.accountId === accountId && pickerRef.current.agent === agent) {
      closePicker();
      return;
    }
    const requestId = ++pickerRequestRef.current;
    const cached = modelCacheRef.current[accountId];
    const nextPicker: ModelPickerState = { accountId, agent, loading: !cached, requestId };
    pickerRef.current = nextPicker;
    setPicker(nextPicker);
    if (cached) return;

    try {
      const models = await invoke<string[]>("fetch_models", { accountId });
      if (!mountedRef.current) return;
      modelCacheRef.current = { ...modelCacheRef.current, [accountId]: models };
      setModelCache(modelCacheRef.current);
      if (pickerRef.current?.requestId === requestId) {
        const settled = { ...pickerRef.current, loading: false };
        pickerRef.current = settled;
        setPicker(settled);
      }
    } catch (error) {
      if (!mountedRef.current) return;
      setAccountError(accountId, toErrorMessage(error));
      if (pickerRef.current?.requestId === requestId) {
        const settled = { ...pickerRef.current, loading: false };
        pickerRef.current = settled;
        setPicker(settled);
      }
    }
  }, [closePicker, setAccountError]);

  const bindAgent = useCallback(async (agent: AgentType, accountId: string, model?: string) => {
    setNotice("");
    const success = await runAccountOperation(accountId, "bind", async () => {
      await invoke("bind_agent", { agent, accountId, model });
      closePicker();
      await refresh(false);
    });
    if (success && agent === "claude_code") setNotice(t("accountsPane.ccRestartNotice"));
  }, [closePicker, refresh, runAccountOperation, t]);

  const addGlmAccount = useCallback(async (alias: string, purpose: string, apiKey: string) => {
    return runAccountOperation(NEW_ACCOUNT_OPERATION_IDS.zhipu, "create", async () => {
      await invoke("add_account", { alias: alias.trim(), purpose: purpose.trim(), apiKey: apiKey.trim() });
      await refresh(false);
    });
  }, [refresh, runAccountOperation]);

  const importCodexAccount = useCallback(async (alias: string) => {
    return runAccountOperation(NEW_ACCOUNT_OPERATION_IDS.codex, "create", async () => {
      await invoke("add_codex_account", { alias: alias.trim() });
      await refresh(false);
    });
  }, [refresh, runAccountOperation]);

  const addDeepseekAccount = useCallback(async (alias: string, apiKey: string) => {
    return runAccountOperation(NEW_ACCOUNT_OPERATION_IDS.deepseek, "create", async () => {
      await invoke("add_deepseek_account", { alias: alias.trim(), apiKey: apiKey.trim() });
      await refresh(false);
    });
  }, [refresh, runAccountOperation]);

  const requestDelete = useCallback((account: Account) => setDeleteDialog(account), []);
  const closeDeleteDialog = useCallback(() => setDeleteDialog(null), []);
  const confirmDelete = useCallback(async () => {
    if (!deleteDialog) return false;
    const success = await runAccountOperation(deleteDialog.id, "delete", async () => {
      await invoke("delete_account", { id: deleteDialog.id });
      await refresh(false);
    });
    if (success) setDeleteDialog(null);
    return success;
  }, [deleteDialog, refresh, runAccountOperation]);

  const requestCopy = useCallback((account: Account) => setCopyDialog(account), []);
  const closeCopyDialog = useCallback(() => setCopyDialog(null), []);
  const confirmCopy = useCallback(async () => {
    if (!copyDialog) return false;
    const accountId = copyDialog.id;
    const success = await runAccountOperation(accountId, "copy", async () => {
      const rawKey = await invoke<string>("get_api_key_raw", { accountId });
      await navigator.clipboard.writeText(rawKey);
    });
    if (success) {
      setCopyDialog(null);
      setCopiedAccountId(accountId);
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setCopiedAccountId(null), 2000);
    }
    return success;
  }, [copyDialog, runAccountOperation]);

  const requestEdit = useCallback((account: Account) => setEditDialog(account), []);
  const closeEditDialog = useCallback(() => setEditDialog(null), []);
  const saveApiKey = useCallback(async (newApiKey: string) => {
    if (!editDialog) return false;
    const success = await runAccountOperation(editDialog.id, "update", async () => {
      await invoke("update_api_key", { accountId: editDialog.id, newApiKey: newApiKey.trim() });
      await refresh(false);
    });
    if (success) setEditDialog(null);
    return success;
  }, [editDialog, refresh, runAccountOperation]);

  const closeSecretDialog = useCallback(() => {
    secretRequestRef.current += 1;
    setSecretDialog(null);
  }, []);

  const openDeepseekSecret = useCallback(async (account: Account) => {
    if (pendingRef.current.has(pendingKey(account.id, "secret"))) return;
    const requestId = ++secretRequestRef.current;
    setSecretDialog({ account, secret: null, loading: true });
    let loadedSecret: string | null = null;
    const success = await runAccountOperation(account.id, "secret", async () => {
      loadedSecret = await invoke<string>("get_deepseek_api_key_raw", { accountId: account.id });
    });
    if (!mountedRef.current || requestId !== secretRequestRef.current) return;
    setSecretDialog(success ? { account, secret: loadedSecret, loading: false } : null);
  }, [runAccountOperation]);

  const pickerModels = useMemo(
    () => picker ? (modelCache[picker.accountId] ?? []) : [],
    [modelCache, picker],
  );

  return {
    accounts,
    bindings,
    defaultModel,
    codexAuthExists,
    maskedKeys,
    accountErrors,
    globalError,
    notice,
    loading,
    platform,
    picker,
    pickerModels,
    deleteDialog,
    copyDialog,
    editDialog,
    secretDialog,
    copiedAccountId,
    refresh,
    isPending,
    changePlatform,
    openPicker,
    closePicker,
    bindAgent,
    addGlmAccount,
    importCodexAccount,
    addDeepseekAccount,
    requestDelete,
    closeDeleteDialog,
    confirmDelete,
    requestCopy,
    closeCopyDialog,
    confirmCopy,
    requestEdit,
    closeEditDialog,
    saveApiKey,
    openDeepseekSecret,
    closeSecretDialog,
  };
}

export type AccountsController = ReturnType<typeof useAccountsController>;
