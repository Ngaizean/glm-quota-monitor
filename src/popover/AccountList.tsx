import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { formatRelativeTime, resolveDisplayLocale } from "../lib/formatters";
import { getQuotaSummary } from "../lib/quota";
import { getAvatarGradient, getLevelStyle, formatPlanLevel } from "../lib/ui";
import type { Account, QuotaData } from "../types";
import CostBar from "./CostBar";
import DeepSeekBalanceBadge from "./DeepSeekBalanceBadge";
import DeepSeekBalanceBar from "./DeepSeekBalanceBar";
import DeepSeekModelList from "./DeepSeekModelList";
import QuotaSection from "./QuotaSection";
import ToolUsageSection from "./ToolUsageSection";
import UsageSummary from "./UsageSummary";

const TrendChart = lazy(() => import("./TrendChart"));
const DeepSeekBalanceChart = lazy(() => import("./DeepSeekBalanceChart"));

interface Props {
  accounts: Account[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  onSetPrimary: (id: string) => void;
  quotas: Record<string, QuotaData>;
  loading: boolean;
  refreshKey: number;
}

type DetailTab = "overview" | "trend" | "cost" | "tools";

function QuotaSummaryBadge({ quota }: { quota: QuotaData | undefined }) {
  if (!quota) return null;
  const summary = getQuotaSummary(quota.limits);
  const values = [summary.primary, summary.secondary].filter(Boolean);
  if (values.length === 0) return null;
  return (
    <span className="account-row__quota" data-status={summary.status}>
      {values.map((limit, index) => (
        <span key={`${limit?.type}-${limit?.unit}-${index}`}>{Math.round(limit?.percentage ?? 0)}%</span>
      ))}
    </span>
  );
}

function AccountDetails({ account, quota, refreshKey }: {
  account: Account;
  quota: QuotaData | undefined;
  refreshKey: number;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<DetailTab>("overview");
  const platform = account.platform ?? "zhipu";
  const options = platform === "zhipu"
    ? [
        { value: "overview" as const, label: t("account.tabs.overview") },
        { value: "trend" as const, label: t("account.tabs.trend") },
        { value: "cost" as const, label: t("account.tabs.cost") },
        { value: "tools" as const, label: t("account.tabs.tools") },
      ]
    : [
        { value: "overview" as const, label: t("account.tabs.overview") },
        { value: "trend" as const, label: t("account.tabs.trend") },
      ];

  return (
    <div className="account-details">
      <div className="account-details__meta">
        <span>{account.purpose}</span>
        {quota?.last_active && (
          <span>{t("account.lastActive")} {formatRelativeTime(quota.last_active, { locale: resolveDisplayLocale(i18n.language) })}</span>
        )}
      </div>

      {quota?.error && platform !== "deepseek" && (
        <div className="status-inline status-inline--critical" role="status">{quota.error}</div>
      )}

      <SegmentedControl
        aria-label={t("account.detailTabs")}
        value={tab}
        options={options}
        onValueChange={setTab}
      />

      <div className="account-details__panel" role="tabpanel">
        {tab === "overview" && platform === "deepseek" && (
          <>
            <DeepSeekBalanceBar accountId={account.id} refreshKey={refreshKey} />
            <DeepSeekModelList accountId={account.id} refreshKey={refreshKey} />
          </>
        )}
        {tab === "overview" && platform !== "deepseek" && (
          <>
            {quota && <QuotaSection limits={quota.limits} isOffline={quota.is_offline} />}
            {platform !== "codex" && (
              <UsageSummary
                accountId={account.id}
                tokenPct={getQuotaSummary(quota?.limits ?? []).primary?.percentage ?? null}
                refreshKey={refreshKey}
              />
            )}
          </>
        )}
        {tab === "trend" && (
          <Suspense fallback={<div className="skeleton h-36 rounded-xl" />}>
            {platform === "deepseek"
              ? <DeepSeekBalanceChart accountId={account.id} refreshKey={refreshKey} />
              : <TrendChart accountId={account.id} refreshKey={refreshKey} />}
          </Suspense>
        )}
        {tab === "cost" && platform === "zhipu" && <CostBar accountId={account.id} refreshKey={refreshKey} />}
        {tab === "tools" && platform === "zhipu" && <ToolUsageSection accountId={account.id} refreshKey={refreshKey} />}
      </div>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" className={open ? "rotate-180" : ""}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function AccountList({
  accounts,
  expandedIds,
  onToggle,
  onSetPrimary,
  quotas,
  loading,
  refreshKey,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="account-list">
      {accounts.map((account) => {
        const expanded = expandedIds.has(account.id);
        const quota = quotas[account.id];
        const detailId = `account-details-${account.id}`;
        return (
          <article className="account-card" data-expanded={expanded || undefined} key={account.id}>
            <div className="account-row">
              <button
                type="button"
                className="account-row__toggle"
                onClick={() => onToggle(account.id)}
                aria-expanded={expanded}
                aria-controls={detailId}
              >
                <span className={`account-avatar bg-gradient-to-br ${getAvatarGradient(account.alias)}`} aria-hidden="true">
                  {account.alias.charAt(0).toUpperCase()}
                </span>
                <span className="account-row__identity">
                  <span className="account-row__name" title={account.alias}>{account.alias}</span>
                  {quota?.level && <span className={`plan-badge ${getLevelStyle(quota.level)}`}>{formatPlanLevel(quota.level)}</span>}
                </span>
                {loading && !quota && <span className="ui-spinner" aria-label={t("common.loading")} />}
                {account.platform === "deepseek"
                  ? <DeepSeekBalanceBadge quota={quota} />
                  : <QuotaSummaryBadge quota={quota} />}
                <span className="account-row__chevron"><ChevronIcon open={expanded} /></span>
              </button>
              <button
                type="button"
                className="account-row__favorite"
                onClick={() => onSetPrimary(account.id)}
                aria-label={account.is_primary ? t("account.unsetPrimary") : t("account.setPrimary")}
                aria-pressed={account.is_primary}
              >
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill={account.is_primary ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </button>
            </div>
            {expanded && (
              <div id={detailId} className="animate-fade-in">
                <AccountDetails account={account} quota={quota} refreshKey={refreshKey} />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
