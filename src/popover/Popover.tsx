import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./Header";
import AccountSelector from "./AccountSelector";
import QuotaSection from "./QuotaSection";
import UsageSummary from "./UsageSummary";
import type { Account, QuotaData } from "../types";

function Popover({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [summaryKey, setSummaryKey] = useState(0);

  // 用 ref 追踪最新值，避免 onFocusChanged 闭包捕获过期的 state
  const selectedAccountRef = useRef(selectedAccount);
  selectedAccountRef.current = selectedAccount;

  const loadAccounts = useCallback(() => {
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
  }, []);

  const fetchQuota = useCallback(async (accountId: string) => {
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
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        loadAccounts();
        const accountId = selectedAccountRef.current;
        if (accountId) {
          fetchQuota(accountId);
          setSummaryKey((k) => k + 1);
        }
      } else {
        getCurrentWindow().hide();
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadAccounts, fetchQuota]);

  useEffect(() => {
    if (accounts.length > 0 && !accounts.find((a) => a.id === selectedAccount)) {
      setSelectedAccount(accounts[0].id);
    }
  }, [accounts, selectedAccount]);

  useEffect(() => {
    if (!selectedAccount) return;
    fetchQuota(selectedAccount);
  }, [selectedAccount, fetchQuota]);

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
    <div className="w-full h-full flex flex-col select-none overflow-hidden bg-[var(--color-bg-primary)] rounded-2xl shadow-[var(--shadow-popover)]">
      <Header loading={loading} onRefresh={refreshAll} onSettings={onOpenSettings} />

      <div className="flex-1 overflow-y-auto overscroll-contain">
        {error && (
          <div className="mx-4 mt-3 text-[11px] bg-red-50 text-red-600 rounded-xl p-3 border border-red-100/80">
            {error}
          </div>
        )}

        {!accounts.length && !error && (
          <div className="flex flex-col items-center justify-center py-16 space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <line x1="12" y1="11" x2="12" y2="11.01" />
              </svg>
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs font-medium text-[var(--color-text-secondary)]">暂无账号</p>
              <p className="text-[10px] text-[var(--color-text-tertiary)]">添加 API Key 开始监控额度</p>
            </div>
            <button
              onClick={onOpenSettings}
              className="text-[11px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-[var(--transition-fast)] flex items-center gap-1"
            >
              添加账号
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
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
