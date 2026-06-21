import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolUsageData, ToolUsageItem } from "../types";

export default function ToolUsageSection({ accountId, refreshKey }: { accountId: string; refreshKey: number }) {
  const { t } = useTranslation();
  const [data, setData] = useState<ToolUsageItem[]>([]);
  const [loading, setLoading] = useState(true);

  function formatToolName(tool: string): string {
    const key = `toolUsage.tools.${tool}`;
    const translated = t(key);
    // 未命中翻译键时回退到通用格式（i18next 在缺失时返回 key 本身）
    return translated === key ? `🔧 ${tool}` : translated;
  }

  useEffect(() => {
    setLoading(true);
    invoke<ToolUsageData>("get_tool_usage", { accountId })
      .then((res) => setData(res.toolUsage || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [accountId, refreshKey]);

  if (loading) {
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          {t("toolUsage.title")}
        </span>
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("toolUsage.loading")}</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="space-y-1.5">
        <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
          {t("toolUsage.title")}
        </span>
        <div className="text-[10px] text-[var(--color-text-tertiary)]">{t("toolUsage.noData")}</div>
      </div>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
        {t("toolUsage.title")}
      </span>
      <div className="space-y-1">
        {data.map((item) => (
          <div key={item.tool} className="flex items-center gap-2">
            <span className="text-[9px] text-[var(--color-text-tertiary)] w-24 truncate">
              {formatToolName(item.tool)}
            </span>
            <div className="flex-1 h-1.5 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-500"
                style={{ width: `${(item.count / maxCount) * 100}%` }}
              />
            </div>
            <span className="text-[9px] font-mono text-[var(--color-text-secondary)] tabular-nums w-12 text-right">
              {item.count >= 1000 ? `${(item.count / 1000).toFixed(1)}k` : item.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
