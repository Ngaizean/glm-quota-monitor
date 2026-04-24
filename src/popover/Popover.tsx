import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import Header from "./Header";
import AccountList from "./AccountList";
import type { Account, QuotaData } from "../types";

interface RefreshResult {
  max_pct: number;
  quotas: Record<string, QuotaData>;
}

function Popover({ onOpenSettings, screenHeight }: { onOpenSettings: () => void; screenHeight: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [quotas, setQuotas] = useState<Record<string, QuotaData>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const isDragging = useRef(false);

  const handleDragStart = useCallback(() => {
    isDragging.current = true;
    setTimeout(() => { isDragging.current = false; }, 500);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const accountsPromise = invoke<Account[]>("list_accounts");
      const refreshPromise = invoke<RefreshResult>("refresh_all");

      const accs = await accountsPromise;
      setAccounts(accs);

      const result = await refreshPromise;
      setQuotas(result.quotas);
      setInitialized(true);
    } catch (e) {
      setError(String(e));
      setInitialized(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        isDragging.current = false;
        refreshAll();
      } else if (!isDragging.current) {
        getCurrentWindow().hide();
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshAll]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSetPrimary(id: string) {
    await invoke("set_primary_account", { id });
    refreshAll();
  }

  return (
    <div
      className="w-full flex flex-col select-none bg-[var(--color-bg-primary)] rounded-2xl shadow-[var(--shadow-popover)]"
      style={{ maxHeight: screenHeight }}
    >
      <Header loading={loading} onRefresh={refreshAll} onSettings={onOpenSettings} onDragStart={handleDragStart} />
      <div className="flex-1 min-h-0 scroll-area overscroll-contain">
        {error && (
          <div className="mx-4 mt-3 text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
            {error}
          </div>
        )}

        {!initialized && (
          <div className="px-4 py-4 space-y-3">
            <div className="skeleton h-18 rounded-2xl" />
            <div className="skeleton h-18 rounded-2xl" />
          </div>
        )}

        {initialized && !loading && !accounts.length && !error && (
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

        <AccountList
          accounts={accounts}
          expandedIds={expandedIds}
          onToggle={toggleExpand}
          onSetPrimary={handleSetPrimary}
          quotas={quotas}
          loading={loading}
        />
      </div>
    </div>
  );
}

export default Popover;
