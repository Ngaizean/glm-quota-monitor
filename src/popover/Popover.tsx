import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Header from "./Header";
import AccountList from "./AccountList";
import type { Account, QuotaData } from "../types";

interface RefreshResult {
  max_pct: number;
  quotas: Record<string, QuotaData>;
}

interface CodexRadarData {
  best_model: string;
  best_score: number;
  probability_24h: number;
  probability_level: string;
  updated_at: string;
}

// 24h 硬重置概率 -> 颜色（绿=高=重置临近 / 额度刷新利好）
function radarProbColor(p: number): string {
  if (p >= 0.70) return "#22c55e"; // 亮绿
  if (p >= 0.50) return "#16a34a"; // 绿
  if (p >= 0.30) return "#ca8a04"; // 琥珀
  if (p >= 0.15) return "#0891b2"; // 青
  return "#9ca3af"; // 灰
}

// 把网站 source_updated_at (ISO) 格式化成「刚刚 / N分钟前 / HH:MM」
function formatRefreshTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function Popover({ onOpenSettings, screenHeight }: { onOpenSettings: () => void; screenHeight: number }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [quotas, setQuotas] = useState<Record<string, QuotaData>>({});
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [radar, setRadar] = useState<CodexRadarData | null>(null);
  const [radarRefreshing, setRadarRefreshing] = useState(false);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const accountsPromise = invoke<Account[]>("list_accounts");
      const refreshPromise = invoke<RefreshResult>("refresh_all");

      const accs = await accountsPromise;
      setAccounts(accs);

      const result = await refreshPromise;
      setQuotas(result.quotas);
      setInitialized(true);
      setRefreshKey((k) => k + 1);

      // 雷达数据：后台线程已缓存，此处同步读取，不阻塞主刷新
      invoke<CodexRadarData | null>("get_codex_radar")
        .then((r) => r && setRadar(r))
        .catch(() => {});
    } catch (e) {
      setError(String(e));
      setInitialized(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const lastRefreshRef = useRef(0);
  const debouncedRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 3000) return;
    lastRefreshRef.current = now;
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const lastMoveRef = useRef(0);

  useEffect(() => {
    let justShown = false;
    const showTimer = setTimeout(() => { justShown = true; }, 300);

    const win = getCurrentWindow();
    // 拖动窗口（标题栏 drag-region）在 Windows 上会触发短暂失焦，
    // 记录最近一次窗口移动时间，失焦关闭前判断是否"刚刚在拖动"以避免误关。
    const unlistenMove = win.onMoved(() => {
      lastMoveRef.current = Date.now();
    });

    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        debouncedRefresh();
      } else if (justShown) {
        // 失焦时自动关闭 popover（菜单栏应用标准行为）
        // 加 150ms 延迟让点击事件先消化；若 400ms 内窗口移动过（正在拖动），跳过关闭
        setTimeout(() => {
          const sinceMove = Date.now() - lastMoveRef.current;
          if (sinceMove > 400) {
            invoke("close_popover");
          }
        }, 150);
      }
    });
    return () => {
      clearTimeout(showTimer);
      unlisten.then((fn) => fn());
      unlistenMove.then((fn) => fn());
    };
  }, [refreshAll]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSetPrimary(id: string) {
    await invoke("set_primary_account", { id });
    refreshAll();
  }

  // 手动刷新雷达（与网站一致地强制重新验证智力效率和预测接口）；防重复点击
  const refreshRadar = useCallback(async () => {
    if (radarRefreshing) return;
    setRadarRefreshing(true);
    try {
      const r = await invoke<CodexRadarData>("refresh_codex_radar");
      if (r) setRadar(r);
    } catch (e) {
      console.error("radar refresh failed", e);
    } finally {
      setRadarRefreshing(false);
    }
  }, [radarRefreshing]);

  // 按平台精确分区：必须用 === "zhipu"，否则 DeepSeek（platform="deepseek"）会泄漏进 GLM 区。
  // platform 字段缺失（旧数据）按 zhipu 兜底。
  const glmAccounts = accounts.filter((a) => (a.platform ?? "zhipu") === "zhipu");
  const codexAccounts = accounts.filter((a) => a.platform === "codex");
  const deepseekAccounts = accounts.filter((a) => a.platform === "deepseek");

  return (
    <div
      className="w-full flex flex-col select-none bg-[var(--color-bg-primary)] rounded-2xl shadow-[var(--shadow-popover)]"
      style={{ maxHeight: screenHeight }}
    >
      <Header loading={loading} onRefresh={refreshAll} onSettings={onOpenSettings} />
      <div className="flex-1 min-h-0 scroll-area overscroll-contain">
        {error && (
          <div className="mx-4 mt-3 text-[11px] text-[var(--color-danger)] rounded-xl p-3 border border-[var(--color-danger)]/20 bg-[var(--color-danger)]/5">
            {error}
          </div>
        )}

        {radar && (
          <div className="mx-4 mt-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] p-2.5 animate-fade-in">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-[8px]">🧠</span>
                    <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                      Codex 雷达 · 最高 IQ
                    </span>
                  </div>
                  <button
                    onClick={refreshRadar}
                    disabled={radarRefreshing}
                    className="p-0.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-[var(--transition-fast)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] disabled:opacity-40 shrink-0"
                    title="刷新雷达"
                  >
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={radarRefreshing ? "animate-spin" : ""}
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span
                    className="text-[13px] font-semibold truncate"
                    style={{ color: radarProbColor(radar.probability_24h) }}
                    title={radar.best_model}
                  >
                    {radar.best_model}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-tertiary)] shrink-0">
                    IQ {radar.best_score.toFixed(1)}
                  </span>
                </div>
              </div>
              <div
                className="text-right shrink-0"
                title="24 小时内硬重置概率，越高越可能重置（绿色=临近）"
              >
                <div
                  className="text-[14px] font-bold tabular-nums"
                  style={{ color: radarProbColor(radar.probability_24h) }}
                >
                  {(radar.probability_24h * 100).toFixed(0)}%
                </div>
                <div className="text-[8px] text-[var(--color-text-tertiary)] uppercase tracking-wide">
                  24h 重置
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-[8px] text-[var(--color-text-tertiary)] opacity-60 mt-1.5">
              <span>数据来自 codexradar.com</span>
              {radar.updated_at && <span>数据于 {formatRefreshTime(radar.updated_at)}</span>}
            </div>
          </div>
        )}

        {!initialized && (
          <div className="px-4 py-4 space-y-3">
            <div className="skeleton h-[4.5rem] rounded-2xl" />
            <div className="skeleton h-[4.5rem] rounded-2xl" />
          </div>
        )}

        {initialized && !loading && !accounts.length && !error && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4 animate-fade-in">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                  <line x1="12" y1="11" x2="12" y2="11.01" />
                </svg>
              </div>
              <div className="absolute -inset-1 rounded-2xl border-2 border-[var(--color-accent)]/20 animate-ping-slow" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">{t('popover.getStarted')}</p>
              <p className="text-[10px] text-[var(--color-text-tertiary)] leading-relaxed max-w-[200px]" dangerouslySetInnerHTML={{ __html: t('popover.getStartedDesc') }} />
            </div>
            <button
              onClick={onOpenSettings}
              className="text-[11px] font-semibold px-5 py-2 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] rounded-xl transition-[var(--transition-fast)] shadow-sm flex items-center gap-1.5"
            >
              {t('popover.addKey')}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        {initialized && glmAccounts.length > 0 && (
          <div className="px-4">
            <div className="flex items-center gap-1.5 mt-3 mb-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              </svg>
              <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('popover.sectionGlm')}
              </span>
            </div>
            <AccountList
              accounts={glmAccounts}
              expandedIds={expandedIds}
              onToggle={toggleExpand}
              onSetPrimary={handleSetPrimary}
              quotas={quotas}
              loading={loading}
              refreshKey={refreshKey}
            />
          </div>
        )}

        {initialized && codexAccounts.length > 0 && (
          <div className="px-4">
            <div className="flex items-center gap-1.5 mt-4 mb-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
              <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('popover.sectionCodex')}
              </span>
            </div>
            <AccountList
              accounts={codexAccounts}
              expandedIds={expandedIds}
              onToggle={toggleExpand}
              onSetPrimary={handleSetPrimary}
              quotas={quotas}
              loading={loading}
              refreshKey={refreshKey}
            />
          </div>
        )}

        {initialized && deepseekAccounts.length > 0 && (
          <div className="px-4">
            <div className="flex items-center gap-1.5 mt-4 mb-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="M2 10h20" />
              </svg>
              <span className="text-[9px] font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                {t('popover.sectionDeepseek')}
              </span>
            </div>
            <AccountList
              accounts={deepseekAccounts}
              expandedIds={expandedIds}
              onToggle={toggleExpand}
              onSetPrimary={handleSetPrimary}
              quotas={quotas}
              loading={loading}
              refreshKey={refreshKey}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default Popover;
