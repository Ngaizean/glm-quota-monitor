import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/Toggle";
import SettingsRow from "../components/SettingsRow";
import { DEDUPE_PRESETS, IDLE_PRESETS, PERCENT_RULES, RESET_PRESETS } from "./alertModel";
import type { AlertRule, AlertRulePatch, AlertRuleType } from "./types";

interface AlertRuleRowProps {
  rule: AlertRule;
  onUpdate: (patch: AlertRulePatch) => void;
  pending?: boolean;
}

function ruleTranslationKey(ruleType: AlertRuleType) {
  if (ruleType === "token_5h") return "token5h";
  if (ruleType === "mcp_monthly") return "mcpMonthly";
  if (ruleType === "reset_soon") return "resetSoon";
  return "idleAccount";
}

export function AlertRuleRow({ rule, onUpdate, pending = false }: AlertRuleRowProps) {
  const { t } = useTranslation();
  const [advanced, setAdvanced] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(rule.threshold);
  const thresholdDirtyRef = useRef(false);
  const key = ruleTranslationKey(rule.rule_type);
  const isPercent = PERCENT_RULES.has(rule.rule_type);
  const isReset = rule.rule_type === "reset_soon";
  const presets = isReset ? RESET_PRESETS : IDLE_PRESETS;

  useEffect(() => {
    setThresholdDraft(rule.threshold);
    thresholdDirtyRef.current = false;
  }, [rule.threshold]);

  function formatMinutes(minutes: number) {
    if (minutes < 60) return t("alertsPane.minuteValue", { count: minutes });
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest
      ? t("alertsPane.hourMinuteValue", { hours, minutes: rest })
      : t("alertsPane.hourValue", { count: hours });
  }

  function commitThreshold(value: number) {
    if (!thresholdDirtyRef.current) return;
    thresholdDirtyRef.current = false;
    onUpdate({ threshold: value });
  }

  return (
    <div>
      <SettingsRow
        label={t(`alertsPane.${key}`)}
        description={t(`alertsPane.${key}Desc`)}
        stacked
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-[11px] text-[var(--color-text-tertiary)]">
            {isPercent
              ? t("alertsPane.notifyAbove", { threshold: thresholdDraft })
              : isReset
                ? t("alertsPane.notifyBefore", { time: formatMinutes(rule.threshold) })
                : t("alertsPane.idleNotifyAfter", { time: formatMinutes(rule.threshold) })}
          </span>
          <Toggle
            aria-label={t("alertsPane.ruleEnabled", { name: t(`alertsPane.${key}`) })}
            checked={rule.enabled}
            disabled={pending}
            onCheckedChange={(enabled) => onUpdate({ enabled })}
          />
        </div>

        {isPercent ? (
          <input
            type="range"
            min={50}
            max={100}
            value={thresholdDraft}
            disabled={!rule.enabled || pending}
            aria-label={t("alertsPane.thresholdLabel", { name: t(`alertsPane.${key}`) })}
            className="mt-3 w-full"
            onChange={(event) => {
              thresholdDirtyRef.current = true;
              setThresholdDraft(Number(event.target.value));
            }}
            onPointerUp={(event) => commitThreshold(Number(event.currentTarget.value))}
            onBlur={(event) => commitThreshold(Number(event.currentTarget.value))}
          />
        ) : (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {presets.map((value) => (
              <Button
                key={value}
                size="sm"
                variant={rule.threshold === value ? "primary" : "secondary"}
                disabled={!rule.enabled || pending}
                onClick={() => onUpdate({ threshold: value })}
              >
                {formatMinutes(value)}
              </Button>
            ))}
          </div>
        )}

        <div className="mt-3 border-t border-[var(--color-border-subtle)] pt-2">
          <Button size="sm" variant="ghost" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? t("alertsPane.hideAdvanced") : t("alertsPane.showAdvanced")}
          </Button>
          {advanced && (
            <div className="mt-2">
              <div className="mb-1.5 text-[11px] text-[var(--color-text-tertiary)]">
                {t("alertsPane.dedupeWindow")} · {formatMinutes(rule.dedupe_window_mins)}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DEDUPE_PRESETS.map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={rule.dedupe_window_mins === value ? "primary" : "secondary"}
                    disabled={!rule.enabled || pending}
                    onClick={() => onUpdate({ dedupe_window_mins: value })}
                  >
                    {formatMinutes(value)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </SettingsRow>
    </div>
  );
}
