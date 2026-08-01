import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeepSeekBalanceView } from "../types";

function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case "CNY":
    case "RMB":
      return "¥";
    case "USD":
      return "$";
    default:
      return "";
  }
}

function formatMoney(v: number): string {
  return v.toFixed(2);
}

/**
 * DeepSeek 余额富展示（展开卡内）。
 *
 * 实时拉取 get_deepseek_balance —— 返回多币种余额（total / granted 赠送 / topped-up 充值）、
 * 可用状态、错误。is_available=false 显红色不可用徽章；离线时显末次缓存 + 错误条。
 * 不复用 QuotaBar（百分比），DeepSeek 是绝对货币本位。
 */
export default function DeepSeekBalanceBar({
  accountId,
  refreshKey,
}: {
  accountId: string;
  refreshKey: number;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<DeepSeekBalanceView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<DeepSeekBalanceView>("get_deepseek_balance", { accountId })
      .then(setView)
      .catch(() => setView(null))
      .finally(() => setLoading(false));
  }, [accountId, refreshKey]);

  if (loading) {
    return (
      <div className="px-3 py-2.5">
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("common.loading")}</div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="px-3 py-2.5">
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("deepseekPane.noData")}</div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          {t("deepseekPane.balanceTitle")}
        </span>
        {!view.isAvailable && !view.isOffline && (
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[var(--color-danger)]/15 text-[var(--color-danger)]">
            {t("deepseekPane.availableFalse")}
          </span>
        )}
        {view.isOffline && (
          <span className="text-[9px] font-medium text-[var(--color-text-tertiary)]">
            {t("account.offlineData")}
          </span>
        )}
      </div>

      {view.error && (
        <div className="text-[10px] text-[var(--color-danger)] flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[var(--color-danger)]/5 border border-[var(--color-danger)]/20">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {view.error}
        </div>
      )}

      {view.balances.length === 0 && !view.error && (
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("deepseekPane.noData")}</div>
      )}

      {view.balances.map((b, i) => (
        <div
          key={`${b.currency}-${i}`}
          className="rounded-lg bg-[var(--color-bg-tertiary)]/50 border border-[var(--color-border-subtle)] px-2.5 py-1.5"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-[15px] font-bold text-emerald-500 tabular-nums">
              {currencySymbol(b.currency)}
              {formatMoney(b.total)}
            </span>
            <span className="text-[9px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
              {b.currency || "CNY"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[9px] text-[var(--color-text-tertiary)]">
              {t("deepseekPane.grantedLabel")} {currencySymbol(b.currency)}
              {formatMoney(b.granted)}
            </span>
            <span className="text-[9px] text-[var(--color-text-tertiary)]">
              {t("deepseekPane.toppedUpLabel")} {currencySymbol(b.currency)}
              {formatMoney(b.toppedUp)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
