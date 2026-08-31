import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { Section } from "../../components/ui/Surface";
import type { CodexController } from "./useCodexController";

export function RuntimeProfileSection({ controller }: { controller: CodexController }) {
  const { t } = useTranslation();
  const [officialAccountId, setOfficialAccountId] = useState("");
  const disabled = controller.initializing || Boolean(controller.runtimeBusy);
  const active = controller.runtimeConfig?.active_mode ?? "official";

  return (
    <Section
      title={t("codexPane.runtimeTitle")}
      description={t("codexPane.runtimeDesc")}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-[var(--color-text-primary)]">
              {t("codexPane.activeRuntime")}
            </div>
            <div className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              {active === "relay" ? t("codexPane.relay") : t("codexPane.official")}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={controller.runtimeBusy === "login"}
            disabled={disabled}
            onClick={() => { void controller.loginOfficial(); }}
          >
            {t("codexPane.officialLogin")}
          </Button>
        </div>

        <div className="grid gap-3 border-t border-[var(--color-border-subtle)] pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <span>{t("codexPane.officialAccount")}</span>
            <select
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              value={officialAccountId}
              disabled={disabled}
              onChange={(event) => setOfficialAccountId(event.target.value)}
            >
              <option value="">{t("codexPane.currentOfficialAuth")}</option>
              {controller.officialAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.alias}</option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant={active === "official" ? "secondary" : "primary"}
            loading={controller.runtimeBusy === "switch-official"}
            disabled={disabled}
            onClick={() => { void controller.switchRuntime("official", officialAccountId || null); }}
          >
            {t("codexPane.switchOfficial")}
          </Button>
        </div>

        <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-4">
          <label className="block space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <span>{t("codexPane.relayUrl")}</span>
            <input
              aria-label={t("codexPane.relayUrl")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              value={controller.relayBaseUrl}
              disabled={disabled}
              onChange={(event) => controller.setRelayBaseUrl(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <span>{t("codexPane.relayModel")}</span>
            <input
              aria-label={t("codexPane.relayModel")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
              value={controller.relayModel}
              disabled={disabled}
              onChange={(event) => controller.setRelayModel(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-xs text-[var(--color-text-secondary)]">
            <span>{t("codexPane.relayKey")}</span>
            <input
              type={controller.relayKeyLoaded ? "text" : "password"}
              aria-label={t("codexPane.relayKey")}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]"
              value={controller.relayApiKey}
              placeholder={controller.runtimeConfig?.relay_key_configured ? "••••••••" : "sk-..."}
              disabled={disabled}
              onChange={(event) => controller.setRelayApiKey(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { void controller.revealRelayKey(); }}>
              {t("codexPane.showRelayKey")}
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => { void controller.copyRelayKey(); }}>
              {t("codexPane.copyRelayKey")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={controller.runtimeBusy === "save-relay"}
              disabled={disabled || !controller.relayBaseUrl.trim() || !controller.relayModel.trim()}
              onClick={() => { void controller.saveRelayConfig(); }}
            >
              {t("codexPane.saveRelay")}
            </Button>
            <Button
              size="sm"
              variant={active === "relay" ? "secondary" : "primary"}
              loading={controller.runtimeBusy === "switch-relay"}
              disabled={disabled || !controller.runtimeConfig?.relay_key_configured}
              onClick={() => { void controller.switchRuntime("relay"); }}
            >
              {t("codexPane.switchRelay")}
            </Button>
          </div>
        </div>

        <StatusNotice tone="info">{t("codexPane.threadAffinity")}</StatusNotice>
      </div>
    </Section>
  );
}
