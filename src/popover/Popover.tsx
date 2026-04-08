import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import QuotaCard from "./QuotaCard";
import AccountSwitch from "./AccountSwitch";

interface QuotaLimit {
  limit_type: string;
  percentage: number;
  next_reset_time: number;
}

interface QuotaData {
  limits: QuotaLimit[];
  level: string;
}

interface Account {
  id: string;
  alias: string;
  level: string | null;
  is_active: boolean;
}

function Popover() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<Account[]>("list_accounts").then((accs) => {
      setAccounts(accs);
      if (accs.length > 0 && !selectedAccount) {
        setSelectedAccount(accs[0].id);
      }
    });
  }, []);

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
      if (selectedAccount) {
        await fetchQuota(selectedAccount);
      }
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  function getTimeLimit() {
    return quota?.limits.find((l) => l.limit_type === "TIME_LIMIT");
  }

  function getTokenLimit() {
    return quota?.limits.find((l) => l.limit_type === "TOKENS_LIMIT");
  }

  const maxPct = quota
    ? Math.max(
        ...quota.limits.map((l) => l.percentage),
      )
    : 0;

  return (
    <div className="w-[360px] h-[500px] bg-neutral-900 text-white flex flex-col select-none">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-sm font-semibold text-neutral-300">
          GLM Quota Monitor
        </h1>
        <div className="flex gap-2">
          <button
            onClick={refreshAll}
            disabled={loading}
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            {loading ? "..." : "刷新"}
          </button>
          <button
            onClick={() => invoke("open_settings_command")}
            className="text-xs text-neutral-400 hover:text-white transition-colors"
          >
            设置
          </button>
        </div>
      </div>

      {/* 账号切换 */}
      {accounts.length > 0 && (
        <div className="px-4 pb-2">
          <AccountSwitch
            accounts={accounts}
            selected={selectedAccount}
            onSelect={setSelectedAccount}
          />
        </div>
      )}

      {/* 额度卡片 */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3">
        {error && (
          <div className="text-red-400 text-xs bg-red-900/30 rounded-lg p-3">
            {error}
          </div>
        )}

        {!accounts.length && !error && (
          <div className="text-center py-12">
            <p className="text-neutral-500 text-sm">暂无账号</p>
            <button
              onClick={() => invoke("open_settings_command")}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300"
            >
              添加账号
            </button>
          </div>
        )}

        {quota && (
          <>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs px-2 py-0.5 rounded bg-blue-900/50 text-blue-300 uppercase">
                {quota.level}
              </span>
            </div>

            <QuotaCard
              title="5h Token 窗口"
              percentage={getTimeLimit()?.percentage ?? 0}
              resetTime={getTimeLimit()?.next_reset_time ?? 0}
              color="blue"
            />

            <QuotaCard
              title="周额度"
              percentage={getTokenLimit()?.percentage ?? 0}
              resetTime={getTokenLimit()?.next_reset_time ?? 0}
              color="purple"
            />
          </>
        )}
      </div>

      {/* 底部总览 */}
      {quota && (
        <div className="px-4 py-2 border-t border-neutral-800 text-xs text-neutral-500 text-center">
          最高使用率: {maxPct}%
        </div>
      )}
    </div>
  );
}

export default Popover;
