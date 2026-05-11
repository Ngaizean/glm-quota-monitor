import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { Account } from "../types";

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPane() {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("");

  async function handleExport(format: "csv" | "json") {
    setExporting(true);
    setStatus("");
    try {
      const accounts = await invoke<Account[]>("list_accounts");
      if (accounts.length === 0) {
        setStatus(t("common.error") + ": no accounts");
        return;
      }
      const account = accounts.find((a) => a.is_primary) || accounts[0];
      const cmd = format === "csv" ? "export_usage_csv" : "export_usage_json";
      const data = await invoke<string>(cmd, { accountId: account.id });
      const ext = format === "csv" ? "csv" : "json";
      const mime = format === "csv" ? "text/csv" : "application/json";
      downloadFile(data, `glm-usage-${account.alias}.${ext}`, mime);
      setStatus(t("common.success") + " ✓");
    } catch (e) {
      setStatus(t("common.error") + ": " + String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <span className="text-xs font-medium text-[var(--color-text-primary)] block">
          {t("export.title")}
        </span>
        <p className="text-[10px] text-[var(--color-text-tertiary)]">
          {t("export.desc")}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="flex-1 text-[11px] font-medium px-3 py-2 bg-[var(--color-accent)] text-white rounded-lg hover:bg-[var(--color-accent-hover)] transition-[var(--transition-fast)] disabled:opacity-40"
          >
            {t("export.exportCsv")}
          </button>
          <button
            onClick={() => handleExport("json")}
            disabled={exporting}
            className="flex-1 text-[11px] font-medium px-3 py-2 bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)] transition-[var(--transition-fast)] disabled:opacity-40"
          >
            {t("export.exportJson")}
          </button>
        </div>
        {status && (
          <div className="text-[10px] text-[var(--color-text-tertiary)]">{status}</div>
        )}
      </div>
    </div>
  );
}
