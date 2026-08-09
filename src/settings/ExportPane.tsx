import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon } from "../components/icons";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { SelectField } from "../components/ui/Field";
import { StatusNotice } from "../components/ui/StatusNotice";
import type { Account } from "../types";
import SettingsSection from "./components/SettingsSection";

type ExportFormat = "csv" | "json";

function sanitizeFilename(value: string): string {
  const sanitized = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized || "account";
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
}

export default function ExportPane() {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    invoke<Account[]>("list_accounts")
      .then((items) => {
        if (disposed) return;
        setAccounts(items);
      })
      .catch(() => {
        if (!disposed) setStatus({ kind: "error", text: t("export.loadError") });
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [t]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedId) ?? null,
    [accounts, selectedId],
  );

  async function handleExport(format: ExportFormat) {
    if (!selectedAccount) return;
    setExporting(format);
    setStatus(null);
    try {
      const command = format === "csv" ? "export_usage_csv" : "export_usage_json";
      const data = await invoke<string>(command, { accountId: selectedAccount.id });
      const mimeType = format === "csv" ? "text/csv;charset=utf-8" : "application/json;charset=utf-8";
      downloadFile(
        data,
        `glm-usage-${sanitizeFilename(selectedAccount.alias)}.${format}`,
        mimeType,
      );
      setStatus({
        kind: "success",
        text: t("export.success", { account: selectedAccount.alias, format: format.toUpperCase() }),
      });
    } catch (error) {
      setStatus({ kind: "error", text: t("export.failed", { error: String(error) }) });
    } finally {
      setExporting(null);
    }
  }

  if (!loading && accounts.length === 0 && status?.kind === "error") {
    return <StatusNotice tone="danger">{status.text}</StatusNotice>;
  }

  if (!loading && accounts.length === 0) {
    return (
      <SettingsSection>
        <EmptyState
          icon={<DownloadIcon size={22} />}
          title={t("export.noAccounts")}
          description={t("export.noAccountsDesc")}
        />
      </SettingsSection>
    );
  }

  return (
    <div className="space-y-4">
      {status && (
        <StatusNotice tone={status.kind === "success" ? "success" : "danger"}>
          {status.text}
        </StatusNotice>
      )}

      <SettingsSection title={t("export.title")} description={t("export.desc")}>
        <div className="space-y-5 p-5">
          <SelectField
            label={t("export.accountLabel")}
            description={t("export.accountDesc")}
            value={selectedId}
            disabled={loading || exporting !== null}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {loading && <option value="">{t("export.loadingAccounts")}</option>}
            {!loading && <option value="">{t("export.accountLabel")}</option>}
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.alias}{account.is_primary ? ` · ${t("export.primaryAccount")}` : ""}
              </option>
            ))}
          </SelectField>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="primary"
              fullWidth
              leadingIcon={<DownloadIcon size={15} />}
              loading={exporting === "csv"}
              loadingLabel={t("export.exporting")}
              disabled={!selectedAccount || exporting !== null}
              onClick={() => void handleExport("csv")}
            >
              {t("export.exportCsv")}
            </Button>
            <Button
              fullWidth
              leadingIcon={<DownloadIcon size={15} />}
              loading={exporting === "json"}
              loadingLabel={t("export.exporting")}
              disabled={!selectedAccount || exporting !== null}
              onClick={() => void handleExport("json")}
            >
              {t("export.exportJson")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
