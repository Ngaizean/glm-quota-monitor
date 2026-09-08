import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Section } from "../../components/ui/Surface";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { formatPlanLevel } from "../../lib/ui";
import { AccountProfiles } from "../distribution/AccountProfiles";
import type { AccountsController } from "./useAccountsController";

interface CodexAccountsPanelProps {
  controller: AccountsController;
}

interface ParsedAccountPreview {
  suggested_alias: string;
  email: string | null;
  plan_type: string | null;
  account_id: string;
  has_refresh_token: boolean;
  format: "sub2api" | "authjson" | "bare";
}

export function CodexAccountsPanel({ controller }: CodexAccountsPanelProps) {
  const { t } = useTranslation();
  // 粘贴 JSON 导入
  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [preview, setPreview] = useState<ParsedAccountPreview[] | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [importResults, setImportResults] = useState("");
  const [importingJson, setImportingJson] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canImportJson = useMemo(
    () => (preview?.length ?? 0) > 0,
    [preview],
  );

  async function detect() {
    setPreviewError("");
    setImportResults("");
    if (!jsonText.trim()) {
      setPreview(null);
      return;
    }
    try {
      setPreview(await controller.previewCodexJson(jsonText));
    } catch (error) {
      setPreview(null);
      setPreviewError(String(error));
    }
  }

  async function confirmJsonImport() {
    if (!canImportJson) return;
    const isSub2api = preview?.some((item) => item.format === "sub2api") ?? false;
    setImportingJson(true);
    setImportResults("");
    try {
      const results = await controller.importCodexFromJson(jsonText);
      const ok = results?.filter((r) => r.success).length ?? 0;
      const failed = results?.filter((r) => !r.success) ?? [];
      const summary = [t("codexPane.jsonImportDone", { count: ok })];
      if (failed.length > 0) {
        summary.push(t("codexPane.jsonImportFailed", { count: failed.length }) + " " + failed.map((f) => `${f.alias}: ${f.error ?? ""}`).join("; "));
      }
      // sub2api 导出格式导入成功 → 自动开启 Sub2API 管理功能（设置页出现入口）
      if (isSub2api && ok > 0) {
        try {
          await invoke("set_setting", { key: "sub2api_enabled", value: "true" });
          summary.push(t("codexPane.jsonImportEnabledSub2api"));
        } catch {
          // 开启失败不阻断导入结果展示
        }
      }
      setImportResults(summary.join("\n"));
      if (failed.length === 0) {
        setJsonOpen(false);
        setJsonText("");
        setPreview(null);
      } else {
        setPreview(null);
      }
    } catch (error) {
      setPreviewError(String(error));
    } finally {
      setImportingJson(false);
    }
  }

  return (
    <Section title={t("accountsPane.platformCodex")}>
      <div className="space-y-3">
        <AccountProfiles
          controller={controller}
          onImportJson={() => {
            setJsonOpen(true);
            setPreview(null);
            setPreviewError("");
            setImportResults("");
          }}
        />
      </div>

      <Dialog
        open={jsonOpen}
        onOpenChange={setJsonOpen}
        title={t("codexPane.pasteJsonImportTitle")}
        description={t("codexPane.pasteJsonImportHint")}
        size="lg"
        initialFocusRef={textareaRef}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setJsonOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="secondary" disabled={!jsonText.trim()} onClick={() => { void detect(); }}>
              {t("codexPane.detectJson")}
            </Button>
            <Button
              variant="primary"
              disabled={!canImportJson}
              loading={importingJson}
              loadingLabel={t("accountsPane.verifying")}
              onClick={() => { void confirmJsonImport(); }}
            >
              {t("codexPane.jsonImportConfirm", { count: preview?.length ?? 0 })}
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <textarea
            ref={textareaRef}
            className="h-48 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 font-mono text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder={t("codexPane.pasteJsonPlaceholder")}
            value={jsonText}
            onChange={(event) => {
              setJsonText(event.target.value);
              setPreview(null);
              setPreviewError("");
            }}
            spellCheck={false}
          />
          {previewError && <StatusNotice tone="danger">{previewError}</StatusNotice>}
          {importResults && <StatusNotice tone="info">{importResults}</StatusNotice>}
          {preview && preview.length > 0 && (
            <div className="space-y-1.5">
              {preview.map((item) => (
                <div
                  key={item.account_id || item.suggested_alias}
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[var(--color-text-primary)]">{item.suggested_alias}</div>
                    <div className="truncate text-[var(--color-text-tertiary)]">{item.email ?? item.account_id}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {item.plan_type && (
                      <span className="rounded-md bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                        {formatPlanLevel(item.plan_type)}
                      </span>
                    )}
                    <span className={item.has_refresh_token ? "text-emerald-500" : "text-amber-500"}>
                      {item.has_refresh_token ? t("codexPane.refreshable") : t("codexPane.noRefreshToken")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>
    </Section>
  );
}
