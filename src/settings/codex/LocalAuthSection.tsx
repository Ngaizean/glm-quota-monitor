import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { Section } from "../../components/ui/Surface";
import { StatusNotice } from "../../components/ui/StatusNotice";
import type { CodexController } from "./useCodexController";
import { formatExpiry } from "./formatters";

interface LocalAuthSectionProps {
  controller: CodexController;
}

export function LocalAuthSection({ controller }: LocalAuthSectionProps) {
  const { t } = useTranslation();
  const expired = controller.authSummary?.access_token_exp
    ? new Date(controller.authSummary.access_token_exp).getTime() < Date.now()
    : false;
  const disabled = controller.initializing;
  const roleDisabled = disabled || controller.roleSaving;

  return (
    <Section
      title={t("codexPane.localSectionTitle")}
      description={t("codexPane.localSectionDesc")}
      action={(
        <Button
          size="sm"
          variant="ghost"
          loading={controller.refreshing}
          loadingLabel={t("codexPane.refreshing")}
          disabled={disabled}
          onClick={() => { void controller.refreshAuth(); }}
        >
          {t("codexPane.refresh")}
        </Button>
      )}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            {t("codexPane.role")}
          </span>
          <SegmentedControl
            value={controller.role}
            aria-label={t("codexPane.role")}
            options={[
              { value: "owner", label: t("codexPane.roleOwner"), disabled: roleDisabled },
              { value: "consumer", label: t("codexPane.roleConsumer"), disabled: roleDisabled },
            ]}
            onValueChange={(value) => { void controller.setRole(value); }}
          />
          <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
            {controller.role === "owner"
              ? t("codexPane.roleOwnerDesc")
              : t("codexPane.roleConsumerDesc")}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] p-4">
          <div className="mb-3 text-xs font-semibold text-[var(--color-text-primary)]">
            {t("codexPane.localAuthStatus")}
          </div>
          {controller.authSummary?.exists ? (
            <div className="space-y-3">
              <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-xs">
                <dt className="text-[var(--color-text-tertiary)]">{t("codexPane.accountId")}</dt>
                <dd className="max-w-48 truncate font-mono text-[var(--color-text-secondary)]">
                  {controller.authSummary.account_id
                    ? `…${controller.authSummary.account_id.slice(-8)}`
                    : "—"}
                </dd>
                <dt className="text-[var(--color-text-tertiary)]">{t("codexPane.tokenExpiry")}</dt>
                <dd className={expired ? "font-medium text-[var(--color-danger)]" : "font-medium text-[var(--color-success)]"}>
                  {formatExpiry(controller.authSummary.access_token_exp, (key, options) => t(key, options))}
                </dd>
              </dl>
              {expired && <StatusNotice tone="danger">{t("codexPane.tokenExpiredWarn")}</StatusNotice>}
            </div>
          ) : (
            <p className="text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t("codexPane.noLocalAuth")}
            </p>
          )}
        </div>
      </div>
    </Section>
  );
}
