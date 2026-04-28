import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { CostEstimate } from "../types";

function formatCost(v: number): string {
  if (v < 0.01) return "¥0";
  if (v < 100) return `¥${v.toFixed(1)}`;
  return `¥${v.toFixed(0)}`;
}

export default function CostBar({ accountId }: { accountId: string }) {
  const [data, setData] = useState<CostEstimate | null>(null);
  const [planPrice, setPlanPrice] = useState(0);
  const [unitPrice, setUnitPrice] = useState(0);

  useEffect(() => {
    invoke<CostEstimate>("get_cost_estimate", { accountId })
      .then((d) => { setData(d); setPlanPrice(d.plan_price); })
      .catch(() => setData(null));
    invoke<number>("get_unit_price", { accountId }).then(setUnitPrice);
  }, [accountId]);

  if (!data) return null;

  const pct = data.plan_price > 0 ? Math.min((data.cost_30d / data.plan_price) * 100, 100) : 0;
  const overBudget = data.ratio > 1.0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          费用估算
        </span>
        <span className="text-[10px] font-bold tabular-nums text-[var(--color-text-tertiary)]">
          {formatCost(data.cost_30d)} / {formatCost(data.plan_price)}
          <span className={`ml-1 ${overBudget ? "text-[var(--color-danger)]" : "text-emerald-500"}`}>
            {data.ratio > 0 ? `${(data.ratio * 100).toFixed(0)}%` : ""}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "今日", value: data.today_cost },
          { label: "7 天", value: data.cost_7d },
          { label: "30 天", value: data.cost_30d },
        ].map((item) => (
          <div
            key={item.label}
            className="text-center py-1.5 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]"
          >
            <div className="text-[9px] text-[var(--color-text-tertiary)]">{item.label}</div>
            <div className="text-[11px] font-bold tabular-nums text-[var(--color-text-primary)]">
              {formatCost(item.value)}
            </div>
          </div>
        ))}
      </div>

      {/* 月费占比进度条 */}
      <div className="space-y-1">
        <div className="relative h-1.5 rounded-full bg-[var(--color-bg-primary)] overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              overBudget ? "bg-[var(--color-danger)]" : "bg-emerald-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-[8px] text-[var(--color-text-tertiary)]">
          <span>¥0</span>
          <span>{formatCost(data.plan_price)}/月</span>
        </div>
      </div>

      {/* 内联价格设置 */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]">
          <span className="text-[8px] text-[var(--color-text-tertiary)]">包月</span>
          <input
            type="number"
            value={planPrice || ""}
            placeholder="149"
            className="w-12 text-right text-[10px] font-bold tabular-nums text-[var(--color-accent)] bg-transparent outline-none"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) {
                setPlanPrice(v);
                invoke("set_plan_price", { accountId, price: v });
              }
            }}
          />
        </div>
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]">
          <span className="text-[8px] text-[var(--color-text-tertiary)]">单价</span>
          <input
            type="number"
            step="0.1"
            value={unitPrice || ""}
            placeholder="10"
            className="w-12 text-right text-[10px] font-bold tabular-nums text-[var(--color-accent)] bg-transparent outline-none"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) {
                setUnitPrice(v);
                invoke("set_unit_price", { accountId, price: v });
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
