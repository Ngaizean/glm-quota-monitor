import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Toggle from "../lib/Toggle";
import type { Account } from "../types";

interface PeakPeriod {
  start: string;
}

interface SpinConfig {
  enabled: boolean;
  mode: string;
  peak_periods: PeakPeriod[];
  lead_minutes: number;
  fixed_time: string;
  account_id: string | null;
}

interface SpinStatus {
  config: SpinConfig;
  last_spin: string | null;
  next_spin: string | null;
}

interface SpinNowResult {
  executed: boolean;
  message: string;
}

const LEAD_PRESETS = [
  { label: "30分", value: 30 },
  { label: "1小时", value: 60 },
  { label: "2小时", value: 120 },
  { label: "3小时", value: 180 },
  { label: "5小时", value: 300 },
];

const timeClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] font-mono";

export default function SpinPane() {
  const [status, setStatus] = useState<SpinStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [s, accs] = await Promise.all([
        invoke<SpinStatus>("get_spin_status"),
        invoke<Account[]>("list_accounts"),
      ]);
      setStatus(s);
      setAccounts(accs);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }

  async function refreshStatus() {
    try {
      const s = await invoke<SpinStatus>("get_spin_status");
      setStatus(s);
    } catch (e) {
      setError(String(e));
    }
  }

  async function updateConfig(patch: Partial<SpinConfig>) {
    if (!status) return;
    const newConfig = { ...status.config, ...patch };
    if (JSON.stringify(newConfig) === JSON.stringify(status.config)) return;
    try {
      await invoke("set_spin_config", { config: newConfig });
      await refreshStatus();
      setInfo("");
    } catch (e) {
      setError(String(e));
    }
  }

  async function handleSpinNow() {
    if (!status?.config.account_id) return;
    setSpinning(true);
    setError("");
    setInfo("");
    try {
      const result = await invoke<SpinNowResult>("spin_now", {
        accountId: status.config.account_id,
      });
      setInfo(result.message);
      await refreshStatus();
    } catch (e) {
      setError(String(e));
    } finally {
      setSpinning(false);
    }
  }

  function updatePeakPeriod(index: number, patch: Partial<PeakPeriod>) {
    if (!status) return;
    const next = status.config.peak_periods.map((p, i) =>
      i === index ? { ...p, ...patch } : p,
    );
    updateConfig({ peak_periods: next });
  }

  function addPeakPeriod() {
    if (!status) return;
    const next = [...status.config.peak_periods, { start: "19:00" }];
    updateConfig({ peak_periods: next });
  }

  function removePeakPeriod(index: number) {
    if (!status || status.config.peak_periods.length <= 1) return;
    const next = status.config.peak_periods.filter((_, i) => i !== index);
    updateConfig({ peak_periods: next });
  }

  if (!status) {
    return (
      <div className="space-y-3">
        {error ? (
          <div className="text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
            {error}
          </div>
        ) : (
          <div className="text-[11px] text-[var(--color-text-tertiary)] rounded-xl p-3 border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)]">
            加载中...
          </div>
        )}
      </div>
    );
  }

  const { config, last_spin, next_spin } = status;

  // 状态摘要
  let statusText = "未配置";
  if (config.enabled && config.account_id) {
    if (next_spin) {
      statusText = `下次空转：今日 ${next_spin}`;
    } else if (config.mode === "peak") {
      statusText = "今日高峰时段已全部完成";
    } else {
      statusText = "今日已空转";
    }
  } else if (!config.account_id) {
    statusText = "未选择账号";
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
          {error}
        </div>
      )}

      {info && (
        <div className="text-[11px] text-[var(--color-accent)] rounded-xl p-3 border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/5">
          {info}
        </div>
      )}

      {/* 开关 + 状态摘要 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-[var(--color-text-primary)] block">
              自动空转
            </span>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
              {statusText}
            </span>
          </div>
          <Toggle
            checked={config.enabled}
            onChange={() => updateConfig({ enabled: !config.enabled })}
          />
        </div>
      </div>

      {/* 模式 + 配置 */}
      <div className={`bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3 transition-all duration-200 ${!config.enabled ? "opacity-40 pointer-events-none" : ""}`}>
        {/* 模式切换 */}
        <div className="flex items-center gap-1.5 p-1 bg-[var(--color-bg-tertiary)] rounded-lg">
          <button
            onClick={() => updateConfig({ mode: "peak" })}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-[var(--transition-fast)] ${
              config.mode === "peak"
                ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            高峰时段
          </button>
          <button
            onClick={() => updateConfig({ mode: "fixed" })}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-md transition-[var(--transition-fast)] ${
              config.mode === "fixed"
                ? "bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] shadow-sm"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
            }`}
          >
            固定时间
          </button>
        </div>

        {config.mode === "peak" ? (
          <div className="space-y-3">
            {/* 提前时间预设 */}
            <div>
              <span className="text-[10px] text-[var(--color-text-tertiary)] mb-1.5 block">
                提前空转时间
              </span>
              <div className="flex gap-1.5">
                {LEAD_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => updateConfig({ lead_minutes: preset.value })}
                    className={`flex-1 py-1.5 text-[10px] font-medium rounded-lg transition-[var(--transition-fast)] ${
                      config.lead_minutes === preset.value
                        ? "bg-[var(--color-accent)] text-white"
                        : "bg-[var(--color-bg-primary)] border border-[var(--color-border)] text-[var(--color-text-tertiary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 高峰时段列表 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] text-[var(--color-text-tertiary)]">
                  高峰时段
                </span>
                <button
                  onClick={addPeakPeriod}
                  className="text-[10px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-[var(--transition-fast)]"
                >
                  + 添加
                </button>
              </div>
              <div className="space-y-1.5">
                {config.peak_periods.map((period, index) => (
                  <div
                    key={`${period.start}-${index}`}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="time"
                      value={period.start}
                      onChange={(e) => updatePeakPeriod(index, { start: e.target.value })}
                      className={`${timeClass} flex-1`}
                    />
                    <button
                      onClick={() => removePeakPeriod(index)}
                      disabled={config.peak_periods.length <= 1}
                      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/5 disabled:opacity-30 disabled:pointer-events-none transition-[var(--transition-fast)]"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <span className="text-[10px] text-[var(--color-text-tertiary)] mb-1.5 block">
              每天空转时间
            </span>
            <input
              type="time"
              value={config.fixed_time}
              onChange={(e) => updateConfig({ fixed_time: e.target.value })}
              className={timeClass}
            />
          </div>
        )}
      </div>

      {/* 账号 + 状态 + 操作 合并为一个卡片 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <select
          value={config.account_id ?? ""}
          onChange={(e) =>
            updateConfig({ account_id: e.target.value || null })
          }
          className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)]"
        >
          <option value="">选择空转账号</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.alias} — {acc.purpose}
            </option>
          ))}
        </select>

        {/* 状态行 */}
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--color-text-tertiary)]">上次空转</span>
          <span className="font-medium text-[var(--color-text-secondary)]">
            {last_spin ?? "从未"}
          </span>
        </div>

        <button
          onClick={handleSpinNow}
          disabled={spinning || !config.account_id}
          className="w-full py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
        >
          {spinning ? "空转中..." : "立即空转"}
        </button>
      </div>
    </div>
  );
}
