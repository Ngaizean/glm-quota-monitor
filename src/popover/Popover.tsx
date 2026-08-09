import { invoke } from "@tauri-apps/api/core";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePopoverWindowLifecycle } from "../hooks/usePopoverWindowLifecycle";
import { groupAccountsByPlatform } from "../lib/platform";
import { isPreviewMode, isTauriRuntime } from "../lib/runtime";
import Header from "./Header";
import PlatformSection from "./PlatformSection";
import RadarCard from "./RadarCard";
import { useDashboardData, type CodexRadarData } from "./useDashboardData";

interface PopoverProps {
  onOpenSettings: () => void;
  screenHeight: number;
}

export default function Popover({ onOpenSettings, screenHeight }: PopoverProps) {
  const { t } = useTranslation();
  const {
    accounts,
    quotas,
    radar,
    setRadar,
    loading,
    initialized,
    error,
    refreshKey,
    refresh,
    setPrimary,
  } = useDashboardData();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [radarRefreshing, setRadarRefreshing] = useState(false);
  const [radarError, setRadarError] = useState("");
  const [actionError, setActionError] = useState("");
  const lastFocusRefreshRef = useRef(Date.now());

  const refreshOnFocus = useCallback(() => {
    const now = Date.now();
    if (now - lastFocusRefreshRef.current < 3_000) return;
    lastFocusRefreshRef.current = now;
    return refresh();
  }, [refresh]);

  usePopoverWindowLifecycle({
    enabled: isTauriRuntime(),
    onFocus: refreshOnFocus,
    onError: (caught) => console.error("popover window lifecycle failed", caught),
  });

  const groups = useMemo(() => groupAccountsByPlatform(accounts), [accounts]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSetPrimary = useCallback(async (id: string) => {
    setActionError("");
    try {
      await setPrimary(id);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [setPrimary]);

  const refreshRadar = useCallback(async () => {
    if (radarRefreshing) return;
    setRadarRefreshing(true);
    setRadarError("");
    try {
      if (isPreviewMode()) {
        await new Promise((resolve) => setTimeout(resolve, 320));
        setRadar((current) => current ? { ...current, updated_at: new Date().toISOString() } : current);
        return;
      }
      const next = await invoke<CodexRadarData>("refresh_codex_radar");
      setRadar(next);
    } catch (caught) {
      setRadarError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRadarRefreshing(false);
    }
  }, [radarRefreshing, setRadar]);

  return (
    <main className="popover-shell" style={{ maxHeight: screenHeight }}>
      <Header loading={loading} onRefresh={() => void refresh()} onSettings={onOpenSettings} />
      <div className="popover-scroll scroll-area overscroll-contain">
        {(error || actionError) && (
          <div className="status-banner status-banner--critical" role="alert">
            <strong>{t("common.error")}</strong>
            <span>{error || actionError}</span>
          </div>
        )}

        {radar && (
          <RadarCard
            data={radar}
            refreshing={radarRefreshing}
            error={radarError}
            onRefresh={() => void refreshRadar()}
          />
        )}

        {!initialized && (
          <div className="dashboard-skeleton" aria-label={t("common.loading")}>
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-[4.5rem] rounded-xl" />
            <div className="skeleton h-[4.5rem] rounded-xl" />
          </div>
        )}

        {initialized && accounts.length === 0 && !error && (
          <section className="empty-state empty-state--dashboard">
            <div className="empty-state__icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
                <path d="M19 8v6M16 11h6" />
              </svg>
            </div>
            <div>
              <h2>{t("popover.getStarted")}</h2>
              <p>{t("popover.getStartedPlain")}</p>
            </div>
            <button type="button" className="button button--primary" onClick={onOpenSettings}>
              {t("popover.addAccount")}
            </button>
          </section>
        )}

        {initialized && groups.map((group) => (
          <PlatformSection
            key={group.platform}
            title={t(`popover.platform.${group.platform}`)}
            accounts={group.accounts}
            expandedIds={expandedIds}
            onToggle={toggleExpand}
            onSetPrimary={(id) => void handleSetPrimary(id)}
            quotas={quotas}
            loading={loading}
            refreshKey={refreshKey}
          />
        ))}
      </div>
    </main>
  );
}
