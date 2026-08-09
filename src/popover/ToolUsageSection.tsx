import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatCompactNumber, resolveDisplayLocale } from "../lib/formatters";
import type { ToolUsageData, ToolUsageItem } from "../types";

export default function ToolUsageSection({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const { t, i18n } = useTranslation();
  const resource = useAsyncResource(
    async () => {
      const response = await invoke<ToolUsageData>("get_tool_usage", { accountId });
      return response.toolUsage ?? [];
    },
    [accountId, refreshKey],
    { enabled: Boolean(accountId), clearOnLoad: true },
  );
  const data: ToolUsageItem[] = resource.data ?? [];
  const locale = resolveDisplayLocale(i18n.resolvedLanguage ?? i18n.language);

  function formatToolName(tool: string): string {
    const key = `toolUsage.tools.${tool}`;
    const translated = t(key);
    // 未命中翻译键时回退到通用格式（i18next 在缺失时返回 key 本身）
    return translated === key ? `🔧 ${tool}` : translated;
  }

  if (resource.loading) {
    return (
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t("toolUsage.title")}
        </span>
        <div role="status" aria-live="polite" className="text-[11px] text-[var(--color-text-tertiary)]">{t("toolUsage.loading")}</div>
      </div>
    );
  }

  if (resource.error) {
    return (
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">{t("toolUsage.title")}</span>
        <div role="status" className="text-[11px] text-[var(--color-danger)]">{t("common.error")}</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="space-y-1.5">
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t("toolUsage.title")}
        </span>
        <div className="text-[11px] text-[var(--color-text-tertiary)]">{t("toolUsage.noData")}</div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-[var(--color-text-secondary)]">
        {t("toolUsage.title")}
      </span>
      <div className="space-y-1">
        {data.map((item) => (
          <div key={item.tool} className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--color-text-tertiary)] w-24 truncate">
              {formatToolName(item.tool)}
            </span>
            <div
              className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden"
              role="progressbar"
              aria-label={formatToolName(item.tool)}
              aria-valuemin={0}
              aria-valuemax={maxCount}
              aria-valuenow={Math.max(item.count, 0)}
            >
              <div
                className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-500"
                style={{ width: `${(Math.max(item.count, 0) / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-[11px] font-mono text-[var(--color-text-secondary)] tabular-nums w-12 text-right">
              {formatCompactNumber(item.count, locale)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
