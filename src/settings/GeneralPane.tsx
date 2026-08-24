import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon } from "../components/icons";
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
  const [sub2apiEnabled, setSub2apiEnabled] = useState(false);
  const [defaultModel, setDefaultModel] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [customModels, setCustomModels] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
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
        invoke<string | null>("get_setting", { key: "sub2api_enabled" }),
        invoke<string>("get_default_model"),
        invoke<string[]>("get_custom_models"),
      ]);
      if (disposed) return;

      const [intervalResult, autoStartResult, sub2apiResult, modelResult, customModelsResult] = results;
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
      if (sub2apiResult.status === "fulfilled") {
        setSub2apiEnabled(sub2apiResult.value === "true");
      }
      if (modelResult.status === "fulfilled") setDefaultModel(modelResult.value);
      if (customModelsResult.status === "fulfilled" && Array.isArray(customModelsResult.value)) {
        setCustomModels(customModelsResult.value);
      }

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

  async function handleSub2apiToggle() {
    const previous = sub2apiEnabled;
    const next = !previous;
    setSub2apiEnabled(next);
    setSaving("sub2api");
    try {
      await invoke("set_setting", { key: "sub2api_enabled", value: next ? "true" : "false" });
      showSaved();
    } catch {
      setSub2apiEnabled(previous);
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

  async function handleAddCustomModel() {
    const model = customInput.trim();
    if (!model) return;
    setSaving("customModel");
    try {
      const next = await invoke<string[]>("add_custom_model", { model });
      if (Array.isArray(next)) setCustomModels(next);
      else setCustomModels(Array.from(new Set([...customModels, model])).sort());
      setCustomInput("");
      await handleModelSelect(model);
    } catch {
      setMessage({ kind: "error", text: t("generalPane.saveError") });
    } finally {
      setSaving(null);
    }
  }

  async function handleRemoveCustomModel(model: string) {
    const previous = customModels;
    setCustomModels((current) => current.filter((item) => item !== model));
    try {
      const next = await invoke<string[]>("remove_custom_model", { model });
      setCustomModels(Array.isArray(next) ? next : previous.filter((item) => item !== model));
    } catch {
      setCustomModels(previous);
      setMessage({ kind: "error", text: t("generalPane.saveError") });
    }
  }

  async function handleLanguageChange(language: "zh" | "en") {
    await i18n.changeLanguage(language);
    localStorage.setItem("lang", language);
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  }

  const modelOptions = useMemo(() => {
    const all = Array.from(new Set([...availableModels, ...customModels])).sort();
    if (!defaultModel || all.includes(defaultModel)) return all;
    return [defaultModel, ...all];
  }, [availableModels, customModels, defaultModel]);

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
        <SettingsRow label={t("generalPane.sub2apiToggle")} description={t("generalPane.sub2apiToggleDesc")}>
          <Toggle
            aria-label={t("generalPane.sub2apiToggle")}
            checked={sub2apiEnabled}
            disabled={loading || saving === "sub2api"}
            onCheckedChange={() => void handleSub2apiToggle()}
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
        <SettingsRow
          label={t("generalPane.customModel")}
          description={t("generalPane.customModelDesc")}
          htmlFor="custom-model-input"
          stacked
        >
          <div className="flex items-center gap-2">
            <input
              id="custom-model-input"
              value={customInput}
              onChange={(event) => setCustomInput(event.target.value)}
              placeholder={t("generalPane.customModelPlaceholder")}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!customInput.trim()}
              loading={saving === "customModel"}
              onClick={() => { void handleAddCustomModel(); }}
            >
              {t("generalPane.addCustomModel")}
            </Button>
          </div>
          {customModels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {customModels.map((model) => (
                <span
                  key={model}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] py-0.5 pl-2.5 pr-1"
                >
                  <span className="font-mono text-[11px] text-[var(--color-text-secondary)]">{model}</span>
                  <button
                    type="button"
                    aria-label={t("generalPane.removeCustomModel", { model })}
                    className="rounded-full p-0.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)]"
                    onClick={() => { void handleRemoveCustomModel(model); }}
                  >
                    <CloseIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
