import { getAvatarGradient, getLevelStyle } from "../lib/ui";
import QuotaSection from "./QuotaSection";
import UsageSummary from "./UsageSummary";
import type { Account, QuotaData } from "../types";

interface Props {
  accounts: Account[];
  expandedId: string;
  onToggle: (id: string) => void;
  quotas: Record<string, QuotaData>;
  loading: boolean;
}

function getMaxPct(quota: QuotaData | undefined): number | null {
  if (!quota) return null;
  const pcts = quota.limits.map((l) => l.percentage).filter((p) => p > 0);
  return pcts.length > 0 ? Math.max(...pcts) : null;
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

export default function AccountList({ accounts, expandedId, onToggle, quotas, loading }: Props) {
  return (
    <div className="p-2 space-y-1.5">
      {accounts.map((acc) => {
        const expanded = expandedId === acc.id;
        const quota = quotas[acc.id];
        const maxPct = getMaxPct(quota);

        return (
          <div
            key={acc.id}
            className={`rounded-xl border transition-all duration-200 overflow-hidden ${
              expanded
                ? "bg-[var(--color-bg-secondary)] border-[var(--color-border)]"
                : "bg-[var(--color-bg-secondary)]/60 border-[var(--color-border-subtle)] hover:border-[var(--color-border)]"
            }`}
          >
            {/* 折叠头部 — 始终可见 */}
            <button
              onClick={() => onToggle(expanded ? "" : acc.id)}
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
              <PctBadge pct={maxPct} />
              <ChevronIcon open={expanded} />
            </button>

            {/* 展开内容 */}
            <div
              className={`transition-all duration-200 ease-in-out ${
                expanded ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
              } overflow-hidden`}
            >
              {acc.purpose && (
                <div className="px-3 pb-1.5">
                  <span className="text-[10px] text-[var(--color-text-tertiary)]">
                    {acc.purpose}
                  </span>
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
