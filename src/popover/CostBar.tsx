import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CostEstimate } from "../types";

function formatCost(currency: string, value: number): string {
  if (value < 0.01) return `${currency}0`;
  if (value < 100) return `${currency}${value.toFixed(1)}`;
  return `${currency}${value.toFixed(0)}`;
}

export default function CostBar({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const { t } = useTranslation();
  const [data, setData] = useState<CostEstimate | null>(null);
  const [planPrice, setPlanPrice] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedInvoke = useCallback((cmd: string, args: Record<string, unknown>) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => invoke(cmd, args), 600);
  }, []);

  useEffect(() => {
    invoke<CostEstimate>("get_cost_estimate", { accountId })
      .then((d) => { setData(d); setPlanPrice(d.plan_price); })
      .catch(() => setData(null));
    invoke<number>("get_unit_price", { accountId }).then(setUnitPrice);
  }, [accountId, refreshKey]);

  if (!data) return null;

  const currency = t("cost.currency");
  const fmt = (v: number) => formatCost(currency, v);
  const pct = data.plan_price > 0 ? Math.min((data.cost_30d / data.plan_price) * 100, 100) : 0;
  const overBudget = data.ratio > 1.0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          {t('cost.costEstimate')}
        </span>
        <span className="text-[10px] font-bold tabular-nums text-[var(--color-text-tertiary)]">
          {fmt(data.cost_30d)} / {fmt(data.plan_price)}
          <span
            className="ml-1"
            style={{ color: overBudget ? "var(--color-danger)" : "var(--color-success)" }}
          >
            {data.ratio > 0 ? `${(data.ratio * 100).toFixed(0)}%` : ""}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: t('usage.today'), value: data.today_cost },
          { label: t('usage.last7d'), value: data.cost_7d },
          { label: t('usage.last30d'), value: data.cost_30d },
        ].map((item) => (
          <div
            key={item.label}
            className="text-center py-1.5 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]"
          >
            <div className="text-[9px] text-[var(--color-text-tertiary)]">{item.label}</div>
            <div className="text-[11px] font-bold tabular-nums text-[var(--color-text-primary)]">
              {fmt(item.value)}
            </div>
          </div>
        ))}
      </div>

      {/* 月费占比进度条 */}
      <div className="space-y-1">
        <div className="relative h-1.5 rounded-full bg-[var(--color-bg-primary)] overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: overBudget ? "var(--color-danger)" : "var(--color-success)",
            }}
          />
        </div>
        <div className="flex justify-between text-[9px] text-[var(--color-text-tertiary)]">
          <span>{currency}0</span>
          <span>{fmt(data.plan_price)}{t('cost.perMonth')}</span>
        </div>
      </div>

      {/* 内联价格设置 */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]">
          <span className="text-[9px] text-[var(--color-text-tertiary)]">{t('cost.monthly')}</span>
          <input
            type="number"
            value={planPrice || ""}
            placeholder="149"
            className="w-12 text-right text-[10px] font-bold tabular-nums text-[var(--color-accent)] bg-transparent outline-none"
            onChange={(e) => {
              const v = Number(e.target.value);
              setPlanPrice(v);
              if (v > 0) {
                debouncedInvoke("set_plan_price", { accountId, price: v });
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]">
          <span className="text-[9px] text-[var(--color-text-tertiary)]">{t('cost.unitPrice')}</span>
          <input
            type="number"
            step="0.1"
            value={unitPrice || ""}
            placeholder="10"
            className="w-12 text-right text-[10px] font-bold tabular-nums text-[var(--color-accent)] bg-transparent outline-none"
            onChange={(e) => {
              const v = Number(e.target.value);
              setUnitPrice(v);
              if (v > 0) {
                debouncedInvoke("set_unit_price", { accountId, price: v });
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
