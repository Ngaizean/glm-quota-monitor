import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAvatarGradient } from "../lib/ui";
import type { Account } from "../types";

const inputClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] placeholder:text-[var(--color-text-tertiary)]";

export default function CodexAccountsPane() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [localAuthExists, setLocalAuthExists] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [alias, setAlias] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const all = await invoke<Account[]>("list_accounts");
      setAccounts(all.filter((a) => a.platform === "codex"));
      const auth = await invoke<{ exists: boolean }>("read_local_codex_auth");
      setLocalAuthExists(auth.exists);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleImport() {
    if (!alias.trim()) return;
    setImporting(true);
    setError("");
    setInfo("");
    try {
      await invoke("add_codex_account", { alias: alias.trim() });
      setAlias("");
      setShowImport(false);
      setInfo(t('codexPane.importSuccess'));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await invoke("delete_account", { id });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

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

      {/* 本机 auth.json 状态 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${localAuthExists ? "bg-[var(--color-success)]" : "bg-[var(--color-text-tertiary)]"}`}
          />
          <span className="text-[11px] font-medium text-[var(--color-text-primary)]">
            {t('codexPane.localAuthStatus')}
          </span>
        </div>
        <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1.5 leading-relaxed">
          {localAuthExists
            ? t('codexPane.localAuthDetected')
            : t('codexPane.noLocalAuth')}
        </p>
      </div>

      {/* 导入按钮 + 表单 */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
          {accounts.length > 0
            ? t('accountsPane.keyCount', { count: accounts.length })
            : t('codexPane.noAccounts')}
        </span>
        <button
          onClick={() => setShowImport(!showImport)}
          className="text-[11px] font-medium px-3 py-1.5 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] rounded-lg transition-[var(--transition-fast)] shadow-sm"
        >
          {showImport ? t('accountsPane.cancel') : t('codexPane.importCodex')}
        </button>
      </div>

      {showImport && (
        <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3.5 space-y-2.5 border border-[var(--color-border-subtle)] animate-slide-down">
          <div className="text-[10px] text-[var(--color-text-tertiary)] leading-relaxed">
            {t('codexPane.codexImportDesc')}
          </div>
          <input
            type="text"
            placeholder={t('accountsPane.aliasPlaceholder')}
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className={inputClass}
            autoFocus
          />
          <button
            onClick={handleImport}
            disabled={importing || !alias.trim() || !localAuthExists}
            className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
          >
            {importing ? t('accountsPane.verifying') : t('codexPane.importCodex')}
          </button>
        </div>
      )}

      {/* Codex 账号列表 */}
      {accounts.map((acc) => {
        const gradient = getAvatarGradient(acc.alias);
        return (
          <div
            key={acc.id}
            className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3 flex items-center gap-2.5"
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ background: gradient }}
            >
              {acc.alias.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">
                {acc.alias}
              </div>
              <div className="text-[9px] text-[var(--color-text-tertiary)]">
                {acc.level || "—"}
                {acc.is_primary && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded text-[8px] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium">
                    {t('account.primary')}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => handleDelete(acc.id)}
              className="text-[10px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] transition-[var(--transition-fast)] p-1 rounded-md hover:bg-[var(--color-danger)]/5"
            >
              {t('common.delete')}
            </button>
          </div>
        );
      })}
    </div>
  );
}
