import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import Header from "./Header";
import AccountSelector from "./AccountSelector";
import QuotaSection from "./QuotaSection";
import UsageSummary from "./UsageSummary";

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

function Popover({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summaryKey, setSummaryKey] = useState(0);

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
      if (selectedAccount) {
        await fetchQuota(selectedAccount);
        setSummaryKey((k) => k + 1);
      }
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  return (
    <div className="w-full h-full bg-[var(--color-bg-primary)] rounded-2xl shadow-[var(--shadow-lg)] border border-[var(--color-border)] flex flex-col select-none overflow-hidden">
      <Header loading={loading} onRefresh={refreshAll} onSettings={onOpenSettings} />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <div className="mx-4 mt-3 text-xs bg-red-50 text-[var(--color-danger)] rounded-[var(--radius-md)] p-2.5 border border-red-100">
            {error}
          </div>
        )}

        {!accounts.length && !error && (
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <div className="w-12 h-12 rounded-full bg-[var(--color-bg-secondary)] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">暂无账号</p>
            <button
              onClick={onOpenSettings}
              className="text-[11px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-[var(--transition-fast)]"
            >
              添加账号 →
            </button>
          </div>
        )}

        {accounts.length > 0 && (
          <>
            <AccountSelector
              accounts={accounts}
              selected={selectedAccount}
              onSelect={setSelectedAccount}
              quota={quota}
            />

            <div className="mx-4 border-t border-[var(--color-border-subtle)]" />

            {quota && <QuotaSection limits={quota.limits} />}

            <div className="mx-4 border-t border-[var(--color-border-subtle)]" />

            {selectedAccount && (
              <div className="px-4 py-3">
                <UsageSummary key={summaryKey} accountId={selectedAccount} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Popover;
