import { useTranslation } from "react-i18next";
import { CloseIcon, PlusIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SelectField, TextField } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { Toggle } from "../../components/ui/Toggle";
import SettingsRow from "../components/SettingsRow";
import SettingsSection from "../components/SettingsSection";
import type { SpinController } from "./useSpinController";

const LEAD_PRESETS = [30, 60, 120, 180, 300] as const;

interface SpinViewProps {
  controller: SpinController;
}

export function SpinView({ controller }: SpinViewProps) {
  const { t } = useTranslation();
  const { draft, status } = controller;

  if (controller.loading) return <StatusNotice>{t("spinPane.loading")}</StatusNotice>;
  if (!draft || !status) {
    return (
      <EmptyState
        title={t("spinPane.loadFailed")}
        description={controller.error || t("spinPane.loadFailedDescription")}
      />
    );
  }

  let statusText = t("spinPane.notConfigured");
  if (!draft.account_id) statusText = t("spinPane.noAccount");
  else if (draft.enabled && status.next_spin) statusText = t("spinPane.nextSpin", { time: status.next_spin });
  else if (draft.enabled && draft.mode === "peak") statusText = t("spinPane.allPeakDone");
  else if (draft.enabled) statusText = t("spinPane.todaySpun");

  const selectedSupported = controller.spinAccounts.some((account) => account.id === draft.account_id);

  return (
    <div className="space-y-4">
      {controller.error && <StatusNotice tone="danger">{controller.error}</StatusNotice>}
      {controller.spinResult && (
        <StatusNotice
          tone={controller.spinResult.executed ? "success" : "warning"}
          title={controller.spinResult.executed ? t("spinPane.executed") : t("spinPane.skipped")}
        >
          {controller.spinResult.message}
        </StatusNotice>
      )}
      {controller.unsupportedAccount && (
        <StatusNotice tone="warning" title={t("spinPane.unsupportedAccountTitle")}>
          {t("spinPane.unsupportedAccountDescription", { name: controller.unsupportedAccount.alias })}
        </StatusNotice>
      )}

      <SettingsSection>
        <SettingsRow label={t("spinPane.autoSpin")} description={statusText}>
          <Toggle
            aria-label={t("spinPane.autoSpin")}
            checked={draft.enabled}
            onCheckedChange={(enabled) => controller.updateDraft({ enabled })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("spinPane.scheduleTitle")} description={t("spinPane.scheduleDescription")}>
        <SettingsRow label={t("spinPane.mode")} stacked>
          <SegmentedControl
            aria-label={t("spinPane.mode")}
            value={draft.mode === "fixed" ? "fixed" : "peak"}
            options={[
              { value: "peak", label: t("spinPane.peakMode"), disabled: !draft.enabled },
              { value: "fixed", label: t("spinPane.fixedMode"), disabled: !draft.enabled },
            ]}
            onValueChange={(mode) => controller.updateDraft({ mode })}
          />
        </SettingsRow>

        <fieldset disabled={!draft.enabled}>
          {draft.mode === "peak" ? (
            <>
              <SettingsRow label={t("spinPane.leadTime")} stacked>
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_PRESETS.map((minutes) => (
                    <Button
                      key={minutes}
                      size="sm"
                      variant={draft.lead_minutes === minutes ? "primary" : "secondary"}
                      onClick={() => controller.updateDraft({ lead_minutes: minutes })}
                    >
                      {t(`spinPane.presets.lead${minutes === 30 ? "30min" : `${minutes / 60}h`}`)}
                    </Button>
                  ))}
                </div>
              </SettingsRow>
              <SettingsRow label={t("spinPane.peakPeriods")} stacked>
                <div className="space-y-2">
                  {draft.peak_periods.map((period, index) => (
                    <div key={`${index}-${period.start}`} className="flex items-end gap-2">
                      <TextField
                        type="time"
                        label={t("spinPane.peakPeriodLabel", { count: index + 1 })}
                        value={period.start}
                        fieldClassName="min-w-0 flex-1"
                        onChange={(event) => controller.updatePeakPeriod(index, event.target.value)}
                      />
                      <IconButton
                        aria-label={t("spinPane.removePeakPeriod", { count: index + 1 })}
                        variant="danger"
                        disabled={draft.peak_periods.length <= 1}
                        onClick={() => controller.removePeakPeriod(index)}
                      >
                        <CloseIcon size={14} />
                      </IconButton>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" leadingIcon={<PlusIcon size={14} />} onClick={controller.addPeakPeriod}>
                    {t("spinPane.add")}
                  </Button>
                </div>
              </SettingsRow>
            </>
          ) : (
            <SettingsRow label={t("spinPane.dailySpinTime")} stacked>
              <TextField
                type="time"
                label={t("spinPane.dailySpinTime")}
                value={draft.fixed_time}
                onChange={(event) => controller.updateDraft({ fixed_time: event.target.value })}
              />
            </SettingsRow>
          )}
        </fieldset>
      </SettingsSection>

      <SettingsSection title={t("spinPane.accountAndExecution")}>
        <SettingsRow label={t("spinPane.selectAccount")} stacked>
          <SelectField
            label={t("spinPane.selectAccount")}
            value={controller.unsupportedAccount ? "" : (draft.account_id ?? "")}
            onChange={(event) => controller.updateDraft({ account_id: event.target.value || null })}
          >
            <option value="">{t("spinPane.noAccountOption")}</option>
            {controller.spinAccounts.map((account) => (
              <option key={account.id} value={account.id}>{account.alias} — {account.purpose}</option>
            ))}
          </SelectField>
        </SettingsRow>
        <SettingsRow label={t("spinPane.lastSpin")}>
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">{status.last_spin ?? t("spinPane.never")}</span>
        </SettingsRow>
        <SettingsRow label={t("spinPane.manualExecution")} description={t("spinPane.manualExecutionDescription")}>
          <Button
            variant="primary"
            loading={controller.spinning}
            loadingLabel={t("spinPane.spinning")}
            disabled={!draft.account_id || !selectedSupported}
            onClick={() => { void controller.spinNow(); }}
          >
            {t("spinPane.spinNow")}
          </Button>
        </SettingsRow>
      </SettingsSection>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" disabled={!controller.dirty || controller.saving} onClick={controller.resetDraft}>
          {t("spinPane.discardChanges")}
        </Button>
        <Button
          variant="primary"
          loading={controller.saving}
          loadingLabel={t("spinPane.saving")}
          disabled={!controller.dirty}
          onClick={() => { void controller.save(); }}
        >
          {t("spinPane.saveChanges")}
        </Button>
      </div>
    </div>
  );
}
