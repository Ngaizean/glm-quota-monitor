import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatCurrency, resolveDisplayLocale } from "../lib/formatters";
import type { CostEstimate } from "../types";

export default function CostBar({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const { t, i18n } = useTranslation();
  const [planPriceInput, setPlanPriceInput] = useState("");
  const [unitPriceInput, setUnitPriceInput] = useState("");
  const [saveError, setSaveError] = useState<Error | null>(null);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const saveGenerationRef = useRef(0);

  const resource = useAsyncResource(async () => {
    const [estimate, unitPrice] = await Promise.all([
      invoke<CostEstimate>("get_cost_estimate", { accountId }),
      invoke<number>("get_unit_price", { accountId }),
    ]);
    return { estimate, unitPrice };
  }, [accountId, refreshKey], { enabled: Boolean(accountId), clearOnLoad: true });

  const cancelScheduledSaves = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    saveGenerationRef.current += 1;
    cancelScheduledSaves();
    setPlanPriceInput("");
    setUnitPriceInput("");
    setSaveError(null);
    return () => {
      saveGenerationRef.current += 1;
      cancelScheduledSaves();
    };
  }, [accountId, cancelScheduledSaves]);

  useEffect(() => {
    if (!resource.data) return;
    setPlanPriceInput(String(resource.data.estimate.plan_price));
    setUnitPriceInput(String(resource.data.unitPrice));
  }, [resource.data]);

  const scheduleSave = useCallback((command: string, price: number) => {
    setSaveError(null);
    const previous = timersRef.current.get(command);
    if (previous) clearTimeout(previous);

    const targetAccountId = accountId;
    const generation = saveGenerationRef.current;
    const timer = setTimeout(() => {
      timersRef.current.delete(command);
      if (generation !== saveGenerationRef.current) return;
      void invoke(command, { accountId: targetAccountId, price }).catch((reason: unknown) => {
        if (generation !== saveGenerationRef.current) return;
        setSaveError(reason instanceof Error ? reason : new Error(String(reason)));
      });
    }, 600);
    timersRef.current.set(command, timer);
  }, [accountId]);

  if (resource.loading) {
    return <div role="status" className="text-[11px] text-[var(--color-text-tertiary)]">{t("common.loading")}</div>;
  }

  if (resource.error || !resource.data) {
    return <div role="status" className="text-[11px] text-[var(--color-danger)]">{t("common.error")}</div>;
  }

  const { estimate: data } = resource.data;
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);
  const fmt = (value: number) => formatCurrency(value, "CNY", locale);
  const planPrice = planPriceInput === "" ? data.plan_price : Number(planPriceInput);
  const effectivePlanPrice = Number.isFinite(planPrice) ? Math.max(planPrice, 0) : data.plan_price;
  const ratio = effectivePlanPrice > 0 ? data.cost_30d / effectivePlanPrice : (data.cost_30d > 0 ? Infinity : 0);
  const overBudget = ratio > 1.0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t('cost.costEstimate')}
        </span>
        <span className="text-xs font-bold tabular-nums text-[var(--color-text-tertiary)]">
          {fmt(data.cost_30d)} / {fmt(effectivePlanPrice)}
          <span
            className="ml-1"
            style={{ color: overBudget ? "var(--color-danger)" : "var(--color-success)" }}
          >
            {ratio > 0 && Number.isFinite(ratio) ? `${(ratio * 100).toFixed(0)}%` : ratio === Infinity ? "∞" : "0%"}
          </span>
        </span>
      </div>

      {saveError && (
        <div role="status" className="text-[11px] text-[var(--color-danger)]">
          {t("common.error")}
        </div>
      )}

      {/* 单价说明：有明细按模型加权（免费模型归零），否则兜底 */}
      <div className="flex items-center justify-center text-[11px] text-[var(--color-text-tertiary)]">
        {data.weighted ? (
          <span style={{ color: "var(--color-success)" }}>
            {t('cost.weightedNote', { price: data.unit_price.toFixed(1), currency: t("cost.currency") })}
          </span>
        ) : (
          <span>{t('cost.fallbackNote', { price: (Number(unitPriceInput) || 0).toFixed(1), currency: t("cost.currency") })}</span>
        )}
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
            <div className="text-[11px] text-[var(--color-text-tertiary)]">{item.label}</div>
            <div className="text-xs font-bold tabular-nums text-[var(--color-text-primary)]">
              {fmt(item.value)}
            </div>
          </div>
        ))}
      </div>

      {/* 内联价格设置 */}
      <div className="grid grid-cols-2 gap-1.5">
        <div className="flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)]">
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('cost.monthly')}</span>
          <input
            type="number"
            min="0"
            aria-label={t("cost.monthly")}
            value={planPriceInput}
            placeholder="149"
            className="w-12 text-right text-xs font-bold tabular-nums text-[var(--color-accent)] bg-transparent outline-none"
            onChange={(e) => {
              const value = e.target.value;
              setPlanPriceInput(value);
              const price = Number(value);
              if (value !== "" && Number.isFinite(price) && price >= 0) scheduleSave("set_plan_price", price);
            }}
          />
        </div>
        <div
          className={`flex items-center justify-between px-2 py-1 rounded-lg bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)] ${data.weighted ? "opacity-40" : ""}`}
          title={data.weighted ? t('cost.unitPriceDisabledTip') : undefined}
        >
          <span className="text-[11px] text-[var(--color-text-tertiary)]">{t('cost.unitPrice')}</span>
          <input
            type="number"
            step="0.1"
            min="0"
            aria-label={t("cost.unitPrice")}
            value={unitPriceInput}
            placeholder="10"
            disabled={data.weighted}
            className="w-12 text-right text-xs font-bold tabular-nums text-[var(--color-accent)] bg-transparent outline-none"
            onChange={(e) => {
              const value = e.target.value;
              setUnitPriceInput(value);
              const price = Number(value);
              if (value !== "" && Number.isFinite(price) && price >= 0) scheduleSave("set_unit_price", price);
            }}
          />
        </div>
      </div>
    </div>
  );
}
