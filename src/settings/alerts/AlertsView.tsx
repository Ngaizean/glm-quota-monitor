import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { SelectField } from "../../components/ui/Field";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { Toggle } from "../../components/ui/Toggle";
import SettingsRow from "../components/SettingsRow";
import SettingsSection from "../components/SettingsSection";
import { AlertRuleRow } from "./AlertRuleRow";
import { alertScopeKey } from "./alertModel";
import { ALERT_RULE_TYPES } from "./types";
import type { AlertsController } from "./useAlertsController";

interface AlertsViewProps {
  controller: AlertsController;
}

export function AlertsView({ controller }: AlertsViewProps) {
  const { t } = useTranslation();
  const scope = alertScopeKey(controller.selectedId);

  return (
    <div className="space-y-4">
      {controller.currentError && <StatusNotice tone="danger">{controller.currentError}</StatusNotice>}
      {controller.rulesLoading && <StatusNotice>{t("alertsPane.loadingRules")}</StatusNotice>}

      <SettingsSection>
        <SettingsRow label={t("alertsPane.muteAll")} description={t("alertsPane.muteAllDesc")}>
          <Toggle
            aria-label={t("alertsPane.muteAll")}
            checked={controller.muted}
            disabled={controller.mutating.has("$mute")}
            onCheckedChange={(muted) => { void controller.setAlertMuted(muted); }}
          />
        </SettingsRow>
        <SettingsRow
          label={t("alertsPane.ruleScope")}
          description={controller.selectedAccount
            ? t("alertsPane.editingAccount", { name: controller.selectedAccount.alias })
            : t("alertsPane.globalDefaultDescription")}
          stacked
        >
          <div className="flex items-end gap-2">
            <SelectField
              label={t("alertsPane.accountScope")}
              value={controller.selectedId ?? ""}
              onChange={(event) => controller.selectAccount(event.target.value || null)}
              disabled={controller.rulesLoading}
              fieldClassName="min-w-0 flex-1"
            >
              <option value="">{t("alertsPane.globalDefault")}</option>
              {controller.accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.alias}</option>
              ))}
            </SelectField>
            {controller.selectedId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={controller.overrides.size === 0 || controller.mutating.has(`${scope}:reset`)}
                loading={controller.mutating.has(`${scope}:reset`)}
                onClick={() => { void controller.resetToGlobal(); }}
              >
                {t("alertsPane.resetToGlobal")}
              </Button>
            )}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("alertsPane.rulesTitle")} description={t("alertsPane.rulesDescription")}>
        {ALERT_RULE_TYPES.map((ruleType) => {
          const rule = controller.effectiveRules.get(ruleType);
          if (!rule) return null;
          return (
            <AlertRuleRow
              key={ruleType}
              rule={rule}
              pending={controller.mutating.has(`${scope}:${ruleType}`)}
              onUpdate={(patch) => { void controller.updateRule(ruleType, patch); }}
            />
          );
        })}
      </SettingsSection>
    </div>
  );
}
