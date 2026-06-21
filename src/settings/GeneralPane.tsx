import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Toggle from "../lib/Toggle";
import type { Account } from "../types";

export default function GeneralPane() {
  const { t, i18n } = useTranslation();
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [autoStart, setAutoStart] = useState(true);
  const [defaultModel, setDefaultModel] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<string | null>("get_setting", { key: "refresh_interval" }).then((v) => {
      if (v) setRefreshInterval(Number(v));
    });
    invoke<string | null>("get_setting", { key: "auto_start" }).then((v) => {
      if (v !== null) setAutoStart(v === "1");
    });
    invoke<string>("get_default_model").then(setDefaultModel);
    // 恢复持久化的语言偏好
    const savedLang = localStorage.getItem("lang");
    if (savedLang && savedLang !== i18n.language) {
      i18n.changeLanguage(savedLang);
    }
  }, [i18n]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    }
    if (modelDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [modelDropdownOpen]);

  async function handleOpenModelDropdown() {
    if (modelDropdownOpen) {
      setModelDropdownOpen(false);
      return;
    }
    setModelDropdownOpen(true);
    if (availableModels.length > 0) return;
    setModelsLoading(true);
    try {
      const accounts = await invoke<Account[]>("list_accounts");
      if (accounts.length === 0) {
        setAvailableModels([]);
        return;
      }
      // 遍历账号尝试获取模型列表，直到成功
      let models: string[] = [];
      for (const acc of accounts) {
        try {
          models = await invoke<string[]>("fetch_models", { accountId: acc.id });
          if (models.length > 0) break;
        } catch {
          continue;
        }
      }
      setAvailableModels(models);
      if (!defaultModel && models.length > 0) {
        const latest = models[models.length - 1];
        handleModelSelect(latest);
      }
    } catch {
      setAvailableModels([]);
    } finally {
      setModelsLoading(false);
    }
  }

  async function handleModelSelect(model: string) {
    setDefaultModel(model);
    setModelDropdownOpen(false);
    await invoke("set_default_model", { model });
  }

  function handleIntervalChange(val: number) {
    setRefreshInterval(val);
    invoke("set_setting", { key: "refresh_interval", value: String(val) });
  }

  function handleAutoStartToggle() {
    const val = !autoStart;
    setAutoStart(val);
    invoke("set_setting", { key: "auto_start", value: val ? "1" : "0" });
  }

  function handleLanguageChange(lang: string) {
    i18n.changeLanguage(lang);
    localStorage.setItem("lang", lang);
  }

  return (
    <div className="space-y-3">
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-primary)] block">
              {t("generalPane.refreshInterval")}
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
              {t("generalPane.refreshIntervalDesc")}
            </span>
          </div>
          <span className="text-[12px] font-bold tabular-nums text-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-0.5 rounded-md">
            {t("generalPane.minutes", { count: refreshInterval })}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={30}
          value={refreshInterval}
          onChange={(e) => handleIntervalChange(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-[9px] text-[var(--color-text-tertiary)]">
          <span>{t("generalPane.rangeMin")}</span>
          <span>{t("generalPane.rangeMax")}</span>
        </div>
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[var(--color-text-primary)] block">
            {t("generalPane.autoStart")}
          </span>
          <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
            {t("generalPane.autoStartDesc")}
          </span>
        </div>
        <Toggle checked={autoStart} onChange={handleAutoStartToggle} />
      </div>

      {/* 界面语言 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[var(--color-text-primary)] block">
            {t("generalPane.language")}
          </span>
          <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
            {t("generalPane.languageDesc")}
          </span>
        </div>
        <div className="flex gap-1 bg-[var(--color-bg-primary)] border border-[var(--color-border-subtle)] rounded-lg p-0.5">
          {(["zh", "en"] as const).map((lang) => (
            <button
              key={lang}
              onClick={() => handleLanguageChange(lang)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-[var(--transition-fast)] ${
                i18n.language === lang || (i18n.language.startsWith(lang))
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              }`}
            >
              {t(`generalPane.${lang}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-primary)] block">
              {t("generalPane.defaultModel")}
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
              {t("generalPane.defaultModelDesc")}
            </span>
          </div>
          <span className="text-[11px] font-bold font-mono text-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-0.5 rounded-md">
            {defaultModel || "glm-5.1"}
          </span>
        </div>
        <div className="space-y-2" ref={dropdownRef}>
          <button
            onClick={handleOpenModelDropdown}
            className="w-full py-1.5 text-[11px] font-medium text-[var(--color-text-secondary)] bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)] transition-[var(--transition-fast)]"
          >
            {modelsLoading
              ? t("generalPane.loadingModels")
              : modelDropdownOpen
                ? t("generalPane.collapseModelList")
                : t("generalPane.selectDefaultModel")}
          </button>
          {modelDropdownOpen && (
            <div className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg shadow-[var(--shadow-popover)] max-h-48 overflow-y-auto scroll-area overscroll-contain animate-slide-down">
              {availableModels.map((m) => (
                <button
                  key={m}
                  onClick={() => handleModelSelect(m)}
                  className={`w-full text-left px-3 py-1.5 text-[10px] font-mono transition-[var(--transition-fast)] ${
                    m === defaultModel
                      ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)] font-bold"
                      : "text-[var(--color-text-secondary)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
