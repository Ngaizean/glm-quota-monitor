import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Toggle from "../lib/Toggle";
import type { Account, RemoteCcState } from "../types";

interface AuthSummary {
  exists: boolean;
  account_id: string;
  last_refresh: string | null;
  access_token_exp: string | null;
}

interface SyncInfo {
  last_upload: string | null;
  last_sync: string | null;
}

interface SshHost {
  alias: string;
  hostname: string;
  user: string;
  port: number;
  identity_file: string | null;
  has_local_key: boolean;
}

interface SshOverrideState {
  host: string;
  auto_enabled: boolean;
  has_password: boolean;
}

interface PasswordModalState {
  host: string;
  password: string;
  mode: "push" | "auto" | "cc";
  saving: boolean;
}

/** 远程 CC 绑定弹窗：选账号 → 选模型 → 调 ssh_bind_claude_code */
interface CcBindModalState {
  host: string;
}

/** 平台标签的颜色/文案映射 */
const PLATFORM_BADGE: Record<string, { text: string; cls: string }> = {
  glm: { text: "GLM", cls: "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]" },
  deepseek: { text: "DeepSeek", cls: "bg-purple-500/10 text-purple-500" },
  unknown: { text: "?", cls: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]" },
};

const inputClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] placeholder:text-[var(--color-text-tertiary)]";

/** 格式化 token 过期时间（未来=倒计时，过去=已过期）
 *  用于 access_token_exp 这种表示"到期时间"的字段
 */
function formatExpiry(iso: string | null, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;
  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor((absDiff % 86400000) / 3600000);
  const mins = Math.floor((absDiff % 3600000) / 60000);

  if (days > 0) {
    return isPast
      ? t('codexPane.expiredDaysAgo', { count: days })
      : t('codexPane.expiresInDays', { count: days, hours });
  }
  if (hours > 0) {
    return isPast
      ? t('codexPane.expiredHoursAgo', { count: hours })
      : t('codexPane.expiresInHours', { hours, minutes: mins });
  }
  return isPast
    ? t('codexPane.expiredMinsAgo', { count: Math.max(mins, 1) })
    : t('codexPane.expiresInMins', { count: Math.max(mins, 1) });
}

/** 格式化相对时间（上次操作距今多久）
 *  用于 last_upload / last_sync 这种表示"操作时间"的字段
 */
function formatRelative(iso: string | null, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  const diff = Date.now() - date.getTime();
  if (diff < 0) return t('account.justNow');
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return t('account.daysAgo', { count: days });
  if (hours > 0) return t('account.hoursAgo', { count: hours });
  if (mins > 0) return t('account.minutesAgo', { count: mins });
  return t('account.justNow');
}

export default function CodexPane() {
  const { t } = useTranslation();
  const [role, setRole] = useState<string>("owner");
  const [gistUrl, setGistUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [authSummary, setAuthSummary] = useState<AuthSummary | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [autoUpload, setAutoUpload] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [sshHosts, setSshHosts] = useState<SshHost[]>([]);
  const [sshScanning, setSshScanning] = useState(false);
  const [sshLoaded, setSshLoaded] = useState(false);
  const [autoOverrides, setAutoOverrides] = useState<Record<string, boolean>>({});
  const [passwordModal, setPasswordModal] = useState<PasswordModalState | null>(null);
  const [pushingHost, setPushingHost] = useState<string | null>(null);
  // 远程 Claude Code 状态：host.alias → 检测结果
  const [ccStates, setCcStates] = useState<Record<string, RemoteCcState | null>>({});
  const [ccCheckingHosts, setCcCheckingHosts] = useState<Record<string, boolean>>({});
  // 远程 CC 绑定弹窗
  const [ccBindModal, setCcBindModal] = useState<CcBindModalState | null>(null);
  const [ccBinding, setCcBinding] = useState<string | null>(null);
  // 账号 + 模型 picker（复用本机绑定模式）
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [ccPicker, setCcPicker] = useState<{ accountId: string } | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    loadData();
    loadSshOverrideState();
    loadAccounts();
  }, []);

  async function loadAccounts() {
    try {
      const accs = await invoke<Account[]>("list_accounts");
      setAccounts(accs);
    } catch (e) {
      setError(String(e));
    }
  }

  async function loadData() {
    try {
      const [r, url, token, auth, sync, au, proxy, autosync] = await Promise.all([
        invoke<string>("get_codex_role"),
        invoke<string | null>("get_codex_gist_url"),
        invoke<string | null>("get_codex_github_token"),
        invoke<AuthSummary>("read_local_codex_auth"),
        invoke<SyncInfo>("get_codex_sync_info"),
        invoke<boolean>("get_codex_auto_upload"),
        invoke<string | null>("get_codex_proxy"),
        invoke<boolean>("get_codex_auto_sync"),
      ]);
      setRole(r || "owner");
      setGistUrl(url || "");
      setGithubToken(token || "");
      setAuthSummary(auth);
      setSyncInfo(sync);
      setAutoUpload(au);
      setProxyUrl(proxy || "");
      setAutoSync(autosync);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshAuth() {
    setRefreshing(true);
    setError("");
    setInfo("");
    try {
      const auth = await invoke<AuthSummary>("read_local_codex_auth");
      setAuthSummary(auth);
      const sync = await invoke<SyncInfo>("get_codex_sync_info");
      setSyncInfo(sync);
      setInfo(t('codexPane.refreshSuccess'));
      setTimeout(() => setInfo(""), 3000);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleRoleChange(newRole: string) {
    setRole(newRole);
    try {
      await invoke("set_codex_role", { role: newRole });
    } catch (e) {
      setError(String(e));
    }
  }

  function handleGistUrlChange(value: string) {
    setGistUrl(value);
  }

  function handleTokenChange(value: string) {
    setGithubToken(value);
  }

  function handleProxyChange(value: string) {
    setProxyUrl(value);
  }

  async function saveConnectionSetting(command: string, args: Record<string, string>) {
    try {
      await invoke(command, args);
    } catch (e) {
      setError(String(e));
    }
  }

  async function persistConnectionSettings(includeToken: boolean) {
    await invoke("set_codex_gist_url", { url: gistUrl });
    await invoke("set_codex_proxy", { url: proxyUrl });
    if (includeToken) {
      await invoke("set_codex_github_token", { token: githubToken });
    }
  }

  async function handleAutoSyncToggle(value: boolean) {
    setAutoSync(value);
    try {
      await invoke("set_codex_auto_sync", { enabled: value });
    } catch (e) {
      setError(String(e));
      setAutoSync(!value);
    }
  }

  async function handleUpload() {
    setUploading(true);
    setError("");
    setInfo("");
    try {
      await persistConnectionSettings(true);
      await invoke("upload_codex_auth");
      setInfo(t('codexPane.uploadSuccess'));
      await refreshAuth();
    } catch (e) {
      setError(String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleAutoUploadToggle(value: boolean) {
    setAutoUpload(value);
    try {
      await invoke("set_codex_auto_upload", { enabled: value });
    } catch (e) {
      setError(String(e));
      setAutoUpload(!value);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setError("");
    setInfo("");
    try {
      await persistConnectionSettings(role === "owner");
      await invoke("sync_codex_auth");
      setInfo(t('codexPane.syncSuccess'));
      await refreshAuth();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  // ========== SSH 远程覆盖 ==========

  async function loadSshHosts() {
    setSshScanning(true);
    setError("");
    try {
      const hosts = await invoke<SshHost[]>("scan_ssh_hosts");
      setSshHosts(hosts);
      setSshLoaded(true);
      // 并行触发每台主机的 CC 检测（后端自动处理密码，前端只传 null）
      hosts.forEach((h) => checkCcState(h));
    } catch (e) {
      setError(String(e));
    } finally {
      setSshScanning(false);
    }
  }

  async function loadSshOverrideState() {
    try {
      const states = await invoke<SshOverrideState[]>("get_ssh_override_state");
      const map: Record<string, boolean> = {};
      states.forEach((s) => {
        map[s.host] = s.auto_enabled;
      });
      setAutoOverrides(map);
    } catch (e) {
      setError(String(e));
    }
  }

  /** 推送：免密直接推；非免密弹密码框 */
  async function handleSshPush(host: SshHost) {
    setError("");
    setInfo("");
    const passwordless = await invoke<boolean>("check_ssh_passwordless", { host: host.alias });
    if (passwordless) {
      setPushingHost(host.alias);
      try {
        await invoke("ssh_push_auth", { host: host.alias, password: null });
        setInfo(t('codexPane.sshPushSuccess'));
      } catch (e) {
        setError(String(e));
      } finally {
        setPushingHost(null);
      }
    } else {
      setPasswordModal({ host: host.alias, password: "", mode: "push", saving: false });
    }
  }

  /** 自动覆盖开关：开启时先检查免密，非免密需输入并保存密码 */
  async function handleAutoOverrideToggle(host: string, enabled: boolean) {
    setError("");
    setInfo("");
    if (!enabled) {
      try {
        await invoke("set_ssh_auto_override", { host, enabled: false });
        setAutoOverrides((prev) => ({ ...prev, [host]: false }));
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    const passwordless = await invoke<boolean>("check_ssh_passwordless", { host });
    if (passwordless) {
      try {
        await invoke("set_ssh_auto_override", { host, enabled: true });
        setAutoOverrides((prev) => ({ ...prev, [host]: true }));
        setInfo(t('codexPane.sshAutoOverrideDesc'));
      } catch (e) {
        setError(String(e));
      }
    } else {
      setPasswordModal({ host, password: "", mode: "auto", saving: false });
    }
  }

  async function confirmPasswordModal() {
    if (!passwordModal) return;
    const { host, password, mode } = passwordModal;
    if (!password) return;
    setPasswordModal({ ...passwordModal, saving: true });
    setError("");
    try {
      if (mode === "push") {
        await invoke("ssh_push_auth", { host, password });
        setInfo(t('codexPane.sshPushSuccess'));
        setPasswordModal(null);
      } else if (mode === "auto") {
        // 保存密码 + 开启自动覆盖（后台调度据此用密码推送）
        await invoke("set_ssh_password", { host, password });
        await invoke("set_ssh_auto_override", { host, enabled: true });
        setAutoOverrides((prev) => ({ ...prev, [host]: true }));
        setInfo(t('codexPane.sshAutoOverrideDesc'));
        setPasswordModal(null);
      } else if (mode === "cc") {
        // CC 绑定：密码只存 Keychain；后续命令由后端读取，不在 React 状态中继续持有明文。
        await invoke("set_ssh_password", { host, password });
        setCcBindModal({ host });
        setPasswordModal(null);
      }
    } catch (e) {
      setError(String(e));
      setPasswordModal((prev) => (prev ? { ...prev, saving: false } : prev));
    }
  }

  // ========== 远程 Claude Code 检测 / 绑定 ==========

  /** 检测单台主机的 Claude Code 状态。后端自动处理密码（免密优先，回退 keychain）*/
  async function checkCcState(host: SshHost) {
    setCcCheckingHosts((prev) => ({ ...prev, [host.alias]: true }));
    try {
      const state = await invoke<RemoteCcState>("ssh_check_claude_code", {
        host: host.alias,
        password: null,
      });
      setCcStates((prev) => ({ ...prev, [host.alias]: state }));
    } catch {
      // 失败不阻断列表展示，标 null 让 UI 显示「未知」
      setCcStates((prev) => ({ ...prev, [host.alias]: null }));
    } finally {
      setCcCheckingHosts((prev) => ({ ...prev, [host.alias]: false }));
    }
  }

  /** 打开 CC 绑定弹窗：免密直接开；非免密先弹密码框（复用 passwordModal，扩展 mode）*/
  async function openCcBindModal(host: SshHost) {
    setError("");
    setInfo("");
    const passwordless = await invoke<boolean>("check_ssh_passwordless", { host: host.alias });
    if (passwordless) {
      setCcBindModal({ host: host.alias });
    } else {
      // 非免密：复用密码弹窗，mode=cc 触发密码确认后开 CC 绑定弹窗
      setPasswordModal({ host: host.alias, password: "", mode: "cc", saving: false });
    }
  }

  /** 展开账号的模型列表（首次拉取并缓存）*/
  async function openCcPicker(accountId: string) {
    if (ccPicker?.accountId === accountId) {
      setCcPicker(null);
      return;
    }
    setCcPicker({ accountId });
    if (modelCache[accountId]) return;
    setPickerLoading(true);
    try {
      const models = await invoke<string[]>("fetch_models", { accountId });
      setModelCache((prev) => ({ ...prev, [accountId]: models }));
    } catch (e) {
      setError(String(e));
    } finally {
      setPickerLoading(false);
    }
  }

  /** 执行远程绑定：选定的账号 + 模型（或该账号默认）写入远程 settings.json */
  async function handleCcBind(accountId: string, model?: string) {
    if (!ccBindModal) return;
    const { host } = ccBindModal;
    setCcBinding(host);
    setError("");
    setInfo("");
    try {
      await invoke("ssh_bind_claude_code", {
        host,
        password: null,
        accountId,
        model: model ?? null,
      });
      setInfo(t('codexPane.sshCcBindSuccess'));
      setCcBindModal(null);
      setCcPicker(null);
      // 重新检测该主机状态以回显新值
      const h = sshHosts.find((s) => s.alias === host);
      if (h) checkCcState(h);
    } catch (e) {
      setError(String(e));
    } finally {
      setCcBinding(null);
    }
  }

  /** 远程解绑：清除 ANTHROPIC_* 字段。后端自动处理密码 */
  async function handleCcUnbind(host: SshHost) {
    setCcBinding(host.alias);
    setError("");
    setInfo("");
    try {
      await invoke("ssh_unbind_claude_code", {
        host: host.alias,
        password: null,
      });
      setInfo(t('codexPane.sshCcUnbindSuccess'));
      await checkCcState(host);
    } catch (e) {
      setError(String(e));
    } finally {
      setCcBinding(null);
    }
  }

  const bindableAccounts = accounts.filter(
    (account) => (account.platform ?? "zhipu") === "zhipu" || account.platform === "deepseek",
  );
  const tokenExpired = authSummary?.access_token_exp
    ? new Date(authSummary.access_token_exp).getTime() < Date.now()
    : false;

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
          {error}
        </div>
      )}

      {info && (
        <div className="text-[11px] text-[var(--color-accent)] rounded-xl p-3 border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5">
          {info}
        </div>
      )}

      {/* 角色切换 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5">
        <span className="text-[10px] text-[var(--color-text-tertiary)] mb-1.5 block">
          {t('codexPane.role')}
        </span>
        <div className="flex items-center gap-1.5 p-1 bg-[var(--color-bg-tertiary)] rounded-lg">
          <button
            onClick={() => handleRoleChange("owner")}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-[var(--transition-fast)] ${
              role === "owner"
                ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            {t('codexPane.roleOwner')}
          </button>
          <button
            onClick={() => handleRoleChange("consumer")}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-[var(--transition-fast)] ${
              role === "consumer"
                ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            {t('codexPane.roleConsumer')}
          </button>
        </div>
        <p className="text-[9px] text-[var(--color-text-tertiary)] mt-1.5 leading-relaxed">
          {role === "owner" ? t('codexPane.roleOwnerDesc') : t('codexPane.roleConsumerDesc')}
        </p>
      </div>

      {/* 本机鉴权状态 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
            {t('codexPane.localAuthStatus')}
          </span>
          <button
            onClick={refreshAuth}
            disabled={refreshing}
            className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-[var(--transition-fast)]"
          >
            {refreshing ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
            {refreshing ? t('codexPane.refreshing') : t('codexPane.refresh')}
          </button>
        </div>

        {authSummary?.exists ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--color-text-tertiary)]">{t('codexPane.accountId')}</span>
              <span className="font-mono text-[var(--color-text-secondary)]">
                {authSummary.account_id ? `...${authSummary.account_id.slice(-8)}` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--color-text-tertiary)]">{t('codexPane.tokenExpiry')}</span>
              <span
                className={`font-medium ${
                  tokenExpired
                    ? "text-[var(--color-danger)]"
                    : "text-[var(--color-success)]"
                }`}
              >
                {formatExpiry(authSummary.access_token_exp, t)}
              </span>
            </div>
            {tokenExpired && (
              <div className="text-[9px] text-[var(--color-danger)] bg-[var(--color-danger)]/5 border border-[var(--color-danger)]/20 rounded-lg px-2 py-1.5">
                {t('codexPane.tokenExpiredWarn')}
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-[var(--color-text-tertiary)] py-1">
            {t('codexPane.noLocalAuth')}
          </div>
        )}
      </div>

      {/* 配置区：Gist URL + GitHub Token */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2.5">
        <span className="text-[10px] text-[var(--color-text-tertiary)] block">
          {t('codexPane.gistConfig')}
        </span>
        <input
          type="text"
          placeholder={t('codexPane.gistUrlPlaceholder')}
          value={gistUrl}
          onChange={(e) => handleGistUrlChange(e.target.value)}
          onBlur={() => saveConnectionSetting("set_codex_gist_url", { url: gistUrl })}
          className={inputClass}
        />
        {role === "owner" && (
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              placeholder={t('codexPane.githubTokenPlaceholder')}
              value={githubToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              onBlur={() => saveConnectionSetting("set_codex_github_token", { token: githubToken })}
              className={`${inputClass} font-mono pr-8`}
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              title={showToken ? t('codexPane.hide') : t('codexPane.show')}
            >
              {showToken ? "🙈" : "👁"}
            </button>
          </div>
        )}
        {/* 代理地址：境外 GitHub/ChatGPT 端点走代理；留空用默认 7890，修改后需重启生效 */}
        <input
          type="text"
          placeholder={t('codexPane.proxyPlaceholder')}
          value={proxyUrl}
          onChange={(e) => handleProxyChange(e.target.value)}
          onBlur={() => saveConnectionSetting("set_codex_proxy", { url: proxyUrl })}
          className={inputClass}
        />
        <p className="text-[9px] text-[var(--color-text-tertiary)] leading-relaxed">
          {t('codexPane.proxyDesc')}
        </p>
      </div>

      {/* 操作区 */}
      {role === "owner" ? (
        <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--color-text-tertiary)]">{t('codexPane.lastUpload')}</span>
              <span className="text-[var(--color-text-secondary)]">
                {syncInfo?.last_upload
                  ? formatRelative(syncInfo.last_upload, t)
                  : t('codexPane.never')}
              </span>
            </div>
          </div>
          <button
            onClick={handleUpload}
            disabled={uploading || !gistUrl || !githubToken}
            className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
          >
            {uploading ? t('codexPane.uploading') : t('codexPane.uploadAuth')}
          </button>
          <p className="text-[9px] text-[var(--color-text-tertiary)] leading-relaxed">
            {t('codexPane.uploadDesc')}
          </p>
          <div className="flex items-center justify-between pt-1.5 border-t border-[var(--color-border-subtle)]">
            <div>
              <span className="text-[11px] font-medium text-[var(--color-text-primary)] block">
                {t('codexPane.autoUpload')}
              </span>
              <span className="text-[9px] text-[var(--color-text-tertiary)]">
                {t('codexPane.autoUploadDesc')}
              </span>
            </div>
            <Toggle checked={autoUpload} onChange={() => handleAutoUploadToggle(!autoUpload)} />
          </div>
        </div>
      ) : (
        <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-[var(--color-text-tertiary)]">{t('codexPane.lastSync')}</span>
            <span className="text-[var(--color-text-secondary)]">
              {syncInfo?.last_sync
                  ? formatRelative(syncInfo.last_sync, t)
                  : t('codexPane.never')}
            </span>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing || !gistUrl}
            className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
          >
            {syncing ? t('codexPane.syncing') : t('codexPane.syncAuth')}
          </button>
          <p className="text-[9px] text-[var(--color-text-tertiary)] leading-relaxed">
            {t('codexPane.syncDesc')}
          </p>
          <div className="flex items-center justify-between pt-1.5 border-t border-[var(--color-border-subtle)]">
            <div>
              <span className="text-[11px] font-medium text-[var(--color-text-primary)] block">
                {t('codexPane.autoSync')}
              </span>
              <span className="text-[9px] text-[var(--color-text-tertiary)]">
                {t('codexPane.autoSyncDesc')}
              </span>
            </div>
            <Toggle checked={autoSync} onChange={() => handleAutoSyncToggle(!autoSync)} />
          </div>
        </div>
      )}

      {/* SSH 远程覆盖 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--color-text-primary)]">
            {t('codexPane.sshRemoteOverride')}
          </span>
          <button
            onClick={loadSshHosts}
            disabled={sshScanning}
            className="flex items-center gap-1 text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-[var(--transition-fast)]"
          >
            {sshScanning ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
            {sshScanning ? t('codexPane.sshScanning') : t('codexPane.sshScan')}
          </button>
        </div>
        <p className="text-[9px] text-[var(--color-text-tertiary)] leading-relaxed">
          {t('codexPane.sshRemoteOverrideDesc')}
        </p>

        {!sshLoaded ? (
          <button
            onClick={loadSshHosts}
            disabled={sshScanning}
            className="w-full py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)] transition-[var(--transition-fast)] disabled:opacity-50"
          >
            {sshScanning ? t('codexPane.sshScanning') : t('codexPane.sshScan')}
          </button>
        ) : sshHosts.length === 0 ? (
          <div className="text-[10px] text-[var(--color-text-tertiary)] py-1">
            {t('codexPane.sshNoHosts')}
          </div>
        ) : (
          <div className="space-y-1.5">
            {sshHosts.map((h) => {
              const isAuto = !!autoOverrides[h.alias];
              const ccState = ccStates[h.alias];
              const isCcInstalled = ccState?.installed;
              const isCcChecking = !!ccCheckingHosts[h.alias];
              const platformBadge = ccState
                ? PLATFORM_BADGE[ccState.platform] ?? PLATFORM_BADGE.unknown
                : null;
              return (
                <div
                  key={h.alias}
                  className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] p-2 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-[var(--color-text-primary)] truncate">
                          {h.alias}
                        </span>
                        <span
                          className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${
                            isAuto
                              ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                              : h.has_local_key
                                ? "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
                                : "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                          }`}
                        >
                          {isAuto
                            ? t('codexPane.sshAutoOverride')
                            : h.has_local_key
                              ? t('codexPane.sshLocalKey')
                              : t('codexPane.sshNoLocalKey')}
                        </span>
                      </div>
                      <div className="text-[9px] text-[var(--color-text-tertiary)] font-mono truncate mt-0.5">
                        {h.user}@{h.hostname}:{h.port}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleSshPush(h)}
                        disabled={pushingHost === h.alias}
                        className="px-2 py-1 text-[10px] font-medium rounded-md bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-[var(--transition-fast)]"
                      >
                        {pushingHost === h.alias ? t('codexPane.sshPushing') : t('codexPane.sshPush')}
                      </button>
                      <Toggle
                        checked={isAuto}
                        onChange={() => handleAutoOverrideToggle(h.alias, !isAuto)}
                      />
                    </div>
                  </div>
                  {/* Claude Code 远程状态行 */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--color-border-subtle)]">
                    <div className="flex items-center gap-1.5 min-w-0 text-[10px]">
                      <span className="text-[var(--color-text-tertiary)] shrink-0">Claude Code:</span>
                      {isCcChecking ? (
                        <span className="text-[var(--color-text-tertiary)]">{t('codexPane.sshCcChecking')}</span>
                      ) : isCcInstalled ? (
                        <>
                          {ccState?.base_url ? (
                            <>
                              {platformBadge && (
                                <span className={`text-[9px] px-1 py-0.5 rounded shrink-0 ${platformBadge.cls}`}>
                                  {platformBadge.text}
                                </span>
                              )}
                              {ccState?.model && (
                                <span className="font-mono text-[var(--color-text-secondary)] truncate">
                                  {ccState.model}
                                </span>
                              )}
                            </>
                          ) : (
                            // 已装 CC 但未绑定任何端点
                            <span className="text-[var(--color-text-tertiary)]">{t('codexPane.sshCcNoBinding')}</span>
                          )}
                        </>
                      ) : ccState === null ? (
                        <span className="text-[var(--color-text-tertiary)]">{t('codexPane.sshCcUnknown')}</span>
                      ) : (
                        <span className="text-[var(--color-text-tertiary)]">{t('codexPane.sshCcNotInstalled')}</span>
                      )}
                    </div>
                    {isCcInstalled && (
                      <div className="flex items-center gap-1 shrink-0">
                        {ccState?.model && (
                          <button
                            onClick={() => handleCcUnbind(h)}
                            disabled={ccBinding === h.alias}
                            className="px-1.5 py-0.5 text-[10px] rounded-md text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] disabled:opacity-50 transition-[var(--transition-fast)]"
                          >
                            {t('codexPane.sshCcUnbind')}
                          </button>
                        )}
                        <button
                          onClick={() => openCcBindModal(h)}
                          disabled={ccBinding === h.alias}
                          className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-accent)] hover:text-white disabled:opacity-50 transition-[var(--transition-fast)]"
                        >
                          {ccBinding === h.alias ? t('codexPane.sshCcBinding') : t('codexPane.sshCcSwitch')}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SSH 密码弹窗 */}
      {passwordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl p-4 w-[320px] shadow-xl space-y-3">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">
              {t('codexPane.sshNeedPasswordTitle')}
            </div>
            <div className="text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
              {passwordModal.mode === "push"
                ? t('codexPane.sshNeedPasswordPush')
                : passwordModal.mode === "auto"
                  ? t('codexPane.sshNeedPasswordAuto')
                  : t('codexPane.sshNeedPasswordCc')}
            </div>
            <input
              type="password"
              autoFocus
              value={passwordModal.password}
              onChange={(e) => setPasswordModal({ ...passwordModal, password: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !passwordModal.saving) confirmPasswordModal();
              }}
              placeholder={t('codexPane.sshPasswordPlaceholder')}
              className={inputClass}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setPasswordModal(null)}
                disabled={passwordModal.saving}
                className="flex-1 py-2 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50 transition-[var(--transition-fast)]"
              >
                {t('codexPane.sshCancel')}
              </button>
              <button
                onClick={confirmPasswordModal}
                disabled={passwordModal.saving || !passwordModal.password}
                className="flex-1 py-2 rounded-lg text-xs bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-[var(--transition-fast)]"
              >
                {passwordModal.saving ? t('codexPane.sshSaving') : t('codexPane.sshConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 远程 Claude Code 绑定弹窗：选账号 → 选模型 → 推送 */}
      {ccBindModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl p-4 w-[360px] shadow-xl space-y-3">
            <div className="text-xs font-semibold text-[var(--color-text-primary)]">
              {t('codexPane.sshCcBindTitle')}
              <span className="ml-1.5 font-mono text-[10px] text-[var(--color-text-tertiary)]">
                {ccBindModal.host}
              </span>
            </div>
            <div className="text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
              {t('codexPane.sshCcBindDesc')}
            </div>

            {/* 账号列表（GLM + DeepSeek）*/}
            <div className="space-y-1 max-h-64 overflow-y-auto scroll-area">
              <div className="text-[10px] text-[var(--color-text-tertiary)]">
                {t('codexPane.sshCcSelectAccount')}
              </div>
              {bindableAccounts.length === 0 ? (
                <div className="text-[10px] text-[var(--color-danger)] py-2">
                  {t('codexPane.sshCcNoAccount')}
                </div>
              ) : (
                bindableAccounts
                  .map((acc) => {
                    const isOpen = ccPicker?.accountId === acc.id;
                    const models = modelCache[acc.id] ?? [];
                    const platformLabel =
                      acc.platform === "deepseek" ? "DeepSeek" : "GLM";
                    return (
                      <div
                        key={acc.id}
                        className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] overflow-hidden"
                      >
                        <button
                          onClick={() => openCcPicker(acc.id)}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)]"
                        >
                          <span className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">
                            {acc.alias}
                          </span>
                          <span className="text-[9px] text-[var(--color-text-tertiary)] shrink-0">
                            {platformLabel}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)]">
                            {/* 默认模型快捷按钮 */}
                            <button
                              onClick={() => handleCcBind(acc.id)}
                              disabled={!!ccBinding}
                              className="w-full text-left px-2.5 py-1.5 text-[10px] text-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] disabled:opacity-50 transition-[var(--transition-fast)]"
                            >
                              {t('codexPane.sshCcUseDefaultModel')}
                            </button>
                            {pickerLoading ? (
                              <div className="px-2.5 py-1.5 text-[10px] text-[var(--color-text-tertiary)]">
                                {t('generalPane.loadingModels')}
                              </div>
                            ) : (
                              models.map((m) => (
                                <button
                                  key={m}
                                  onClick={() => handleCcBind(acc.id, m)}
                                  disabled={!!ccBinding}
                                  className="w-full text-left px-2.5 py-1.5 text-[10px] font-mono text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-[var(--transition-fast)]"
                                >
                                  {m}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>

            <div className="flex justify-end pt-1">
              <button
                onClick={() => {
                  setCcBindModal(null);
                  setCcPicker(null);
                }}
                disabled={!!ccBinding}
                className="px-3 py-1.5 rounded-lg text-xs border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50 transition-[var(--transition-fast)]"
              >
                {t('codexPane.sshCancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
