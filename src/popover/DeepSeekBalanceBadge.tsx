import type { QuotaData } from "../types";

/** 货币代码 → 符号（DeepSeek 常见 CNY/USD）。未知代码原样显示。 */
function currencySymbol(_currency: string): string {
  // badge 仅显数值，货币细节在展开的 BalanceBar；统一 ¥（DeepSeek 默认 CNY）。
  return "¥";
}

/** 格式化余额：≥100 取整，否则保留 2 位小数（避免 10.50 显示成 10.5 不齐）。 */
function formatMoney(v: number): string {
  return v >= 100 ? Math.round(v).toString() : v.toFixed(2);
}

/**
 * DeepSeek 行首徽标（替代 PctBadge）。
 *
 * 从 refresh_all 写入的 quota.limits 里取 DEEPSEEK_BALANCE.current_value（绝对货币余额），
 * **不合成假百分比**。quota 缺失或无余额条目时显占位。
 * 纯组件、不发 invoke（折叠行批量渲染时零网络开销）。
 */
export default function DeepSeekBalanceBadge({ quota }: { quota: QuotaData | undefined }) {
  if (!quota) return null;
  const balance = quota.limits.find((l) => l.type === "DEEPSEEK_BALANCE")?.currentValue;
  if (balance === undefined || balance === null) return null;
  const offline = quota.is_offline;
  return (
    <span className="flex items-baseline gap-0.5 shrink-0 tabular-nums">
      <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)]">D</span>
      <span
        className={`text-[12px] font-bold ${offline ? "text-[var(--color-text-tertiary)]" : "text-emerald-500"}`}
        title={offline ? "离线数据" : "DeepSeek 余额"}
      >
        {currencySymbol("")}
        {formatMoney(balance)}
      </span>
    </span>
  );
}
