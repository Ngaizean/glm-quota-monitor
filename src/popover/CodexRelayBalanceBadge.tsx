import { formatCompactNumber } from "../lib/formatters";
import type { QuotaData } from "../types";
import { useTranslation } from "react-i18next";

export default function CodexRelayBalanceBadge({ quota }: { quota: QuotaData | undefined }) {
  const { t } = useTranslation();
  const balance = quota?.limits.find((limit) => limit.type === "RELAY_BALANCE")?.currentValue;
  if (balance === undefined || balance === null) return null;

  return (
    <span className="flex items-baseline gap-0.5 shrink-0 tabular-nums" title={t("relayUsage.balance")}>
      <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">C</span>
      <span className={`text-[12px] font-bold ${quota?.is_offline ? "text-[var(--color-text-tertiary)]" : "text-emerald-500"}`}>
        {formatCompactNumber(balance)}
      </span>
    </span>
  );
}
