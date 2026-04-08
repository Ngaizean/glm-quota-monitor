import { useState } from "react";

export default function GeneralPane() {
  const [refreshInterval, setRefreshInterval] = useState(5);
  const [autoStart, setAutoStart] = useState(true);

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">通用设置</h2>

      <div className="space-y-3">
        {/* 刷新间隔 */}
        <div className="bg-neutral-800 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm">刷新间隔</span>
            <span className="text-xs text-neutral-400">
              {refreshInterval} 分钟
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={30}
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-[10px] text-neutral-600 mt-1">
            <span>1min</span>
            <span>30min</span>
          </div>
        </div>

        {/* 开机自启 */}
        <div className="bg-neutral-800 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm">开机自启</span>
          <button
            onClick={() => setAutoStart(!autoStart)}
            className={`w-9 h-5 rounded-full transition-colors relative ${
              autoStart ? "bg-blue-600" : "bg-neutral-600"
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                autoStart ? "left-[18px]" : "left-0.5"
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
