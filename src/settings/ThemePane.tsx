import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import {
  type AccentTheme,
  type ThemeMode,
  getStoredAccent,
  getStoredMode,
  setAccent,
  setMode,
} from "../lib/theme";
import SettingsRow from "./components/SettingsRow";
import SettingsSection from "./components/SettingsSection";

const ACCENTS: Array<{ id: AccentTheme; color: string; labelKey: string }> = [
  { id: "default", color: "#5B5FC7", labelKey: "theme.default" },
  { id: "ocean", color: "#0EA5E9", labelKey: "theme.ocean" },
  { id: "forest", color: "#10B981", labelKey: "theme.forest" },
  { id: "sunset", color: "#F97316", labelKey: "theme.sunset" },
];

export default function ThemePane() {
  const { t } = useTranslation();
  const [accent, setAccentState] = useState<AccentTheme>(() => getStoredAccent());
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());

  function selectMode(nextMode: ThemeMode) {
    setModeState(nextMode);
    setMode(nextMode);
  }

  function selectAccent(nextAccent: AccentTheme) {
    setAccentState(nextAccent);
    setAccent(nextAccent);
  }

  return (
    <div className="space-y-4">
      <SettingsSection title={t("theme.mode")} description={t("theme.modeDesc")}>
        <SettingsRow label={t("theme.mode")} description={t("theme.modeHelp")}>
          <SegmentedControl
            aria-label={t("theme.mode")}
            value={mode}
            options={(["system", "light", "dark"] as const).map((value) => ({
              value,
              label: t(`theme.mode${value.charAt(0).toUpperCase()}${value.slice(1)}`),
            }))}
            onValueChange={selectMode}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("theme.accentColor")} description={t("theme.accentDesc")}>
        <div className="grid grid-cols-4 gap-3 p-5">
          {ACCENTS.map((theme) => {
            const selected = accent === theme.id;
            return (
              <button
                key={theme.id}
                type="button"
                aria-pressed={selected}
                onClick={() => selectAccent(theme.id)}
                className={`flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-medium transition-all ${
                  selected
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)] shadow-sm"
                    : "border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)] hover:border-[var(--color-border)]"
                }`}
              >
                <span
                  className="h-9 w-9 rounded-xl shadow-sm"
                  style={{
                    backgroundColor: theme.color,
                    boxShadow: selected ? `0 0 0 3px color-mix(in srgb, ${theme.color} 22%, transparent)` : undefined,
                  }}
                  aria-hidden="true"
                />
                <span>{t(theme.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title={t("theme.preview")} description={t("theme.previewDesc")}>
        <div className="p-5">
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {t("theme.previewTitle")}
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">
                  {t("theme.previewText")}
                </div>
              </div>
              <span className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white">
                {t("theme.previewPrimary")}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--color-accent-subtle)]">
              <div className="h-full w-3/5 rounded-full bg-[var(--color-accent)]" />
            </div>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
