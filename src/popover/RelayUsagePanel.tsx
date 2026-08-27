import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { PREVIEW_RELAY_USAGE } from "../dev/previewData";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatCurrency, resolveDisplayLocale } from "../lib/formatters";
import { isPreviewMode } from "../lib/runtime";
import type { RelayUsageBucket, RelayUsageView } from "../types";

function UsageMetrics({ bucket }: { bucket: RelayUsageBucket }) {
  const { t, i18n } = useTranslation();
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div><div className="text-[10px] text-[var(--color-text-tertiary)]">{t("relayUsage.cost")}</div><div className="text-xs font-semibold tabular-nums">{number.format(bucket.cost)}</div></div>
      <div><div className="text-[10px] text-[var(--color-text-tertiary)]">{t("relayUsage.tokens")}</div><div className="text-xs font-semibold tabular-nums">{number.format(bucket.totalTokens)}</div></div>
      <div><div className="text-[10px] text-[var(--color-text-tertiary)]">{t("relayUsage.requests")}</div><div className="text-xs font-semibold tabular-nums">{number.format(bucket.requests)}</div></div>
    </div>
  );
}

export default function RelayUsagePanel({ refreshKey }: { refreshKey: number }) {
  const { t, i18n } = useTranslation();
  const resource = useAsyncResource(
    () => isPreviewMode()
      ? Promise.resolve(PREVIEW_RELAY_USAGE)
      : invoke<RelayUsageView>("get_relay_usage"),
    [refreshKey],
    { clearOnLoad: true },
  );
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);

  if (resource.loading) return <div className="px-4 py-3 text-[11px] text-[var(--color-text-tertiary)]">{t("common.loading")}</div>;
  if (resource.error || !resource.data) return <div role="status" className="px-4 py-3 text-[11px] text-[var(--color-danger)]">{resource.error?.message || t("relayUsage.noData")}</div>;

  const usage = resource.data;
  return (
    <div className="px-4 py-3 space-y-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{t("relayUsage.balance")}</span>
        <span className="text-[16px] font-bold text-emerald-500 tabular-nums">{formatCurrency(usage.remaining, usage.unit, locale)}</span>
      </div>
      {!usage.isValid && <div role="status" className="text-[11px] text-[var(--color-danger)]">{t("relayUsage.invalid")}</div>}
      <div className="space-y-1.5"><div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{t("relayUsage.today")}</div><UsageMetrics bucket={usage.today} /></div>
      <div className="space-y-1.5"><div className="text-[11px] font-medium text-[var(--color-text-secondary)]">{t("relayUsage.total")}</div><UsageMetrics bucket={usage.total} /></div>
    </div>
  );
}
