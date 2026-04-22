import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import Toggle from "../lib/Toggle";
import type { Account } from "../types";

export default function GeneralPane() {
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
  }, []);

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
      const models = await invoke<string[]>("fetch_models", { accountId: accounts[0].id });
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

  return (
    <div className="space-y-3">
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-primary)] block">
              刷新间隔
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
              自动更新额度数据
            </span>
          </div>
          <span className="text-[12px] font-bold tabular-nums text-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2 py-0.5 rounded-md">
            {refreshInterval} min
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
          <span>1 min</span>
          <span>30 min</span>
        </div>
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[var(--color-text-primary)] block">
            开机自启
          </span>
          <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
            登录时自动启动应用
          </span>
        </div>
        <Toggle checked={autoStart} onChange={handleAutoStartToggle} />
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-primary)] block">
              默认模型
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
              快速绑定时使用的模型
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
            {modelsLoading ? "加载模型列表..." : modelDropdownOpen ? "收起模型列表" : "选择默认模型"}
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
