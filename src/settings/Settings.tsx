import { useState } from "react";
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

export default function Settings() {
  const [activeTab, setActiveTab] = useState("accounts");

  return (
    <div className="h-full bg-neutral-900 text-white flex flex-col">
      {/* 标签栏 */}
      <div className="flex border-b border-neutral-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? "text-blue-400 border-b-2 border-blue-400"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "accounts" && <AccountsPane />}
        {activeTab === "alerts" && <AlertsPane />}
        {activeTab === "general" && <GeneralPane />}
        {activeTab === "about" && <AboutPane />}
      </div>
    </div>
  );
}
