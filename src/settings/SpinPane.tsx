import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Toggle from "../lib/Toggle";
import type { Account } from "../types";

interface PeakPeriod {
  start: string;
  end: string;
}

interface SpinConfig {
  enabled: boolean;
  mode: string;
  peak_periods: PeakPeriod[];
  lead_hours: number;
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

const timeClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)] font-mono";

const numberClass =
  "w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)] transition-[var(--transition-fast)]";

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
    const next = [...status.config.peak_periods, { start: "19:00", end: "23:00" }];
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

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 flex items-center justify-between">
        <div>
          <span className="text-xs font-medium text-[var(--color-text-primary)] block">
            自动空转
          </span>
          <span className="text-[10px] text-[var(--color-text-tertiary)] mt-0.5 block">
            在高峰前自动触发额度计时器
          </span>
        </div>
        <Toggle
          checked={config.enabled}
          onChange={() => updateConfig({ enabled: !config.enabled })}
        />
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateConfig({ mode: "peak" })}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-[var(--transition-fast)] ${
              config.mode === "peak"
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
            }`}
          >
            高峰时段
          </button>
          <button
            onClick={() => updateConfig({ mode: "fixed" })}
            className={`flex-1 py-1.5 text-[11px] font-medium rounded-lg transition-[var(--transition-fast)] ${
              config.mode === "fixed"
                ? "bg-[var(--color-accent)] text-white"
                : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
            }`}
          >
            固定时间
          </button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] px-3 py-2">
          <span className="text-[10px] text-[var(--color-text-tertiary)]">当前生效模式</span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
            {config.mode === "peak" ? "高峰时段" : "固定时间"}
          </span>
        </div>

        {config.mode === "peak" ? (
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-[var(--color-text-tertiary)] mb-1 block">
                提前空转小时数
              </label>
              <input
                type="number"
                min={1}
                max={5}
                value={config.lead_hours}
                onChange={(e) =>
                  updateConfig({
                    lead_hours: Math.max(1, Math.min(5, Number(e.target.value) || 3)),
                  })
                }
                className={numberClass}
              />
              <p className="text-[9px] text-[var(--color-text-tertiary)] mt-1">
                在每个高峰开始前 {config.lead_hours} 小时内，如计时器未启动，则自动空转
              </p>
            </div>

            <div className="space-y-2">
              {config.peak_periods.map((period, index) => (
                <div
                  key={`${period.start}-${period.end}-${index}`}
                  className="bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-[var(--color-text-secondary)]">
                      高峰时段 {index + 1}
                    </span>
                    <button
                      onClick={() => removePeakPeriod(index)}
                      disabled={config.peak_periods.length <= 1}
                      className="text-[10px] text-[var(--color-text-tertiary)] hover:text-[var(--color-danger)] disabled:opacity-40"
                    >
                      删除
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] text-[var(--color-text-tertiary)] mb-1 block">
                        开始
                      </label>
                      <input
                        type="time"
                        value={period.start}
                        onChange={(e) => updatePeakPeriod(index, { start: e.target.value })}
                        className={timeClass}
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-[var(--color-text-tertiary)] mb-1 block">
                        结束
                      </label>
                      <input
                        type="time"
                        value={period.end}
                        onChange={(e) => updatePeakPeriod(index, { end: e.target.value })}
                        className={timeClass}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                onClick={addPeakPeriod}
                className="w-full py-2 text-[11px] font-medium text-[var(--color-accent)] bg-[var(--color-accent-subtle)] hover:bg-[var(--color-accent)]/15 rounded-lg transition-[var(--transition-fast)]"
              >
                + 添加高峰时段
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="text-[10px] text-[var(--color-text-tertiary)] mb-1 block">
              每天空转时间
            </label>
            <input
              type="time"
              value={config.fixed_time}
              onChange={(e) => updateConfig({ fixed_time: e.target.value })}
              className={timeClass}
            />
          </div>
        )}
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2">
        <label className="text-[10px] text-[var(--color-text-tertiary)] block">
          空转账号
        </label>
        <select
          value={config.account_id ?? ""}
          onChange={(e) =>
            updateConfig({
              account_id: e.target.value || null,
            })
          }
          className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded-lg px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:border-[var(--color-accent)]"
        >
          <option value="">选择账号</option>
          {accounts.map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.alias} — {acc.purpose}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-tertiary)]">上次空转</span>
          <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">
            {last_spin ?? "从未"}
          </span>
        </div>
        {next_spin && config.enabled && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--color-text-tertiary)]">下次计划</span>
            <span className="text-[11px] font-medium text-[var(--color-accent)]">
              今日 {next_spin}
            </span>
          </div>
        )}
        <button
          onClick={handleSpinNow}
          disabled={spinning || !config.account_id}
          className="w-full py-2 mt-1 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] disabled:text-[var(--color-text-tertiary)] text-white rounded-lg text-xs font-medium transition-[var(--transition-fast)] shadow-sm"
        >
          {spinning ? "空转中..." : "立即空转"}
        </button>
      </div>
    </div>
  );
}
