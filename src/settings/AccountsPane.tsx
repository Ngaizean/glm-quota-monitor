import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface Account {
  id: string;
  alias: string;
  level: string | null;
  is_active: boolean;
}

export default function AccountsPane() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [alias, setAlias] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    refreshAccounts();
  }, []);

  async function refreshAccounts() {
    try {
      const accs = await invoke<Account[]>("list_accounts");
      setAccounts(accs);
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleAdd() {
    if (!alias.trim() || !apiKey.trim()) return;
    setLoading(true);
    setError("");
    try {
      await invoke("add_account", { alias: alias.trim(), apiKey: apiKey.trim() });
      setAlias("");
      setApiKey("");
      setShowAdd(false);
      await refreshAccounts();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await invoke("delete_account", { id });
      await refreshAccounts();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">账号管理</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          {showAdd ? "取消" : "添加账号"}
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-xs bg-red-900/30 rounded p-2">
          {error}
        </div>
      )}

      {/* 添加表单 */}
      {showAdd && (
        <div className="bg-neutral-800 rounded-lg p-3 space-y-2">
          <input
            type="text"
            placeholder="账号别名（如：主账号）"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="w-full bg-neutral-700 rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="password"
            placeholder="API Key（格式：id.secret）"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full bg-neutral-700 rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-500 font-mono"
          />
          <button
            onClick={handleAdd}
            disabled={loading || !alias.trim() || !apiKey.trim()}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-neutral-700 disabled:text-neutral-500 rounded text-sm transition-colors"
          >
            {loading ? "验证中..." : "添加"}
          </button>
        </div>
      )}

      {/* 账号列表 */}
      <div className="space-y-2">
        {accounts.map((acc) => (
          <div
            key={acc.id}
            className="flex items-center justify-between bg-neutral-800 rounded-lg p-3"
          >
            <div>
              <div className="text-sm">{acc.alias}</div>
              <div className="text-xs text-neutral-500">
                {acc.level?.toUpperCase() ?? "Unknown"}
              </div>
            </div>
            <button
              onClick={() => handleDelete(acc.id)}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              删除
            </button>
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="text-neutral-500 text-xs text-center py-4">
            暂无账号，点击上方添加
          </p>
        )}
      </div>
    </div>
  );
}
