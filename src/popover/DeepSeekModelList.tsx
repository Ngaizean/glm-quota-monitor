import { invoke } from "@tauri-apps/api/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsyncResource } from "../hooks/useAsyncResource";

interface ModelEntry {
  id: string;
  object: string;
  owned_by: string;
}
interface ModelsResponse {
  object: string;
  data: ModelEntry[];
}

/**
 * DeepSeek 可用模型列表（展开卡内）。
 *
 * 折叠态仅显标题；展开时实时 invoke get_deepseek_models（OpenAI 兼容 /models）。
 * 独立于 BalanceBar 的 get_deepseek_balance —— 模型列表低频变动，单独拉取便于手动刷新。
 */
export default function DeepSeekModelList({
  accountId,
  refreshKey,
}: {
  accountId: string;
  refreshKey: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const resource = useAsyncResource(async () => {
    const response = await invoke<ModelsResponse>("get_deepseek_models", { accountId });
    return [...new Set((response.data ?? []).map((model) => model.id.trim()).filter(Boolean))];
  }, [open, accountId, refreshKey], { enabled: open && Boolean(accountId), clearOnLoad: true });
  const models = resource.data ?? [];

  return (
    <div className="px-3 pb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t("deepseekPane.modelsTitle")}
          {open && models.length > 0 && (
            <span className="ml-1 text-[var(--color-text-tertiary)]">({models.length})</span>
          )}
        </span>
        <span className="text-[11px] text-[var(--color-text-tertiary)]">
          {resource.loading ? t("deepseekPane.loading") : open ? t("accountsPane.collapse") : t("common.confirm")}
        </span>
      </button>
      {open && (
        <div id={listId} className="flex flex-wrap gap-1 mt-1.5">
          {resource.loading && (
            <span role="status" aria-live="polite" className="text-[11px] text-[var(--color-text-tertiary)]">{t("deepseekPane.loading")}</span>
          )}
          {resource.error && (
            <span role="status" className="text-[11px] text-[var(--color-danger)]">{t("common.error")}</span>
          )}
          {!resource.loading && !resource.error && models.length === 0 && (
            <span className="text-[11px] text-[var(--color-text-tertiary)]">{t("accountsPane.noModels")}</span>
          )}
          {!resource.loading && !resource.error &&
            models.map((m) => (
              <span
                key={m}
                className="text-xs px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] font-mono"
              >
                {m}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
