import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/Button";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { StatusNotice } from "../components/ui/StatusNotice";
import { Toggle } from "../components/ui/Toggle";
import type { Account } from "../types";
import SettingsRow from "./components/SettingsRow";
import SettingsSection from "./components/SettingsSection";

export default function GeneralPane() {
  const { t, i18n } = useTranslation();
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [autoStart, setAutoStart] = useState(false);
  const [defaultModel, setDefaultModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const intervalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingIntervalRef = useRef<number | null>(null);
  const savedIntervalRef = useRef(5);

  useEffect(() => {
    let disposed = false;

    async function loadSettings() {
      const results = await Promise.allSettled([
        invoke<string | null>("get_setting", { key: "refresh_interval" }),
        invoke<string | null>("get_setting", { key: "auto_start" }),
        invoke<string>("get_default_model"),
      ]);
      if (disposed) return;

      const [intervalResult, autoStartResult, modelResult] = results;
      if (intervalResult.status === "fulfilled") {
        const value = Number(intervalResult.value);
        if (Number.isFinite(value) && value >= 1 && value <= 30) {
          savedIntervalRef.current = value;
          setRefreshInterval(value);
        }
      }
      if (autoStartResult.status === "fulfilled" && autoStartResult.value !== null) {
        setAutoStart(autoStartResult.value === "1");
      }
      if (modelResult.status === "fulfilled") setDefaultModel(modelResult.value);

      if (results.some((result) => result.status === "rejected")) {
        setMessage({ kind: "error", text: t("generalPane.loadError") });
      }
      setLoading(false);
    }

    void loadSettings();
    return () => {
      disposed = true;
      if (intervalTimerRef.current) clearTimeout(intervalTimerRef.current);
      const pending = pendingIntervalRef.current;
      if (pending !== null) {
        void invoke("set_setting", { key: "refresh_interval", value: String(pending) });
      }
    };
  }, [t]);

  function showSaved() {
    setMessage({ kind: "success", text: t("generalPane.saved") });
  }

  function scheduleIntervalSave(value: number) {
    setRefreshInterval(value);
    pendingIntervalRef.current = value;
    if (intervalTimerRef.current) clearTimeout(intervalTimerRef.current);
    intervalTimerRef.current = setTimeout(async () => {
      const pending = pendingIntervalRef.current;
      if (pending === null) return;
      pendingIntervalRef.current = null;
      intervalTimerRef.current = null;
      setSaving("interval");
      try {
        await invoke("set_setting", { key: "refresh_interval", value: String(pending) });
        savedIntervalRef.current = pending;
        showSaved();
      } catch {
        setRefreshInterval(savedIntervalRef.current);
        setMessage({ kind: "error", text: t("generalPane.saveError") });
      } finally {
        setSaving(null);
      }
    }, 450);
  }

  async function handleAutoStartToggle() {
    const previous = autoStart;
    const next = !previous;
    setAutoStart(next);
    setSaving("autoStart");
    try {
      await invoke("set_setting", { key: "auto_start", value: next ? "1" : "0" });
      showSaved();
    } catch {
      setAutoStart(previous);
      setMessage({ kind: "error", text: t("generalPane.saveError") });
    } finally {
      setSaving(null);
    }
  }

  async function loadModels() {
    setModelsLoading(true);
    setMessage(null);
    try {
      const accounts = await invoke<Account[]>("list_accounts");
      const candidates = accounts.filter((account) => account.platform !== "codex");
      let models: string[] = [];
      for (const account of candidates) {
        try {
          models = await invoke<string[]>("fetch_models", { accountId: account.id });
          if (models.length > 0) break;
        } catch {
          // 继续尝试下一个可绑定账号。
        }
      }
      setAvailableModels(Array.from(new Set(models)));
      if (models.length === 0) {
        setMessage({ kind: "error", text: t("generalPane.noModels") });
      }
    } catch {
      setMessage({ kind: "error", text: t("generalPane.modelsLoadError") });
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleModelSelect(model: string) {
    const previous = defaultModel;
    setDefaultModel(model);
    setSaving("model");
    try {
      await invoke("set_default_model", { model });
      showSaved();
    } catch {
      setDefaultModel(previous);
      setMessage({ kind: "error", text: t("generalPane.saveError") });
    } finally {
      setSaving(null);
    }
  }

  async function handleLanguageChange(language: "zh" | "en") {
    await i18n.changeLanguage(language);
    localStorage.setItem("lang", language);
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  }

  const modelOptions = useMemo(() => {
    if (!defaultModel || availableModels.includes(defaultModel)) return availableModels;
    return [defaultModel, ...availableModels];
  }, [availableModels, defaultModel]);

  return (
    <div className="space-y-4">
      {message && (
        <StatusNotice tone={message.kind === "error" ? "danger" : "success"}>
          {message.text}
        </StatusNotice>
      )}

      <SettingsSection title={t("generalPane.dataRefresh")} description={t("generalPane.dataRefreshDesc")}>
        <SettingsRow
          label={t("generalPane.refreshInterval")}
          description={t("generalPane.refreshIntervalDesc")}
          htmlFor="refresh-interval"
          stacked
        >
          <div className="flex items-center gap-4">
            <input
              id="refresh-interval"
              type="range"
              min={1}
              max={30}
              value={refreshInterval}
              disabled={loading || saving === "interval"}
              onChange={(event) => scheduleIntervalSave(Number(event.target.value))}
              className="min-w-0 flex-1 disabled:opacity-50"
            />
            <output
              htmlFor="refresh-interval"
              className="min-w-20 rounded-lg bg-[var(--color-accent-subtle)] px-2.5 py-1 text-center text-xs font-semibold tabular-nums text-[var(--color-accent)]"
            >
              {saving === "interval" ? t("generalPane.saving") : t("generalPane.minutes", { count: refreshInterval })}
            </output>
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[var(--color-text-tertiary)]">
            <span>{t("generalPane.rangeMin")}</span>
            <span>{t("generalPane.rangeMax")}</span>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection>
        <SettingsRow label={t("generalPane.autoStart")} description={t("generalPane.autoStartDesc")}>
          <Toggle
            aria-label={t("generalPane.autoStart")}
            checked={autoStart}
            disabled={loading || saving === "autoStart"}
            onCheckedChange={() => void handleAutoStartToggle()}
          />
        </SettingsRow>
        <SettingsRow label={t("generalPane.language")} description={t("generalPane.languageDesc")}>
          <SegmentedControl
            aria-label={t("generalPane.language")}
            value={i18n.language.startsWith("en") ? "en" : "zh"}
            options={(["zh", "en"] as const).map((language) => ({
              value: language,
              label: t(`generalPane.${language}`),
            }))}
            onValueChange={(language) => void handleLanguageChange(language)}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={t("generalPane.modelSection")} description={t("generalPane.modelSectionDesc")}>
        <SettingsRow label={t("generalPane.defaultModel")} description={t("generalPane.defaultModelDesc")} htmlFor="default-model">
          <div className="flex items-center gap-2">
            {modelOptions.length > 0 ? (
              <select
                id="default-model"
                value={defaultModel}
                disabled={loading || saving === "model"}
                onChange={(event) => void handleModelSelect(event.target.value)}
                className="min-h-9 max-w-64 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-xs font-mono text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
              >
                {modelOptions.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <span className="max-w-48 truncate rounded-lg bg-[var(--color-accent-subtle)] px-2.5 py-1 text-xs font-semibold font-mono text-[var(--color-accent)]">
                {defaultModel || "—"}
              </span>
            )}
            <Button
              size="sm"
              onClick={() => void loadModels()}
              disabled={loading}
              loading={modelsLoading}
              loadingLabel={t("generalPane.loadingModels")}
            >
              {t("generalPane.loadModels")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
