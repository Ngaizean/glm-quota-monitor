import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import AccountsPane from "./AccountsPane";
import AlertsPane from "./AlertsPane";
import GeneralPane from "./GeneralPane";
import AboutPane from "./AboutPane";

const tabs = [
  { id: "accounts", label: "账号" },
  { id: "alerts", label: "预警" },
  { id: "general", label: "通用" },
  { id: "about", label: "关于" },
];

export default function Settings({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState("accounts");

  useEffect(() => {
    const win = getCurrentWindow();
    win.setSize(new LogicalSize(340, 480));
    return () => {
      win.setSize(new LogicalSize(340, 300));
    };
  }, []);

  return (
    <div className="w-full h-full bg-white rounded-2xl shadow-xl border border-gray-200/50 flex flex-col select-none overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 shrink-0">
        <button onClick={onBack}
          className="text-[11px] text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1">
          ← 返回
        </button>
        <span className="text-xs font-semibold text-gray-700">设置</span>
        <div className="w-10" />
      </div>

      <div className="flex border-b border-gray-100 shrink-0">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 text-xs transition-colors ${
              activeTab === tab.id
                ? "text-blue-600 border-b-2 border-blue-600"
                : "text-gray-400 hover:text-gray-600"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "accounts" && <AccountsPane />}
        {activeTab === "alerts" && <AlertsPane />}
        {activeTab === "general" && <GeneralPane />}
        {activeTab === "about" && <AboutPane />}
      </div>
    </div>
  );
}
