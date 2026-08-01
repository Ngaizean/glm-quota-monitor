import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    invoke<ModelsResponse>("get_deepseek_models", { accountId })
      .then((r) =>
        setModels((r.data ?? []).map((m) => m.id).filter((s) => s.length > 0))
      )
      .catch(() => setModels([]))
      .finally(() => setLoading(false));
  }, [open, accountId, refreshKey]);

  return (
    <div className="px-3 pb-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          {t("deepseekPane.modelsTitle")}
          {open && models.length > 0 && (
            <span className="ml-1 text-[var(--color-text-tertiary)]">({models.length})</span>
          )}
        </span>
        <span className="text-[10px] text-[var(--color-text-tertiary)]">
          {loading ? t("deepseekPane.loading") : open ? t("accountsPane.collapse") : t("common.confirm")}
        </span>
      </button>
      {open && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {loading && (
            <span className="text-[10px] text-[var(--color-text-tertiary)]">{t("deepseekPane.loading")}</span>
          )}
          {!loading && models.length === 0 && (
            <span className="text-[10px] text-[var(--color-text-tertiary)]">{t("accountsPane.noModels")}</span>
          )}
          {!loading &&
            models.map((m) => (
              <span
                key={m}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] font-mono"
              >
                {m}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
