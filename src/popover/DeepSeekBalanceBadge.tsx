import { useTranslation } from "react-i18next";
import type { QuotaData } from "../types";
import { formatCompactNumber } from "../lib/formatters";

/**
 * DeepSeek 行首徽标（替代 PctBadge）。
 *
 * 从 refresh_all 写入的 quota.limits 里取 DEEPSEEK_BALANCE.current_value（绝对货币余额），
 * **不合成假百分比**。quota 缺失或无余额条目时显占位。
 * 纯组件、不发 invoke（折叠行批量渲染时零网络开销）。
 */
export default function DeepSeekBalanceBadge({ quota }: { quota: QuotaData | undefined }) {
  const { t } = useTranslation();
  if (!quota) return null;
  const balance = quota.limits.find((l) => l.type === "DEEPSEEK_BALANCE")?.currentValue;
  if (balance === undefined || balance === null) return null;
  const offline = quota.is_offline;
  return (
    <span className="flex items-baseline gap-0.5 shrink-0 tabular-nums">
      <span className="text-[11px] font-semibold text-[var(--color-text-tertiary)]">D</span>
      <span
        className={`text-[12px] font-bold ${offline ? "text-[var(--color-text-tertiary)]" : "text-emerald-500"}`}
        title={offline ? t("account.offlineData") : t("deepseekPane.balanceTitle")}
      >
        {formatCompactNumber(balance)}
      </span>
    </span>
  );
}
