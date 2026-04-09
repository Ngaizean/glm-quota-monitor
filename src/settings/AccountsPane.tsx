import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface Account {
  id: string;
  alias: string;
  purpose: string;
  level: string | null;
  is_active: boolean;
}

export default function AccountsPane() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [alias, setAlias] = useState("");
  const [purpose, setPurpose] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { refreshAccounts(); }, []);

  async function refreshAccounts() {
    try {
      const accs = await invoke<Account[]>("list_accounts");
      setAccounts(accs);
    } catch (e) { setError(String(e)); }
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
      setAlias(""); setPurpose(""); setApiKey("");
      setShowAdd(false);
      await refreshAccounts();
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    try {
      await invoke("delete_account", { id });
      await refreshAccounts();
    } catch (e) { setError(String(e)); }
  }

  const groups = accounts.reduce<Record<string, Account[]>>((acc, cur) => {
    if (!acc[cur.alias]) acc[cur.alias] = [];
    acc[cur.alias].push(cur);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-700">账号管理</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-[11px] px-2.5 py-1 bg-blue-500 text-white hover:bg-blue-600 rounded transition-colors"
        >
          {showAdd ? "取消" : "+ 添加"}
        </button>
      </div>

      {error && (
        <div className="text-red-500 text-xs bg-red-50 rounded p-2">{error}</div>
      )}

      {showAdd && (
        <div className="bg-gray-50 rounded-lg p-3 space-y-2">
          <input type="text" placeholder="账号名称" value={alias}
            onChange={(e) => setAlias(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400" />
          <input type="text" placeholder="Key 用途（如：开发、日常）" value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400" />
          <input type="password" placeholder="API Key（id.secret）" value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400 font-mono" />
          <button onClick={handleAdd}
            disabled={loading || !alias.trim() || !purpose.trim() || !apiKey.trim()}
            className="w-full py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded text-xs transition-colors">
            {loading ? "验证中..." : "添加"}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {Object.entries(groups).map(([name, keys]) => (
          <div key={name} className="bg-gray-50 rounded-lg overflow-hidden">
            <div className="px-3 py-1.5 border-b border-gray-200 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">{name}</span>
              <span className="text-[10px] text-gray-400">{keys.length} Key</span>
            </div>
            {keys.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600">{acc.purpose}</span>
                  <span className="text-[10px] text-gray-400 uppercase">{acc.level ?? "—"}</span>
                </div>
                <button onClick={() => handleDelete(acc.id)}
                  className="text-[10px] text-red-400 hover:text-red-500 transition-colors">删除</button>
              </div>
            ))}
          </div>
        ))}
        {accounts.length === 0 && (
          <p className="text-gray-400 text-xs text-center py-4">暂无账号</p>
        )}
      </div>
    </div>
  );
}
