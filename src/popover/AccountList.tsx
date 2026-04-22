import { getAvatarGradient, getLevelStyle } from "../lib/ui";
import QuotaSection from "./QuotaSection";
import UsageSummary from "./UsageSummary";
import type { Account, QuotaData } from "../types";

function formatLastActive(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  accounts: Account[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSetPrimary: (id: string) => void;
  quotas: Record<string, QuotaData>;
  loading: boolean;
}

function getTokenPct(quota: QuotaData | undefined): number | null {
  if (!quota) return null;
  const tokenLimit = quota.limits.find((l) => l.type === "TOKENS_LIMIT");
  return tokenLimit ? tokenLimit.percentage : null;
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const color =
    pct > 85 ? "text-red-500" : pct > 60 ? "text-amber-500" : "text-emerald-500";
  return (
    <span className={`text-[12px] font-bold tabular-nums ${color}`}>
      {Math.round(pct)}%
    </span>
  );
}

function StarButton({ isPrimary, onClick }: { isPrimary: boolean; onClick: () => void }) {
  if (isPrimary) {
    return (
      <svg className="w-3.5 h-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    );
  }
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="p-0.5 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-amber-400 transition-[var(--transition-fast)] shrink-0"
      title="设为主账号"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-tertiary)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function AccountList({ accounts, expandedIds, onToggle, onSetPrimary, quotas, loading }: Props) {
  return (
    <div className="p-2 space-y-1.5">
      {accounts.map((acc) => {
        const expanded = expandedIds.has(acc.id);
        const quota = quotas[acc.id];
        const tokenPct = getTokenPct(quota);

        return (
          <div
            key={acc.id}
            className={`rounded-xl border transition-all duration-200 overflow-hidden ${
              expanded
                ? "bg-[var(--color-bg-secondary)] border-[var(--color-border)]"
                : "bg-[var(--color-bg-secondary)]/60 border-[var(--color-border-subtle)] hover:border-[var(--color-border)]"
            }`}
          >
            <button
              onClick={() => onToggle(acc.id)}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
            >
              <div
                className={`w-6 h-6 rounded-md bg-gradient-to-br ${getAvatarGradient(
                  acc.alias
                )} flex items-center justify-center text-[9px] font-bold text-white shrink-0 shadow-sm`}
              >
                {acc.alias.charAt(0).toUpperCase()}
              </div>
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[12px] font-semibold text-[var(--color-text-primary)] truncate">
                  {acc.alias}
                </span>
                {quota?.level && (
                  <span
                    className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wider shrink-0 ${getLevelStyle(
                      quota.level
                    )}`}
                  >
                    {quota.level}
                  </span>
                )}
              </div>
              {loading && !expanded && (
                <div className="w-3 h-3 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin shrink-0" />
              )}
              <StarButton isPrimary={acc.is_primary} onClick={() => onSetPrimary(acc.id)} />
              <PctBadge pct={tokenPct} />
              <ChevronIcon open={expanded} />
            </button>

            <div
              className={`transition-all duration-200 ease-in-out ${
                expanded ? "max-h-[1000px] opacity-100" : "max-h-0 opacity-0"
              } overflow-hidden`}
            >
              {acc.purpose && (
                <div className="px-3 pb-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {acc.purpose}
                  </span>
                  {formatLastActive(quota?.last_active) && (
                    <span className="text-[10px] text-[var(--color-text-tertiary)]">
                      上次活跃 {formatLastActive(quota?.last_active)}
                    </span>
                  )}
                </div>
              )}
              <div className="mx-3 border-t border-[var(--color-border-subtle)]" />
              {quota && <QuotaSection limits={quota.limits} />}
              <div className="mx-3 border-t border-[var(--color-border-subtle)]" />
              <div className="px-3 py-2.5">
                <UsageSummary accountId={acc.id} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
