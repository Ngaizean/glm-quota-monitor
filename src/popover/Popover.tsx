import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

interface QuotaLimit {
  type: string;
  percentage: number;
  nextResetTime: number;
}

interface QuotaData {
  limits: QuotaLimit[];
  level: string;
}

interface Account {
  id: string;
  alias: string;
  purpose: string;
  level: string | null;
  is_active: boolean;
}

function formatResetTime(ts: number): string {
  if (!ts) return "--";
  const diff = ts - Date.now();
  if (diff <= 0) return "即将重置";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}天后`;
  return `${hours}h ${mins}m`;
}

function getStatusColor(pct: number): string {
  if (pct > 85) return "bg-red-500";
  if (pct > 60) return "bg-amber-500";
  return "bg-green-500";
}

function getLevelBadge(level: string) {
  const colors: Record<string, string> = {
    lite: "bg-gray-100 text-gray-600",
    pro: "bg-blue-50 text-blue-600",
    max: "bg-purple-50 text-purple-600",
  };
  return colors[level] || "bg-gray-100 text-gray-600";
}

function QuotaBar({ title, percentage, resetTime }: {
  title: string; percentage: number; resetTime: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor(percentage)}`} />
          <span className="text-xs text-gray-500">{title}</span>
        </div>
        <span className="text-sm font-semibold text-gray-900">{percentage}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${getStatusColor(percentage)}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      <div className="text-[10px] text-gray-400">重置: {formatResetTime(resetTime)}</div>
    </div>
  );
}

function Popover({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const current = accounts.find((a) => a.id === selectedAccount);

  function loadAccounts() {
    invoke<Account[]>("list_accounts").then((accs) => {
      setAccounts(accs);
      if (accs.length === 0) {
        setSelectedAccount("");
        setQuota(null);
      }
    }).catch((e) => {
      console.error("loadAccounts failed:", e);
      setError(String(e));
    });
  }

  useEffect(() => { loadAccounts(); }, []);

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        loadAccounts();
      } else {
        getCurrentWindow().hide();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (accounts.length > 0 && !accounts.find((a) => a.id === selectedAccount)) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts]);

  useEffect(() => {
    if (!selectedAccount) return;
    fetchQuota(selectedAccount);
  }, [selectedAccount]);

  async function fetchQuota(accountId: string) {
    setLoading(true);
    setError("");
    try {
      const data = await invoke<QuotaData>("get_quota", { accountId });
      setQuota(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshAll() {
    setLoading(true);
    setError("");
    try {
      await invoke("refresh_all");
      if (selectedAccount) await fetchQuota(selectedAccount);
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  const tokensLimit = quota?.limits.find((l) => l.type === "TOKENS_LIMIT");
  const timeLimit = quota?.limits.find((l) => l.type === "TIME_LIMIT");

  return (
    <div className="w-full h-full bg-white rounded-2xl shadow-xl border border-gray-200/50 flex flex-col select-none overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-blue-500 rounded-md flex items-center justify-center text-white text-[10px] font-bold">G</div>
          <span className="text-xs font-semibold text-gray-700">GLM Quota</span>
        </div>
        <div className="flex gap-3">
          <button onClick={refreshAll} disabled={loading} className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors">
            {loading ? "..." : "刷新"}
          </button>
          <button onClick={onOpenSettings} className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors">
            设置
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto">
        {current && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">{current.alias}</span>
              {quota && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase ${getLevelBadge(quota.level)}`}>
                  {quota.level}
                </span>
              )}
            </div>
            {current.purpose && (
              <span className="text-xs text-gray-400">{current.purpose}</span>
            )}
            {accounts.length > 1 && (
              <div className="flex gap-1.5 pt-0.5">
                {accounts.map((acc) => (
                  <button
                    key={acc.id}
                    onClick={() => setSelectedAccount(acc.id)}
                    className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                      selectedAccount === acc.id
                        ? "bg-blue-50 text-blue-600"
                        : "bg-gray-50 text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {acc.purpose || acc.alias}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-red-500 text-xs bg-red-50 rounded-lg p-2">{error}</div>
        )}

        {!accounts.length && !error && (
          <div className="text-center py-6">
            <p className="text-gray-400 text-sm">暂无账号</p>
            <button onClick={onOpenSettings} className="mt-2 text-xs text-blue-500 hover:text-blue-600">
              添加账号
            </button>
          </div>
        )}

        {quota && (
          <>
            {tokensLimit && (
              <QuotaBar title="Token 额度" percentage={tokensLimit.percentage} resetTime={tokensLimit.nextResetTime} />
            )}
            {timeLimit && timeLimit.percentage > 0 && (
              <QuotaBar title="时间窗口" percentage={timeLimit.percentage} resetTime={timeLimit.nextResetTime} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Popover;
