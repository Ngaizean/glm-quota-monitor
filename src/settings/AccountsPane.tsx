import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAvatarGradient, getLevelStyle } from "../lib/ui";
import type { Account, AgentBinding } from "../types";

const inputClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] placeholder:text-[var(--color-text-tertiary)]";

type AgentType = "claude_code" | "openclaw";

export default function AccountsPane() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bindings, setBindings] = useState<Record<string, string | null>>({});
  const [defaultModel, setDefaultModel] = useState("glm-5.1");
  const [modelCache, setModelCache] = useState<Record<string, string[]>>({});
  const [picker, setPicker] = useState<{ accountId: string; agent: AgentType } | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [confirmCopyId, setConfirmCopyId] = useState<string | null>(null);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [newKeyInput, setNewKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [alias, setAlias] = useState("");
  const [purpose, setPurpose] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [platformTab, setPlatformTab] = useState<"zhipu" | "codex">("zhipu");
  const [codexImporting, setCodexImporting] = useState(false);
  const [showCodexImport, setShowCodexImport] = useState(false);
  const [codexAlias, setCodexAlias] = useState("");
  const [codexAuthExists, setCodexAuthExists] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const [accs, binds, model] = await Promise.all([
        invoke<Account[]>("list_accounts"),
        invoke<AgentBinding[]>("get_agent_bindings"),
        invoke<string>("get_default_model"),
      ]);
      setAccounts(accs);
      setDefaultModel(model || "glm-5.1");
      const map: Record<string, string | null> = {};
      for (const b of binds) {
        map[b.agent] = b.account_id;
      }
      setBindings(map);
      // 加载 Codex 本机鉴权状态
      try {
        const auth = await invoke<{ exists: boolean }>("read_local_codex_auth");
        setCodexAuthExists(auth.exists);
      } catch { /* ignore */ }
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleImportCodex() {
    if (!codexAlias.trim()) return;
    setCodexImporting(true);
    setError("");
    try {
      await invoke("add_codex_account", { alias: codexAlias.trim() });
      setCodexAlias("");
      setShowCodexImport(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setCodexImporting(false);
    }
  }

  async function handleAdd() {
    if (!alias.trim() || !purpose.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError("");
    try {
      await invoke("add_account", {
        alias: alias.trim(),
        purpose: purpose.trim(),
        apiKey: apiKey.trim(),
      });
      setAlias("");
      setPurpose("");
      setApiKey("");
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
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

  // 复制 API Key：拿到明文后立即写入剪贴板，不存入 state
  async function handleCopyKey(accountId: string) {
    setCopyingId(accountId);
    setError("");
    try {
      const rawKey = await invoke<string>("get_api_key_raw", { accountId });
      await navigator.clipboard.writeText(rawKey);
      setCopiedId(accountId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      setError(String(e));
    } finally {
      setCopyingId(null);
      setConfirmCopyId(null);
    }
  }

  function openKeyEditor(accountId: string) {
    setEditorId((prev) => (prev === accountId ? null : accountId));
    setNewKeyInput("");
    setError("");
  }

  async function handleSaveKey(accountId: string) {
    if (!newKeyInput.trim()) return;
    setSavingKey(true);
    setError("");
    try {
      await invoke("update_api_key", {
        accountId,
        newApiKey: newKeyInput.trim(),
      });
      setEditorId(null);
      setNewKeyInput("");
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingKey(false);
    }
  }

  async function handleBind(agent: AgentType, accountId: string, model?: string) {
    try {
      await invoke("bind_agent", { agent, accountId, model });
      setPicker(null);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function openPicker(agent: AgentType, accountId: string) {
    const cacheKey = `${accountId}`;
    if (picker?.accountId === accountId && picker.agent === agent) {
      setPicker(null);
      return;
    }
    setPicker({ accountId, agent });
    if (modelCache[cacheKey]) return;
    setPickerLoading(true);
    try {
      const models = await invoke<string[]>("fetch_models", { accountId });
      setModelCache((prev) => ({ ...prev, [cacheKey]: models }));
    } catch (e) {
      setError(String(e));
    } finally {
      setPickerLoading(false);
    }
  }

  const glmAccounts = accounts.filter((a) => a.platform !== "codex");
  const codexAccounts = accounts.filter((a) => a.platform === "codex");

  const groups = useMemo(
    () =>
      glmAccounts.reduce<Record<string, Account[]>>((acc, cur) => {
        if (!acc[cur.alias]) acc[cur.alias] = [];
        acc[cur.alias].push(cur);
        return acc;
      }, {}),
    [glmAccounts],
  );

  return (
    <div className="space-y-3">
      {/* 平台切换 */}
      <div className="flex items-center gap-1 p-1 bg-[var(--color-bg-tertiary)] rounded-lg">
        <button
          onClick={() => { setPlatformTab("zhipu"); setShowAdd(false); setShowCodexImport(false); }}
          className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-[var(--transition-fast)] ${
            platformTab === "zhipu"
              ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
              : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {t('accountsPane.platformGlm')}
        </button>
        <button
          onClick={() => { setPlatformTab("codex"); setShowAdd(false); setShowCodexImport(false); }}
          className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-[var(--transition-fast)] ${
            platformTab === "codex"
              ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
              : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
          }`}
        >
          {t('accountsPane.platformCodex')}
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
          {error}
        </div>
      )}

      {/* GLM 平台 */}
      {platformTab === "zhipu" && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
              {glmAccounts.length > 0 ? t('accountsPane.keyCount', { count: glmAccounts.length }) : ""}
            </span>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="text-[11px] font-medium px-3 py-1.5 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] rounded-lg transition-[var(--transition-fast)] shadow-sm"
            >
              {showAdd ? t('accountsPane.cancel') : t('accountsPane.add')}
            </button>
          </div>

          {showAdd && (
            <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3.5 space-y-2.5 border border-[var(--color-border-subtle)] animate-slide-down">
              <input type="text" placeholder={t('accountsPane.aliasPlaceholder')} value={alias} onChange={(e) => setAlias(e.target.value)} className={inputClass} />
              <input type="text" placeholder={t('accountsPane.purposePlaceholder')} value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputClass} />
              <input type="password" placeholder={t('accountsPane.apiKeyPlaceholder')} value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={`${inputClass} font-mono`} />
              <button
                onClick={handleAdd}
                disabled={loading || !alias.trim() || !purpose.trim() || !apiKey.trim()}
                className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
              >
                {loading ? t('accountsPane.verifying') : t('accountsPane.addAccount')}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {Object.entries(groups).map(([name, keys]) => (
          <div key={name} className="bg-[var(--color-bg-secondary)] rounded-xl overflow-hidden border border-[var(--color-border-subtle)]">
            <div className="px-3 py-2.5 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-lg bg-gradient-to-br ${getAvatarGradient(name)} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}>
                  {name.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">{name}</span>
              </div>
              <span className="text-[10px] text-[var(--color-text-tertiary)] font-medium">{keys.length} Key</span>
            </div>

            {keys.map((acc) => {
              const isPickerOpen = picker?.accountId === acc.id;
              const models = modelCache[acc.id] ?? [];
              return (
                <div key={acc.id} className="border-b border-[var(--color-border-subtle)] last:border-b-0">
                  <div className="flex items-center justify-between px-3 py-2.5 hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)]">
                    <div className="flex items-center gap-2.5">
                      <span className="text-xs text-[var(--color-text-secondary)]">{acc.purpose}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${getLevelStyle(acc.level)}`}>
                        {acc.level ?? "—"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <div className="flex items-center gap-1">
                        <div className="flex">
                          <button
                            onClick={() => handleBind("claude_code", acc.id)}
                            title={bindings["claude_code"] === acc.id ? t('accountsPane.ccBound', { model: defaultModel }) : t('accountsPane.ccBind', { model: defaultModel })}
                            className={`text-[9px] font-bold px-2.5 py-0.5 rounded-l-md border transition-[var(--transition-fast)] ${
                              bindings["claude_code"] === acc.id
                                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                                : "text-[var(--color-text-tertiary)] border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                            }`}
                          >
                            CC
                          </button>
                          <button
                            onClick={() => openPicker("claude_code", acc.id)}
                            className={`text-[9px] px-1.5 py-0.5 rounded-r-md border-l-0 border transition-[var(--transition-fast)] ${
                              isPickerOpen && picker?.agent === "claude_code"
                                ? "border-[var(--color-accent)] text-white bg-[var(--color-accent)]"
                                : bindings["claude_code"] === acc.id
                                  ? "border-[var(--color-accent)] text-white/80 bg-[var(--color-accent)] hover:text-white"
                                  : "border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                            }`}
                            title={t('accountsPane.selectOverrideModel', { agent: picker?.agent === "claude_code" ? "Claude Code" : "OpenClaw" })}
                          >
                            ▾
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <div className="flex">
                          <button
                            onClick={() => handleBind("openclaw", acc.id)}
                            title={bindings["openclaw"] === acc.id ? t('accountsPane.ocBound', { model: defaultModel }) : t('accountsPane.ocBind', { model: defaultModel })}
                            className={`text-[9px] font-bold px-2.5 py-0.5 rounded-l-md border transition-[var(--transition-fast)] ${
                              bindings["openclaw"] === acc.id
                                ? "bg-[var(--color-accent)] text-white border-[var(--color-accent)]"
                                : "text-[var(--color-text-tertiary)] border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                            }`}
                          >
                            OC
                          </button>
                          <button
                            onClick={() => openPicker("openclaw", acc.id)}
                            className={`text-[9px] px-1.5 py-0.5 rounded-r-md border-l-0 border transition-[var(--transition-fast)] ${
                              isPickerOpen && picker?.agent === "openclaw"
                                ? "border-[var(--color-accent)] text-white bg-[var(--color-accent)]"
                                : bindings["openclaw"] === acc.id
                                  ? "border-[var(--color-accent)] text-white/80 bg-[var(--color-accent)] hover:text-white"
                                  : "border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                            }`}
                            title="选择 OpenClaw 覆盖模型"
                          >
                            ▾
                          </button>
                        </div>
                      </div>

                      <button
                        onClick={() => setConfirmCopyId((prev) => (prev === acc.id ? null : acc.id))}
                        title={t('accountsPane.copyKey')}
                        className="text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)] transition-[var(--transition-fast)] p-1 rounded-md hover:bg-[var(--color-accent)]/5"
                      >
                        {copiedId === acc.id ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        ) : (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                        )}
                      </button>

                      <button
                        onClick={() => openKeyEditor(acc.id)}
                        title={t('accountsPane.modifyKey')}
                        className={`transition-[var(--transition-fast)] p-1 rounded-md hover:bg-[var(--color-accent)]/5 ${
                          editorId === acc.id
                            ? "text-[var(--color-accent)]"
                            : "text-[var(--color-text-tertiary)] hover:text-[var(--color-accent)]"
                        }`}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>

                      <button onClick={() => handleDelete(acc.id)} className="text-[10px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] transition-[var(--transition-fast)] p-1 rounded-md hover:bg-[var(--color-danger)]/5">
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>

                  {isPickerOpen && (
                    <div className="px-3 pb-3">
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] p-2.5 space-y-2 animate-slide-down">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-[var(--color-text-tertiary)]">
                            {t('accountsPane.selectOverrideModel', { agent: picker?.agent === "claude_code" ? "Claude Code" : "OpenClaw" })}
                          </span>
                          <button
                            onClick={() => setPicker(null)}
                            className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                          >
                            {t('accountsPane.collapse')}
                          </button>
                        </div>

                        <button
                          onClick={() => handleBind(picker!.agent, acc.id)}
                          className="w-full text-left px-3 py-2 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] transition-[var(--transition-fast)]"
                        >
                          <div className="text-[11px] font-medium text-[var(--color-text-primary)]">{t('accountsPane.useDefaultModel')}</div>
                          <div className="text-[10px] text-[var(--color-text-tertiary)] font-mono mt-0.5">{defaultModel}</div>
                        </button>

                        <div className="max-h-40 overflow-y-auto scroll-area overscroll-contain rounded-lg border border-[var(--color-border-subtle)]">
                          {pickerLoading ? (
                            <div className="px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">{t('accountsPane.loadingModels')}</div>
                          ) : models.length ? (
                            models.map((model) => (
                              <button
                                key={model}
                                onClick={() => handleBind(picker!.agent, acc.id, model)}
                                className="w-full text-left px-3 py-2 text-[10px] font-mono text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)] transition-[var(--transition-fast)] border-b border-[var(--color-border-subtle)] last:border-b-0"
                              >
                                {model}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-[10px] text-[var(--color-text-tertiary)]">{t('accountsPane.noModels')}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {confirmCopyId === acc.id && (
                    <div className="px-3 pb-3 animate-slide-down">
                      <div className="rounded-xl border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-2.5 flex items-center gap-2">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        <span className="text-[10px] text-[var(--color-text-secondary)] flex-1">
                          {t('accountsPane.copyConfirm')}
                        </span>
                        <button
                          onClick={() => handleCopyKey(acc.id)}
                          disabled={copyingId === acc.id}
                          className="text-[10px] font-medium px-2.5 py-1 bg-[var(--color-warning)] text-white hover:opacity-90 disabled:opacity-50 rounded-md transition-[var(--transition-fast)]"
                        >
                          {copyingId === acc.id ? "..." : t('common.confirm')}
                        </button>
                        <button
                          onClick={() => setConfirmCopyId(null)}
                          className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] px-1"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {editorId === acc.id && (
                    <div className="px-3 pb-3 animate-slide-down">
                      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] p-2.5 space-y-2">
                        <input
                          type="password"
                          placeholder={t('accountsPane.newKeyPlaceholder')}
                          value={newKeyInput}
                          onChange={(e) => setNewKeyInput(e.target.value)}
                          className={`${inputClass} font-mono`}
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSaveKey(acc.id)}
                            disabled={savingKey || !newKeyInput.trim()}
                            className="flex-1 py-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-[11px] font-medium transition-[var(--transition-fast)]"
                          >
                            {savingKey ? t('accountsPane.modifyKeyVerifying') : t('accountsPane.modifyKeySave')}
                          </button>
                          <button
                            onClick={() => { setEditorId(null); setNewKeyInput(""); }}
                            className="px-3 py-1.5 text-[11px] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)]"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
          </div>

        {glmAccounts.length === 0 && !showAdd && (
          <div className="text-center py-10">
            <div className="w-10 h-10 mx-auto rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] flex items-center justify-center mb-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('accountsPane.noAccounts')}</p>
          </div>
        )}
        </>
      )}

      {/* Codex 平台 */}
      {platformTab === "codex" && (
        <>
          <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${codexAuthExists ? "bg-[var(--color-success)]" : "bg-[var(--color-text-tertiary)]"}`} />
              <span className="text-[11px] font-medium text-[var(--color-text-primary)]">{t('codexPane.localAuthStatus')}</span>
            </div>
            <p className="text-[10px] text-[var(--color-text-tertiary)] mt-1.5 leading-relaxed">
              {codexAuthExists ? t('codexPane.localAuthDetected') : t('codexPane.noLocalAuth')}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
              {codexAccounts.length > 0 ? t('accountsPane.keyCount', { count: codexAccounts.length }) : t('codexPane.noAccounts')}
            </span>
            <button
              onClick={() => setShowCodexImport(!showCodexImport)}
              className="text-[11px] font-medium px-3 py-1.5 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] rounded-lg transition-[var(--transition-fast)] shadow-sm"
            >
              {showCodexImport ? t('accountsPane.cancel') : t('codexPane.importCodex')}
            </button>
          </div>

          {showCodexImport && (
            <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3.5 space-y-2.5 border border-[var(--color-border-subtle)] animate-slide-down">
              <input
                type="text"
                placeholder={t('accountsPane.aliasPlaceholder')}
                value={codexAlias}
                onChange={(e) => setCodexAlias(e.target.value)}
                className={inputClass}
                autoFocus
              />
              <button
                onClick={handleImportCodex}
                disabled={codexImporting || !codexAlias.trim() || !codexAuthExists}
                className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
              >
                {codexImporting ? t('accountsPane.verifying') : t('codexPane.importCodex')}
              </button>
            </div>
          )}

          <div className="space-y-2">
            {codexAccounts.map((acc) => {
              const gradient = getAvatarGradient(acc.alias);
              return (
                <div key={acc.id} className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3 flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: gradient }}>
                    {acc.alias.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">{acc.alias}</div>
                    <div className="text-[9px] text-[var(--color-text-tertiary)]">
                      {acc.level || "—"}
                      {acc.is_primary && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded text-[8px] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-medium">{t('account.primary')}</span>
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

            {codexAccounts.length === 0 && !showCodexImport && (
              <div className="text-center py-10">
                <div className="w-10 h-10 mx-auto rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] flex items-center justify-center mb-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                <p className="text-[11px] text-[var(--color-text-tertiary)]">{t('codexPane.noAccounts')}</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
