import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Toggle from "../lib/Toggle";

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

const inputClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] placeholder:text-[var(--color-text-tertiary)]";

function formatTime(iso: string | null, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "—";
  const diff = date.getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / 86400000);
  const hours = Math.floor((absDiff % 86400000) / 3600000);
  const isPast = diff < 0;

  if (days > 0) {
    return isPast
      ? t('codexPane.expiredDaysAgo', { count: days })
      : t('codexPane.expiresInDays', { count: days, hours });
  }
  const mins = Math.floor((absDiff % 3600000) / 60000);
  return isPast
    ? t('codexPane.expiredHoursAgo', { count: hours })
    : t('codexPane.expiresInHours', { hours, minutes: mins });
}

export default function CodexPane() {
  const { t } = useTranslation();
  const [role, setRole] = useState<string>("owner");
  const [gistUrl, setGistUrl] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [authSummary, setAuthSummary] = useState<AuthSummary | null>(null);
  const [syncInfo, setSyncInfo] = useState<SyncInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [autoUpload, setAutoUpload] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [r, url, token, auth, sync, au] = await Promise.all([
        invoke<string>("get_codex_role"),
        invoke<string | null>("get_codex_gist_url"),
        invoke<string | null>("get_codex_github_token"),
        invoke<AuthSummary>("read_local_codex_auth"),
        invoke<SyncInfo>("get_codex_sync_info"),
        invoke<boolean>("get_codex_auto_upload"),
      ]);
      setRole(r || "owner");
      setGistUrl(url || "");
      setGithubToken(token || "");
      setAuthSummary(auth);
      setSyncInfo(sync);
      setAutoUpload(au);
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshAuth() {
    try {
      const auth = await invoke<AuthSummary>("read_local_codex_auth");
      setAuthSummary(auth);
      const sync = await invoke<SyncInfo>("get_codex_sync_info");
      setSyncInfo(sync);
    } catch (e) {
      setError(String(e));
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

  async function handleGistUrlChange(value: string) {
    setGistUrl(value);
    await invoke("set_codex_gist_url", { url: value });
  }

  async function handleTokenChange(value: string) {
    setGithubToken(value);
    await invoke("set_codex_github_token", { token: value });
  }

  async function handleUpload() {
    setUploading(true);
    setError("");
    setInfo("");
    try {
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
      await invoke("sync_codex_auth");
      setInfo(t('codexPane.syncSuccess'));
      await refreshAuth();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

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
            className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-[var(--transition-fast)]"
          >
            {t('codexPane.refresh')}
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
                {formatTime(authSummary.access_token_exp, t)}
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
          className={inputClass}
        />
        {role === "owner" && (
          <div className="relative">
            <input
              type={showToken ? "text" : "password"}
              placeholder={t('codexPane.githubTokenPlaceholder')}
              value={githubToken}
              onChange={(e) => handleTokenChange(e.target.value)}
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
      </div>

      {/* 操作区 */}
      {role === "owner" ? (
        <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[var(--color-text-tertiary)]">{t('codexPane.lastUpload')}</span>
              <span className="text-[var(--color-text-secondary)]">
                {syncInfo?.last_upload
                  ? formatTime(syncInfo.last_upload, t)
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
                ? formatTime(syncInfo.last_sync, t)
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
        </div>
      )}
    </div>
  );
}
