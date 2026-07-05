import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getAvatarGradient, getLevelStyle, getStatusLevel, statusColorVar } from "../lib/ui";
import CostBar from "./CostBar";
import QuotaSection from "./QuotaSection";
import UsageSummary from "./UsageSummary";
import ToolUsageSection from "./ToolUsageSection";
import TrendChart from "./TrendChart";
import type { Account, QuotaData } from "../types";

function formatLastActive(
  iso: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  lng: string
): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  const diff = Date.now() - date.getTime();
  if (diff < 0) return null;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('account.justNow');
  if (mins < 60) return t('account.minutesAgo', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('account.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('account.daysAgo', { count: days });
  // 按当前语言本地化日期
  const locale = lng.startsWith("en") ? "en-US" : "zh-CN";
  return date.toLocaleDateString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface Props {
  accounts: Account[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSetPrimary: (id: string) => void;
  quotas: Record<string, QuotaData>;
  loading: boolean;
  refreshKey: number;
}

function getTokenPct(quota: QuotaData | undefined): number | null {
  if (!quota) return null;
  const tokenLimit = quota.limits.find((l) => l.type === "TOKENS_LIMIT");
  return tokenLimit ? tokenLimit.percentage : null;
}

function PctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const color = statusColorVar(getStatusLevel(pct));
  return (
    <span className="text-[12px] font-bold tabular-nums" style={{ color }}>
      {Math.round(pct)}%
    </span>
  );
}

function StarButton({ isPrimary, onClick }: { isPrimary: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`p-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)] shrink-0 ${
        isPrimary ? "text-amber-400 hover:text-amber-300" : "text-[var(--color-text-tertiary)] hover:text-amber-400"
      }`}
      title={isPrimary ? t('account.unsetPrimary') : t('account.setPrimary')}
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill={isPrimary ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    </button>
  );
}

function Expandable({ open, children }: { open: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState(open ? "none" : "0px");

  // 用 ResizeObserver 测量内容真实高度，替代 render 时读 scrollHeight 的脆弱方案
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      if (open) {
        setMaxHeight(`${el.scrollHeight}px`);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  return (
    <div
      ref={ref}
      className="transition-all duration-300 ease-in-out overflow-hidden"
      style={{ maxHeight: open ? maxHeight : "0px", opacity: open ? 1 : 0 }}
    >
      {children}
    </div>
  );
}

function LastActiveLabel({ lastActive }: { lastActive: string | null }) {
  const { t } = useTranslation();
  if (!lastActive) return null;
  return (
    <span className="text-[10px] text-[var(--color-text-tertiary)]">
      {t('account.lastActive')} {lastActive}
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

export default function AccountList({ accounts, expandedIds, onToggle, onSetPrimary, quotas, loading, refreshKey }: Props) {
  const { t, i18n } = useTranslation();
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
                    className={`text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-wider shrink-0 ${getLevelStyle(
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

            <Expandable open={expanded}>
              <div className="px-3 pb-1.5 flex items-center justify-between">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">
                  {acc.purpose}
                </span>
                <LastActiveLabel lastActive={formatLastActive(quota?.last_active, t, i18n.language)} />
              </div>
              {quota?.error && (
                <div className="mx-3 mb-1.5 text-[10px] text-[var(--color-danger)] flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--color-danger)]/5 border border-[var(--color-danger)]/20">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  {quota.error}
                </div>
              )}
              {quota && <QuotaSection limits={quota.limits} isOffline={quota.is_offline} />}
              {acc.platform !== "codex" && (
                <>
                  <div className="px-3 py-2.5">
                    <UsageSummary accountId={acc.id} tokenPct={tokenPct} refreshKey={refreshKey} />
                  </div>
                  <div className="px-3 pb-3">
                    <CostBar accountId={acc.id} refreshKey={refreshKey} />
                  </div>
                  <div className="px-3 pb-3">
                    <ToolUsageSection accountId={acc.id} refreshKey={refreshKey} />
                  </div>
                </>
              )}
              <div className="px-3 pb-3">
                <TrendChart accountId={acc.id} refreshKey={refreshKey} />
              </div>
            </Expandable>
          </div>
        );
      })}
    </div>
  );
}
