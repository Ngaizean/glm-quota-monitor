import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type ThemeMode, getStoredMode, setMode, applyMode } from "../lib/theme";

const THEMES = [
  { id: "default", color: "#5B5FC7", hover: "#4F46E5", subtle: "#ECEFFD" },
  { id: "ocean", color: "#0EA5E9", hover: "#0284C7", subtle: "#E0F2FE" },
  { id: "forest", color: "#10B981", hover: "#059669", subtle: "#D1FAE5" },
  { id: "sunset", color: "#F97316", hover: "#EA580C", subtle: "#FFF7ED" },
] as const;

const MODES: { id: ThemeMode; icon: string }[] = [
  { id: "system", icon: "🖥" },
  { id: "light", icon: "☀" },
  { id: "dark", icon: "☾" },
];

function applyAccent(themeId: string) {
  const theme = THEMES.find((t) => t.id === themeId);
  const root = document.documentElement;
  if (theme && theme.id !== "default") {
    root.setAttribute("data-theme", theme.id);
    root.style.setProperty("--color-accent", theme.color);
    root.style.setProperty("--color-accent-hover", theme.hover);
    root.style.setProperty("--color-accent-subtle", theme.subtle);
  } else {
    root.removeAttribute("data-theme");
    // default 主题重置为 CSS 默认值（由 data-mode/media query 决定深浅）
    const isDark = root.getAttribute("data-mode") === "dark"
      || (root.getAttribute("data-mode") !== "light"
          && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) {
      root.style.setProperty("--color-accent", "#7C7FDD");
      root.style.setProperty("--color-accent-hover", "#9295F0");
      root.style.setProperty("--color-accent-subtle", "#2A2D45");
    } else {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-hover");
      root.style.removeProperty("--color-accent-subtle");
    }
  }
}

export default function ThemePane() {
  const { t } = useTranslation();
  const [accent, setAccent] = useState(() => localStorage.getItem("theme") || "default");
  const [mode, setModeState] = useState<ThemeMode>(() => getStoredMode());

  // 初始化时应用持久化的 mode 和 accent
  useEffect(() => {
    applyMode(mode);
  }, [mode]);

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  function selectAccent(id: string) {
    setAccent(id);
    localStorage.setItem("theme", id);
  }

  function selectMode(m: ThemeMode) {
    setModeState(m);
    setMode(m);
    // 重新应用 accent，因为 default 主题依赖当前明暗
    applyAccent(accent);
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
          {THEMES.map((theme) => (
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
                className={`w-8 h-8 rounded-lg shadow-sm ${accent === theme.id ? "ring-2 ring-offset-1 ring-offset-[var(--color-bg-secondary)]" : ""}`}
                style={{ backgroundColor: theme.color, ...(accent === theme.id ? { boxShadow: `0 0 0 2px ${theme.color}` } : {}) }}
              />
              <span className="text-[9px] font-medium text-[var(--color-text-secondary)]">
                {t(`theme.${theme.id}`)}
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
          <button
            className="text-[10px] font-semibold px-3 py-1.5 bg-[var(--color-accent)] text-white rounded-lg"
            style={{ cursor: "default" }}
          >
            {t("theme.previewPrimary")}
          </button>
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
