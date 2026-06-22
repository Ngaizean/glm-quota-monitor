import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import AccountsPane from "./AccountsPane";
import AlertsPane from "./AlertsPane";
import GeneralPane from "./GeneralPane";
import SpinPane from "./SpinPane";
import ThemePane from "./ThemePane";
import ExportPane from "./ExportPane";
import AboutPane from "./AboutPane";
import { version as APP_VERSION } from "../../package.json";

const navItemIds = ["accounts", "alerts", "spin", "general", "theme", "export", "about"] as const;
type NavId = (typeof navItemIds)[number];

function getNavIcon(id: NavId) {
  switch (id) {
    case "accounts": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    );
    case "alerts": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    );
    case "spin": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
    case "general": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    );
    case "theme": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    );
    case "export": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    );
    case "about": return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  }
}

function getNavLabel(id: NavId): string {
  const map: Record<NavId, string> = {
    accounts: "settings.accountsLabel",
    alerts: "settings.alertsLabel",
    spin: "settings.spinLabel",
    general: "settings.generalLabel",
    theme: "settings.themeLabel",
    export: "settings.exportLabel",
    about: "settings.aboutLabel",
  };
  return map[id];
}

function getNavTitle(id: NavId): string {
  const map: Record<NavId, string> = {
    accounts: "settings.accounts",
    alerts: "settings.alerts",
    spin: "settings.spin",
    general: "settings.general",
    theme: "settings.theme",
    export: "settings.export",
    about: "settings.about",
  };
  return map[id];
}

function getNavDesc(id: NavId): string {
  const map: Record<NavId, string> = {
    accounts: "settings.accountsDesc",
    alerts: "settings.alertsDesc",
    spin: "settings.spinDesc",
    general: "settings.generalDesc",
    theme: "settings.themeDesc",
    export: "settings.exportDesc",
    about: "settings.aboutDesc",
  };
  return map[id];
}

export default function Settings({ onBack, screenHeight }: { onBack: () => void; screenHeight: number }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<NavId>("accounts");

  return (
    <div
      className="w-full flex select-none overflow-hidden bg-[var(--color-bg-primary)] rounded-2xl shadow-[var(--shadow-popover)]"
      style={{ maxHeight: screenHeight }}
    >
      {/* Sidebar */}
      <nav className="w-[76px] bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] flex flex-col py-3 px-2.5 shrink-0">
        <button
          onClick={onBack}
          className="p-2 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-[var(--transition-fast)] mb-3 flex items-center justify-center self-center"
          title={t('settings.back')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="space-y-1">
          {navItemIds.map((id) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex flex-col items-center gap-1 py-2 rounded-lg text-[9px] font-medium transition-all duration-200 ${
                activeTab === id
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              }`}
            >
              {getNavIcon(id)}
              <span>{t(getNavLabel(id))}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <div className="text-[9px] text-[var(--color-text-tertiary)] text-center font-medium tabular-nums">v{APP_VERSION}</div>
      </nav>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="px-5 pt-5 pb-3 shrink-0 cursor-default"
          data-tauri-drag-region
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const target = e.target as HTMLElement;
            if (target.closest("button") || target.closest("a") || target.closest("input")) return;
            invoke("start_window_drag");
          }}
        >
          <h1 className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
            {t(getNavTitle(activeTab))}
          </h1>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
            {t(getNavDesc(activeTab))}
          </p>
        </div>
        <div className="flex-1 scroll-area px-5 pb-5">
          <div key={activeTab} className="animate-fade-in">
            {activeTab === "accounts" && <AccountsPane />}
            {activeTab === "alerts" && <AlertsPane />}
            {activeTab === "spin" && <SpinPane />}
            {activeTab === "general" && <GeneralPane />}
            {activeTab === "theme" && <ThemePane />}
            {activeTab === "export" && <ExportPane />}
            {activeTab === "about" && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  );
}
