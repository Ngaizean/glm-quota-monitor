import { useState } from "react";
import AccountsPane from "./AccountsPane";
import AlertsPane from "./AlertsPane";
import GeneralPane from "./GeneralPane";
import SpinPane from "./SpinPane";
import AboutPane from "./AboutPane";

const navItems = [
  {
    id: "accounts",
    label: "账号",
    title: "账号管理",
    desc: "添加、管理 API Key",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>
    ),
  },
  {
    id: "alerts",
    label: "预警",
    title: "预警设置",
    desc: "配置额度阈值通知",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    id: "spin",
    label: "空转",
    title: "空转设置",
    desc: "自动触发额度计时器",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: "general",
    label: "通用",
    title: "通用设置",
    desc: "刷新间隔、启动偏好",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    id: "about",
    label: "关于",
    title: "关于",
    desc: "版本信息",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
];

export default function Settings({ onBack, screenHeight }: { onBack: () => void; screenHeight: number }) {
  const [activeTab, setActiveTab] = useState("accounts");
  const currentNav = navItems.find((n) => n.id === activeTab)!;

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
          title="返回"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex flex-col items-center gap-1 py-2 rounded-lg text-[9px] font-medium transition-all duration-200 ${
                activeTab === item.id
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1" />
        <div className="text-[8px] text-[var(--color-text-tertiary)] text-center font-medium">v4.2.0</div>
      </nav>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h1 className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
            {currentNav.title}
          </h1>
          <p className="text-[11px] text-[var(--color-text-tertiary)] mt-0.5">
            {currentNav.desc}
          </p>
        </div>
        <div className="flex-1 scroll-area px-5 pb-5">
          <div key={activeTab} className="animate-fade-in">
            {activeTab === "accounts" && <AccountsPane />}
            {activeTab === "alerts" && <AlertsPane />}
            {activeTab === "spin" && <SpinPane />}
            {activeTab === "general" && <GeneralPane />}
            {activeTab === "about" && <AboutPane />}
          </div>
        </div>
      </div>
    </div>
  );
}
