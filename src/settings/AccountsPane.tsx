import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { getAvatarGradient, getLevelStyle } from "../lib/ui";
import type { Account, AgentBinding } from "../types";

const inputClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] placeholder:text-[var(--color-text-tertiary)]";

export default function AccountsPane() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bindings, setBindings] = useState<Record<string, string | null>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [alias, setAlias] = useState("");
  const [purpose, setPurpose] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    refresh();
  }, []);

  async function refresh() {
    try {
      const [accs, binds] = await Promise.all([
        invoke<Account[]>("list_accounts"),
        invoke<AgentBinding[]>("get_agent_bindings"),
      ]);
      setAccounts(accs);
      const map: Record<string, string | null> = {};
      for (const b of binds) {
        map[b.agent] = b.account_id;
      }
      setBindings(map);
    } catch (e) {
      setError(String(e));
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

  async function handleBind(agent: string, accountId: string) {
    try {
      await invoke("bind_agent", { agent, accountId });
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  const groups = accounts.reduce<Record<string, Account[]>>((acc, cur) => {
    if (!acc[cur.alias]) acc[cur.alias] = [];
    acc[cur.alias].push(cur);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
          {accounts.length > 0 ? `${accounts.length} 个 Key` : ""}
        </span>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-[11px] font-medium px-3 py-1.5 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] rounded-lg transition-[var(--transition-fast)] shadow-sm"
        >
          {showAdd ? "取消" : "+ 添加"}
        </button>
      </div>

      {error && (
        <div className="text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="bg-[var(--color-bg-secondary)] rounded-xl p-3.5 space-y-2.5 border border-[var(--color-border-subtle)] animate-slide-down">
          <input
            type="text"
            placeholder="账号名称"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className={inputClass}
          />
          <input
            type="text"
            placeholder="Key 用途（如：开发、日常）"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            placeholder="API Key（id.secret）"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <button
            onClick={handleAdd}
            disabled={loading || !alias.trim() || !purpose.trim() || !apiKey.trim()}
            className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
          >
            {loading ? "验证中..." : "添加账号"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {Object.entries(groups).map(([name, keys]) => (
          <div
            key={name}
            className="bg-[var(--color-bg-secondary)] rounded-xl overflow-hidden border border-[var(--color-border-subtle)]"
          >
            <div className="px-3 py-2.5 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-lg bg-gradient-to-br ${getAvatarGradient(name)} flex items-center justify-center text-[9px] font-bold text-white shrink-0`}
                >
                  {name.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-semibold text-[var(--color-text-primary)]">
                  {name}
                </span>
              </div>
              <span className="text-[10px] text-[var(--color-text-tertiary)] font-medium">
                {keys.length} Key
              </span>
            </div>
            {keys.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between px-3 py-2.5 hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-[var(--color-text-secondary)]">
                    {acc.purpose}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider ${getLevelStyle(acc.level)}`}
                  >
                    {acc.level ?? "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleBind("claude_code", acc.id)}
                    title={bindings["claude_code"] === acc.id ? "Claude Code 已绑定" : "绑定到 Claude Code"}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-[var(--transition-fast)] ${
                      bindings["claude_code"] === acc.id
                        ? "bg-[var(--color-accent)] text-white"
                        : "text-[var(--color-text-tertiary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                    }`}
                  >
                    CC
                  </button>
                  <button
                    onClick={() => handleBind("openclaw", acc.id)}
                    title={bindings["openclaw"] === acc.id ? "OpenClaw 已绑定" : "绑定到 OpenClaw"}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md transition-[var(--transition-fast)] ${
                      bindings["openclaw"] === acc.id
                        ? "bg-[var(--color-accent)] text-white"
                        : "text-[var(--color-text-tertiary)] border border-[var(--color-border)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                    }`}
                  >
                    OC
                  </button>
                  <button
                    onClick={() => handleDelete(acc.id)}
                    className="text-[10px] font-medium text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] transition-[var(--transition-fast)] p-1 rounded-md hover:bg-[var(--color-danger)]/5"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
        {accounts.length === 0 && !showAdd && (
          <div className="text-center py-10">
            <div className="w-10 h-10 mx-auto rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] flex items-center justify-center mb-2">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-text-tertiary)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">
              暂无账号，点击上方添加
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
