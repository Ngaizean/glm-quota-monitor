import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type ThemeMode, getStoredMode, setMode, applyMode } from "../lib/theme";

/** accent 色的展示用色值（仅用于 ThemePane 的色块预览，不写入 CSS 变量） */
const THEME_SWATCHES = [
  { id: "default", color: "#5B5FC7", labelKey: "theme.default" },
  { id: "ocean", color: "#0EA5E9", labelKey: "theme.ocean" },
  { id: "forest", color: "#10B981", labelKey: "theme.forest" },
  { id: "sunset", color: "#F97316", labelKey: "theme.sunset" },
] as const;

const MODES: { id: ThemeMode; icon: string }[] = [
  { id: "system", icon: "🖥" },
  { id: "light", icon: "☀" },
  { id: "dark", icon: "☾" },
];

export default function ThemePane() {
  const { t } = useTranslation();
  const [accent, setAccent] = useState(() => localStorage.getItem("theme") || "default");
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());

  // 挂载时同步持久化的 mode/accent 到 DOM
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  useEffect(() => {
    const root = document.documentElement;
    if (accent === "default") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", accent);
    }
  }, [accent]);

  function selectAccent(id: string) {
    setAccent(id);
    localStorage.setItem("theme", id);
  }

  function selectMode(m: ThemeMode) {
    setModeState(m);
    setMode(m);
  }

  return (
    <div className="space-y-3">
      {/* 外观模式：system / light / dark */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <span className="text-xs font-medium text-[var(--color-text-primary)] block">
          {t("theme.mode")}
        </span>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => selectMode(m.id)}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-200 ${
                mode === m.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)]"
                  : "border-[var(--color-border-subtle)] hover:border-[var(--color-border)]"
              }`}
            >
              <span className="text-base leading-none">{m.icon}</span>
              <span className="text-[9px] font-medium text-[var(--color-text-secondary)]">
                {t(`theme.mode${m.id.charAt(0).toUpperCase() + m.id.slice(1)}`)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 强调色 accent */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <span className="text-xs font-medium text-[var(--color-text-primary)] block">
          {t("theme.accentColor")}
        </span>
        <div className="grid grid-cols-4 gap-2">
          {THEME_SWATCHES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => selectAccent(theme.id)}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-200 ${
                accent === theme.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] shadow-sm"
                  : "border-[var(--color-border-subtle)] hover:border-[var(--color-border)]"
              }`}
            >
              <div
                className="w-8 h-8 rounded-lg shadow-sm"
                style={{
                  backgroundColor: theme.color,
                  boxShadow: accent === theme.id ? `0 0 0 2px ${theme.color}` : undefined,
                }}
              />
              <span className="text-[9px] font-medium text-[var(--color-text-secondary)]">
                {t(theme.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 预览 */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2">
        <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] block">
          {t("theme.preview")}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold px-3 py-1.5 text-white rounded-lg"
            style={{ background: "var(--color-accent)", cursor: "default" }}
          >
            {t("theme.previewPrimary")}
          </span>
          <span className="text-[10px] font-medium text-[var(--color-accent)]">
            {t("theme.previewAccentText")}
          </span>
          <div className="flex-1 h-2 bg-[var(--color-accent-subtle)] rounded-full overflow-hidden">
            <div className="h-full w-3/5 bg-[var(--color-accent)] rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
