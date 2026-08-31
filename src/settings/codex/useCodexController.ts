import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  Account,
  AuthSummary,
  CodexRole,
  CodexRuntimeConfig,
  CodexRuntimeMode,
  PasswordRequest,
  RemoteBindingRequest,
  RemoteCcState,
  SshHost,
  SshOverrideState,
  SyncInfo,
} from "./types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeRole(value: string): CodexRole {
  return value === "consumer" ? "consumer" : "owner";
}

function overridesByHost(states: SshOverrideState[]): Record<string, boolean> {
  return Object.fromEntries(states.map((state) => [state.host, state.auto_enabled]));
}

interface QueuedSettingRequest<T> {
  generation: number;
  value: T;
  resolve: () => void;
}

/**
 * Serializes a latest-wins setting mutation. UI state remains optimistic, while
 * only the newest generation may report an error or roll back its own value.
 */
function useQueuedSetting<T>(
  initialValue: T,
  persist: (value: T) => Promise<unknown>,
  reportError: (error: unknown) => void,
) {
  const [value, setValueState] = useState(initialValue);
  const [pending, setPending] = useState(false);
  const valueRef = useRef(initialValue);
  const committedRef = useRef(initialValue);
  const generationRef = useRef(0);
  const runningRef = useRef(false);
  const queuedRef = useRef<QueuedSettingRequest<T> | null>(null);
  const mountedRef = useRef(true);
  const persistRef = useRef(persist);
  const reportErrorRef = useRef(reportError);
  persistRef.current = persist;
  reportErrorRef.current = reportError;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queuedRef.current?.resolve();
      queuedRef.current = null;
    };
  }, []);

  const drain = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    if (mountedRef.current) setPending(true);

    while (queuedRef.current) {
      const request = queuedRef.current;
      queuedRef.current = null;
      try {
        await persistRef.current(request.value);
        committedRef.current = request.value;
      } catch (caught) {
        const isCurrent = request.generation === generationRef.current && queuedRef.current === null;
        if (isCurrent && mountedRef.current) {
          valueRef.current = committedRef.current;
          setValueState(committedRef.current);
          reportErrorRef.current(caught);
        }
      } finally {
        request.resolve();
      }
    }

    runningRef.current = false;
    if (mountedRef.current) setPending(false);
  }, []);

  const update = useCallback((nextValue: T): Promise<void> => {
    if (Object.is(nextValue, valueRef.current)) return Promise.resolve();
    valueRef.current = nextValue;
    setValueState(nextValue);
    const generation = ++generationRef.current;

    return new Promise<void>((resolve) => {
      // Coalesce queued-but-not-started writes, while allowing the in-flight
      // request to finish before the latest desired value is persisted.
      queuedRef.current?.resolve();
      queuedRef.current = { generation, value: nextValue, resolve };
      void drain();
    });
  }, [drain]);

  const load = useCallback((nextValue: T) => {
    generationRef.current += 1;
    valueRef.current = nextValue;
    committedRef.current = nextValue;
    setValueState(nextValue);
  }, []);

  return { value, pending, update, load };
}

export function useCodexController() {
  const { t } = useTranslation();
  const [initializing, setInitializing] = useState(true);
  const [gistUrl, setGistUrl] = useState("");
  const [githubToken, setGithubTokenState] = useState("");
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(false);
  const [githubTokenLoading, setGithubTokenLoading] = useState(false);
  const [githubTokenSaving, setGithubTokenSaving] = useState(false);
  const [proxyUrl, setProxyUrl] = useState("");
  const [authSummary, setAuthSummary] = useState<AuthSummary | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [runtimeConfig, setRuntimeConfig] = useState<CodexRuntimeConfig | null>(null);
  const [relayBaseUrl, setRelayBaseUrl] = useState("");
  const [relayModel, setRelayModel] = useState("");
  const [relayApiKey, setRelayApiKeyState] = useState("");
  const [relayKeyLoaded, setRelayKeyLoaded] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState("");

  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [scanningHosts, setScanningHosts] = useState(false);
  const [autoOverrides, setAutoOverrides] = useState<Record<string, boolean>>({});
  const [ccStates, setCcStates] = useState<Record<string, RemoteCcState | null>>({});
  const [checkingHosts, setCheckingHosts] = useState<Set<string>>(() => new Set());
  const [pendingHosts, setPendingHosts] = useState<Set<string>>(() => new Set());
  const pendingHostsRef = useRef(new Set<string>());

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [pickerAccountId, setPickerAccountId] = useState<string | null>(null);
  const [loadingModelAccounts, setLoadingModelAccounts] = useState<Set<string>>(() => new Set());
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null);
  const [bindingRequest, setBindingRequest] = useState<RemoteBindingRequest | null>(null);
  const githubTokenRef = useRef("");
  const githubTokenDirtyRef = useRef(false);
  const tokenGenerationRef = useRef(0);

  const reportSettingError = useCallback((caught: unknown) => {
    setError(errorMessage(caught));
  }, []);
  const roleSetting = useQueuedSetting<CodexRole>(
    "owner",
    (nextRole) => invoke("set_codex_role", { role: nextRole }),
    reportSettingError,
  );
  const autoUploadSetting = useQueuedSetting(
    false,
    (enabled) => invoke("set_codex_auto_upload", { enabled }),
    reportSettingError,
  );
  const autoSyncSetting = useQueuedSetting(
    true,
    (enabled) => invoke("set_codex_auto_sync", { enabled }),
    reportSettingError,
  );
  const role = roleSetting.value;
  const autoUpload = autoUploadSetting.value;
  const autoSync = autoSyncSetting.value;

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      const coreResultsPromise = Promise.allSettled([
        invoke<string>("get_codex_role"),
        invoke<string | null>("get_codex_gist_url"),
        invoke<AuthSummary>("read_local_codex_auth"),
        invoke<SyncInfo>("get_codex_sync_info"),
        invoke<boolean>("get_codex_auto_upload"),
        invoke<string | null>("get_codex_proxy"),
        invoke<boolean>("get_codex_auto_sync"),
        invoke<CodexRuntimeConfig>("get_codex_runtime_config"),
      ] as const);
      const supportResultsPromise = Promise.allSettled([
        invoke<SshOverrideState[]>("get_ssh_override_state"),
        invoke<Account[]>("list_accounts"),
      ] as const);
      const [coreResults, supportResults] = await Promise.all([coreResultsPromise, supportResultsPromise]);
      if (cancelled) return;

      const failures: string[] = [];
      const [roleResult, gistResult, authResult, syncResult, uploadResult, proxyResult, autoSyncResult, runtimeResult] = coreResults;
      if (roleResult.status === "fulfilled") roleSetting.load(normalizeRole(roleResult.value));
      else failures.push(errorMessage(roleResult.reason));
      if (gistResult.status === "fulfilled") setGistUrl(gistResult.value ?? "");
      else failures.push(errorMessage(gistResult.reason));
      if (authResult.status === "fulfilled") setAuthSummary(authResult.value);
      else failures.push(errorMessage(authResult.reason));
      if (syncResult.status === "fulfilled") setSyncInfo(syncResult.value);
      else failures.push(errorMessage(syncResult.reason));
      if (uploadResult.status === "fulfilled") autoUploadSetting.load(uploadResult.value);
      else failures.push(errorMessage(uploadResult.reason));
      if (proxyResult.status === "fulfilled") setProxyUrl(proxyResult.value ?? "");
      else failures.push(errorMessage(proxyResult.reason));
      if (autoSyncResult.status === "fulfilled") autoSyncSetting.load(autoSyncResult.value);
      else failures.push(errorMessage(autoSyncResult.reason));
      if (runtimeResult.status === "fulfilled" && runtimeResult.value) {
        setRuntimeConfig(runtimeResult.value);
        setRelayBaseUrl(runtimeResult.value.relay_base_url);
        setRelayModel(runtimeResult.value.relay_model);
      } else if (runtimeResult.status === "rejected") failures.push(errorMessage(runtimeResult.reason));

      const [overridesResult, accountsResult] = supportResults;
      if (overridesResult.status === "fulfilled") setAutoOverrides(overridesByHost(overridesResult.value));
      else failures.push(errorMessage(overridesResult.reason));
      if (accountsResult.status === "fulfilled") setAccounts(accountsResult.value);
      else failures.push(errorMessage(accountsResult.reason));

      if (failures.length > 0) setError(failures.join(" · "));
      setInitializing(false);
    }

    void initialize();
    return () => { cancelled = true; };
  }, [autoSyncSetting.load, autoUploadSetting.load, roleSetting.load]);

  const updateHostSet = useCallback((setter: typeof setCheckingHosts, host: string, pending: boolean) => {
    setter((current) => {
      const next = new Set(current);
      if (pending) next.add(host);
      else next.delete(host);
      return next;
    });
  }, []);

  const runHostMutation = useCallback(async (host: string, task: () => Promise<void>): Promise<boolean> => {
    if (initializing || pendingHostsRef.current.has(host)) return false;
    pendingHostsRef.current.add(host);
    setPendingHosts(new Set(pendingHostsRef.current));
    setError("");
    try {
      await task();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      pendingHostsRef.current.delete(host);
      setPendingHosts(new Set(pendingHostsRef.current));
    }
  }, [initializing]);

  const refreshAuth = useCallback(async (announce = true) => {
    if (initializing || refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      const [authResult, syncResult] = await Promise.allSettled([
        invoke<AuthSummary>("read_local_codex_auth"),
        invoke<SyncInfo>("get_codex_sync_info"),
      ] as const);
      const failures: string[] = [];
      if (authResult.status === "fulfilled") setAuthSummary(authResult.value);
      else failures.push(errorMessage(authResult.reason));
      if (syncResult.status === "fulfilled") setSyncInfo(syncResult.value);
      else failures.push(errorMessage(syncResult.reason));
      if (failures.length > 0) setError(failures.join(" · "));
      else if (announce) setInfo(t("codexPane.refreshSuccess"));
    } finally {
      setRefreshing(false);
    }
  }, [initializing, refreshing, t]);

  const setRole = useCallback(async (nextRole: CodexRole) => {
    if (initializing) return;
    setError("");
    await roleSetting.update(nextRole);
  }, [initializing, roleSetting.update]);

  const setRelayApiKey = useCallback((value: string) => {
    setRelayKeyLoaded(true);
    setRelayApiKeyState(value);
  }, []);

  const revealRelayKey = useCallback(async () => {
    if (initializing || runtimeBusy) return "";
    setRuntimeBusy("key");
    setError("");
    try {
      const key = await invoke<string>("get_codex_relay_key");
      setRelayApiKeyState(key);
      setRelayKeyLoaded(true);
      return key;
    } catch (caught) {
      setError(errorMessage(caught));
      return "";
    } finally {
      setRuntimeBusy("");
    }
  }, [initializing, runtimeBusy]);

  const copyRelayKey = useCallback(async () => {
    const key = relayKeyLoaded ? relayApiKey : await revealRelayKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      setInfo(t("codexPane.relayKeyCopied"));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [relayApiKey, relayKeyLoaded, revealRelayKey, t]);

  const saveRelayConfig = useCallback(async () => {
    if (initializing || runtimeBusy) return false;
    setRuntimeBusy("save-relay");
    setError("");
    try {
      const next = await invoke<CodexRuntimeConfig>("set_codex_relay_config", {
        baseUrl: relayBaseUrl,
        model: relayModel,
        apiKey: relayKeyLoaded ? relayApiKey : null,
      });
      if (next) {
        setRuntimeConfig(next);
        setRelayBaseUrl(next.relay_base_url);
        setRelayModel(next.relay_model);
      }
      setRelayApiKeyState("");
      setRelayKeyLoaded(false);
      setInfo(t("codexPane.relaySaved"));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setRuntimeBusy("");
    }
  }, [initializing, relayApiKey, relayBaseUrl, relayKeyLoaded, relayModel, runtimeBusy, t]);

  const switchRuntime = useCallback(async (mode: CodexRuntimeMode, accountId: string | null = null) => {
    if (initializing || runtimeBusy) return false;
    setRuntimeBusy(`switch-${mode}`);
    setError("");
    try {
      const next = await invoke<CodexRuntimeConfig>("switch_codex_runtime", { mode, accountId });
      if (next) setRuntimeConfig(next);
      else setRuntimeConfig((current) => current ? { ...current, active_mode: mode } : current);
      setAuthSummary(await invoke<AuthSummary>("read_local_codex_auth"));
      setInfo(t("codexPane.runtimeSwitched"));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setRuntimeBusy("");
    }
  }, [initializing, runtimeBusy, t]);

  const loginOfficial = useCallback(async () => {
    if (initializing || runtimeBusy) return;
    setRuntimeBusy("login");
    setError("");
    try {
      await invoke<Account>("login_codex_official", { alias: null });
      const [nextAccounts, nextAuth, nextRuntime] = await Promise.all([
        invoke<Account[]>("list_accounts"),
        invoke<AuthSummary>("read_local_codex_auth"),
        invoke<CodexRuntimeConfig>("get_codex_runtime_config"),
      ]);
      setAccounts(nextAccounts);
      setAuthSummary(nextAuth);
      setRuntimeConfig(nextRuntime);
      setInfo(t("codexPane.officialLoginSuccess"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRuntimeBusy("");
    }
  }, [initializing, runtimeBusy, t]);

  const saveConnectionSetting = useCallback(async (command: string, args: Record<string, string>) => {
    if (initializing) return;
    setError("");
    try {
      await invoke(command, args);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [initializing]);

  const persistConnectionSettings = useCallback(async () => {
    await invoke("set_codex_gist_url", { url: gistUrl });
    await invoke("set_codex_proxy", { url: proxyUrl });
  }, [gistUrl, proxyUrl]);

  const setGithubToken = useCallback((token: string) => {
    githubTokenRef.current = token;
    githubTokenDirtyRef.current = true;
    setGithubTokenState(token);
  }, []);

  const clearGithubToken = useCallback(() => {
    tokenGenerationRef.current += 1;
    githubTokenRef.current = "";
    githubTokenDirtyRef.current = false;
    setGithubTokenState("");
    setGithubTokenLoading(false);
  }, []);

  const loadGithubToken = useCallback(async () => {
    if (initializing) return;
    const generation = ++tokenGenerationRef.current;
    githubTokenRef.current = "";
    githubTokenDirtyRef.current = false;
    setGithubTokenState("");
    setGithubTokenLoading(true);
    setError("");
    try {
      const token = (await invoke<string | null>("get_codex_github_token")) ?? "";
      if (generation !== tokenGenerationRef.current) return;
      githubTokenRef.current = token;
      githubTokenDirtyRef.current = false;
      setGithubTokenState(token);
      setGithubTokenConfigured(token.trim().length > 0);
    } catch (caught) {
      if (generation === tokenGenerationRef.current) setError(errorMessage(caught));
    } finally {
      if (generation === tokenGenerationRef.current) setGithubTokenLoading(false);
    }
  }, [initializing]);

  const saveGithubToken = useCallback(async () => {
    if (initializing || githubTokenSaving) return false;
    if (!githubTokenDirtyRef.current) return true;
    const token = githubTokenRef.current;
    const generation = ++tokenGenerationRef.current;
    setGithubTokenSaving(true);
    setError("");
    try {
      await invoke("set_codex_github_token", { token });
      if (generation === tokenGenerationRef.current) {
        githubTokenRef.current = "";
        githubTokenDirtyRef.current = false;
        setGithubTokenState("");
        setGithubTokenConfigured(token.trim().length > 0);
      }
      return true;
    } catch (caught) {
      if (generation === tokenGenerationRef.current) setError(errorMessage(caught));
      return false;
    } finally {
      setGithubTokenSaving(false);
    }
  }, [githubTokenSaving, initializing]);

  const toggleAutoSync = useCallback(async (enabled: boolean) => {
    if (initializing) return;
    setError("");
    await autoSyncSetting.update(enabled);
  }, [autoSyncSetting.update, initializing]);

  const toggleAutoUpload = useCallback(async (enabled: boolean) => {
    if (initializing) return;
    setError("");
    await autoUploadSetting.update(enabled);
  }, [autoUploadSetting.update, initializing]);

  const uploadAuth = useCallback(async () => {
    if (initializing || uploading || !gistUrl || !githubTokenConfigured) return;
    setUploading(true);
    setError("");
    try {
      await persistConnectionSettings();
      await invoke("upload_codex_auth");
      await refreshAuth(false);
      setInfo(t("codexPane.uploadSuccess"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  }, [githubTokenConfigured, gistUrl, initializing, persistConnectionSettings, refreshAuth, t, uploading]);

  const syncAuth = useCallback(async () => {
    if (initializing || syncing || !gistUrl) return;
    setSyncing(true);
    setError("");
    try {
      await persistConnectionSettings();
      await invoke("sync_codex_auth");
      await refreshAuth(false);
      setInfo(t("codexPane.syncSuccess"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  }, [gistUrl, initializing, persistConnectionSettings, refreshAuth, syncing, t]);

  const checkCcState = useCallback(async (host: SshHost) => {
    updateHostSet(setCheckingHosts, host.alias, true);
    try {
      const state = await invoke<RemoteCcState>("ssh_check_claude_code", {
        host: host.alias,
        password: null,
      });
      setCcStates((current) => ({ ...current, [host.alias]: state }));
    } catch {
      setCcStates((current) => ({ ...current, [host.alias]: null }));
    } finally {
      updateHostSet(setCheckingHosts, host.alias, false);
    }
  }, [updateHostSet]);

  const scanHosts = useCallback(async () => {
    if (initializing || scanningHosts) return;
    setScanningHosts(true);
    setError("");
    try {
      const scanned = await invoke<SshHost[]>("scan_ssh_hosts");
      setHosts(scanned);
      setHostsLoaded(true);
      void Promise.allSettled(scanned.map((host) => checkCcState(host)));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setScanningHosts(false);
    }
  }, [checkCcState, initializing, scanningHosts]);

  const pushHost = useCallback(async (host: SshHost) => {
    await runHostMutation(host.alias, async () => {
      const passwordless = await invoke<boolean>("check_ssh_passwordless", { host: host.alias });
      if (!passwordless) {
        setPasswordRequest({ host: host.alias, mode: "push" });
        return;
      }
      await invoke("ssh_push_auth", { host: host.alias, password: null });
      setInfo(t("codexPane.sshPushSuccess"));
    });
  }, [runHostMutation, t]);

  const toggleAutoOverride = useCallback(async (host: string, enabled: boolean) => {
    await runHostMutation(host, async () => {
      if (!enabled) {
        await invoke("set_ssh_auto_override", { host, enabled: false });
        setAutoOverrides((current) => ({ ...current, [host]: false }));
        return;
      }
      const passwordless = await invoke<boolean>("check_ssh_passwordless", { host });
      if (!passwordless) {
        setPasswordRequest({ host, mode: "auto" });
        return;
      }
      await invoke("set_ssh_auto_override", { host, enabled: true });
      setAutoOverrides((current) => ({ ...current, [host]: true }));
      setInfo(t("codexPane.sshAutoOverrideDesc"));
    });
  }, [runHostMutation, t]);

  const openRemoteBinding = useCallback(async (host: SshHost) => {
    await runHostMutation(host.alias, async () => {
      const passwordless = await invoke<boolean>("check_ssh_passwordless", { host: host.alias });
      if (passwordless) setBindingRequest({ host: host.alias });
      else setPasswordRequest({ host: host.alias, mode: "cc" });
    });
  }, [runHostMutation]);

  const confirmPassword = useCallback(async (password: string) => {
    const request = passwordRequest;
    if (!request || !password) return;
    const succeeded = await runHostMutation(request.host, async () => {
      if (request.mode === "push") {
        await invoke("ssh_push_auth", { host: request.host, password });
        setInfo(t("codexPane.sshPushSuccess"));
      } else {
        await invoke("set_ssh_password", { host: request.host, password });
        if (request.mode === "auto") {
          await invoke("set_ssh_auto_override", { host: request.host, enabled: true });
          setAutoOverrides((current) => ({ ...current, [request.host]: true }));
          setInfo(t("codexPane.sshAutoOverrideDesc"));
        } else {
          setBindingRequest({ host: request.host });
        }
      }
    });
    if (succeeded) setPasswordRequest(null);
  }, [passwordRequest, runHostMutation, t]);

  const togglePickerAccount = useCallback(async (accountId: string) => {
    if (initializing) return;
    if (pickerAccountId === accountId) {
      setPickerAccountId(null);
      return;
    }
    setPickerAccountId(accountId);
    if (modelCache[accountId] || loadingModelAccounts.has(accountId)) return;
    updateHostSet(setLoadingModelAccounts, accountId, true);
    setError("");
    try {
      const models = await invoke<string[]>("fetch_models", { accountId });
      setModelCache((current) => ({ ...current, [accountId]: models }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      updateHostSet(setLoadingModelAccounts, accountId, false);
    }
  }, [initializing, loadingModelAccounts, modelCache, pickerAccountId, updateHostSet]);

  const closeBindingDialog = useCallback(() => {
    if (bindingRequest && pendingHostsRef.current.has(bindingRequest.host)) return;
    setBindingRequest(null);
    setPickerAccountId(null);
  }, [bindingRequest]);

  const bindRemote = useCallback(async (accountId: string, model?: string) => {
    const request = bindingRequest;
    if (!request) return;
    const succeeded = await runHostMutation(request.host, async () => {
      await invoke("ssh_bind_claude_code", {
        host: request.host,
        password: null,
        accountId,
        model: model ?? null,
      });
      const host = hosts.find((candidate) => candidate.alias === request.host);
      if (host) await checkCcState(host);
      setInfo(t("codexPane.sshCcBindSuccess"));
    });
    if (succeeded) {
      setBindingRequest(null);
      setPickerAccountId(null);
    }
  }, [bindingRequest, checkCcState, hosts, runHostMutation, t]);

  const unbindRemote = useCallback(async (host: SshHost) => {
    await runHostMutation(host.alias, async () => {
      await invoke("ssh_unbind_claude_code", { host: host.alias, password: null });
      await checkCcState(host);
      setInfo(t("codexPane.sshCcUnbindSuccess"));
    });
  }, [checkCcState, runHostMutation, t]);

  const bindableAccounts = useMemo(() => accounts.filter((account) => {
    const platform = account.platform ?? "zhipu";
    return platform === "zhipu" || platform === "deepseek";
  }), [accounts]);
  const officialAccounts = useMemo(
    () => accounts.filter((account) => (account.platform ?? "") === "codex"),
    [accounts],
  );

  return {
    initializing,
    role,
    roleSaving: roleSetting.pending,
    gistUrl,
    githubToken,
    githubTokenConfigured,
    githubTokenLoading,
    githubTokenSaving,
    proxyUrl,
    authSummary,
    syncInfo,
    autoUpload,
    autoUploadSaving: autoUploadSetting.pending,
    autoSync,
    autoSyncSaving: autoSyncSetting.pending,
    uploading,
    syncing,
    refreshing,
    error,
    info,
    runtimeConfig,
    relayBaseUrl,
    relayModel,
    relayApiKey,
    relayKeyLoaded,
    runtimeBusy,
    officialAccounts,
    hosts,
    hostsLoaded,
    scanningHosts,
    autoOverrides,
    ccStates,
    checkingHosts,
    pendingHosts,
    bindableAccounts,
    modelCache,
    pickerAccountId,
    pickerLoading: pickerAccountId ? loadingModelAccounts.has(pickerAccountId) : false,
    passwordRequest,
    bindingRequest,
    setRole,
    setRelayBaseUrl,
    setRelayModel,
    setRelayApiKey,
    revealRelayKey,
    copyRelayKey,
    saveRelayConfig,
    switchRuntime,
    loginOfficial,
    setGistUrl,
    setGithubToken,
    loadGithubToken,
    clearGithubToken,
    saveGithubToken,
    setProxyUrl,
    saveConnectionSetting,
    refreshAuth,
    toggleAutoSync,
    toggleAutoUpload,
    uploadAuth,
    syncAuth,
    scanHosts,
    pushHost,
    toggleAutoOverride,
    openRemoteBinding,
    closePasswordDialog: () => setPasswordRequest(null),
    confirmPassword,
    togglePickerAccount,
    closeBindingDialog,
    bindRemote,
    unbindRemote,
  };
}

export type CodexController = ReturnType<typeof useCodexController>;
