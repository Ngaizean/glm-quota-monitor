import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { Section } from "../../components/ui/Surface";
import { Toggle } from "../../components/ui/Toggle";
import { formatRelative } from "./formatters";
import type { CodexController } from "./useCodexController";

interface CloudSyncSectionProps {
  controller: CodexController;
}

export function CloudSyncSection({ controller }: CloudSyncSectionProps) {
  const { t } = useTranslation();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const owner = controller.role === "owner";
  const disabled = controller.initializing;
  const actionLoading = owner ? controller.uploading : controller.syncing;
  const actionDisabled = disabled
    || actionLoading
    || controller.githubTokenLoading
    || controller.githubTokenSaving
    || !controller.gistUrl
    || (owner && !controller.githubTokenConfigured);
  const timestamp = owner ? controller.syncInfo?.last_upload : controller.syncInfo?.last_sync;

  useEffect(() => {
    if (advancedOpen && owner) void controller.loadGithubToken();
    else controller.clearGithubToken();
    return controller.clearGithubToken;
  }, [advancedOpen, controller.clearGithubToken, controller.loadGithubToken, owner]);

  return (
    <Section title={t("codexPane.cloudSectionTitle")} description={t("codexPane.cloudSectionDesc")}>
      <div className="space-y-5">
        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] p-4">
          <div className="mb-3 flex items-center justify-between gap-4 text-xs">
            <span className="text-[var(--color-text-tertiary)]">
              {owner ? t("codexPane.lastUpload") : t("codexPane.lastSync")}
            </span>
            <span className="text-[var(--color-text-secondary)]">
              {timestamp ? formatRelative(timestamp, (key, options) => t(key, options)) : t("codexPane.never")}
            </span>
          </div>
          <Button
            variant="primary"
            fullWidth
            loading={actionLoading}
            loadingLabel={owner ? t("codexPane.uploading") : t("codexPane.syncing")}
            disabled={actionDisabled}
            onClick={() => { void (owner ? controller.uploadAuth() : controller.syncAuth()); }}
          >
            {owner ? t("codexPane.uploadAuth") : t("codexPane.syncAuth")}
          </Button>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-tertiary)]">
            {owner ? t("codexPane.uploadDesc") : t("codexPane.syncDesc")}
          </p>
        </div>

        <div className="flex items-start justify-between gap-5">
          <div>
            <div className="text-sm font-medium text-[var(--color-text-primary)]">
              {owner ? t("codexPane.autoUpload") : t("codexPane.autoSync")}
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {owner ? t("codexPane.autoUploadDesc") : t("codexPane.autoSyncDesc")}
            </p>
          </div>
          <Toggle
            checked={owner ? controller.autoUpload : controller.autoSync}
            disabled={disabled || (owner ? controller.autoUploadSaving : controller.autoSyncSaving)}
            aria-label={owner ? t("codexPane.autoUpload") : t("codexPane.autoSync")}
            onCheckedChange={(checked) => {
              void (owner ? controller.toggleAutoUpload(checked) : controller.toggleAutoSync(checked));
            }}
          />
        </div>

        <div className="border-t border-[var(--color-border-subtle)] pt-4">
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={advancedOpen}
            disabled={disabled}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            {advancedOpen ? t("codexPane.hideAdvanced") : t("codexPane.showAdvanced")}
          </Button>
          {advancedOpen && (
            <div className="mt-4 grid gap-4">
              <TextField
                label={t("codexPane.gistUrlLabel")}
                placeholder={t("codexPane.gistUrlPlaceholder")}
                value={controller.gistUrl}
                disabled={disabled}
                onChange={(event) => controller.setGistUrl(event.target.value)}
                onBlur={() => { void controller.saveConnectionSetting("set_codex_gist_url", { url: controller.gistUrl }); }}
              />
              {owner && (
                <div className="space-y-2">
                  <TextField
                    label={t("codexPane.githubTokenLabel")}
                    type={showToken ? "text" : "password"}
                    autoComplete="off"
                    placeholder={controller.githubTokenConfigured ? "••••••••" : t("codexPane.githubTokenPlaceholder")}
                    value={controller.githubToken}
                    disabled={disabled || controller.githubTokenLoading || controller.githubTokenSaving}
                    className="font-mono"
                    onChange={(event) => controller.setGithubToken(event.target.value)}
                    onBlur={() => { void controller.saveGithubToken(); }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={controller.githubTokenLoading || controller.githubTokenSaving}
                    onClick={() => setShowToken((shown) => !shown)}
                  >
                    {showToken ? t("codexPane.hide") : t("codexPane.show")}
                  </Button>
                </div>
              )}
              <TextField
                label={t("codexPane.proxyLabel")}
                description={t("codexPane.proxyDesc")}
                placeholder={t("codexPane.proxyPlaceholder")}
                value={controller.proxyUrl}
                disabled={disabled}
                onChange={(event) => controller.setProxyUrl(event.target.value)}
                onBlur={() => { void controller.saveConnectionSetting("set_codex_proxy", { url: controller.proxyUrl }); }}
              />
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
