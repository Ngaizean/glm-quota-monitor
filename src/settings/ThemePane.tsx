import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

const THEMES = [
  { id: "default", color: "#5B5FC7", hover: "#4F46E5", subtle: "#ECEFFD" },
  { id: "ocean", color: "#0EA5E9", hover: "#0284C7", subtle: "#E0F2FE" },
  { id: "forest", color: "#10B981", hover: "#059669", subtle: "#D1FAE5" },
  { id: "sunset", color: "#F97316", hover: "#EA580C", subtle: "#FFF7ED" },
] as const;

function applyTheme(themeId: string) {
  const theme = THEMES.find((t) => t.id === themeId);
  const root = document.documentElement;
  if (theme && theme.id !== "default") {
    root.setAttribute("data-theme", theme.id);
    root.style.setProperty("--color-accent", theme.color);
    root.style.setProperty("--color-accent-hover", theme.hover);
    root.style.setProperty("--color-accent-subtle", theme.subtle);
  } else {
    root.removeAttribute("data-theme");
    // Reset to CSS defaults
    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
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
  const [active, setActive] = useState(() => {
    return localStorage.getItem("theme") || "default";
  });

  useEffect(() => {
    applyTheme(active);
  }, [active]);

  function selectTheme(id: string) {
    setActive(id);
    localStorage.setItem("theme", id);
  }

  return (
    <div className="space-y-3">
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-3">
        <span className="text-xs font-medium text-[var(--color-text-primary)] block">
          {t("theme.accentColor")}
        </span>
        <div className="grid grid-cols-4 gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => selectTheme(theme.id)}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-200 ${
                active === theme.id
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] shadow-sm"
                  : "border-[var(--color-border-subtle)] hover:border-[var(--color-border)]"
              }`}
            >
              <div
                className="w-8 h-8 rounded-lg shadow-sm"
                style={{ backgroundColor: theme.color }}
              />
              <span className="text-[9px] font-medium text-[var(--color-text-secondary)]">
                {t(`theme.${theme.id}`)}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="bg-[var(--color-bg-secondary)] rounded-xl border border-[var(--color-border-subtle)] p-3.5 space-y-2">
        <span className="text-[10px] font-medium text-[var(--color-text-tertiary)] block">
          {t("theme.preview")}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="text-[10px] font-semibold px-3 py-1.5 bg-[var(--color-accent)] text-white rounded-lg"
            style={{ cursor: "default" }}
          >
            Primary
          </button>
          <span className="text-[10px] font-medium text-[var(--color-accent)]">Accent Text</span>
          <div className="flex-1 h-2 bg-[var(--color-accent-subtle)] rounded-full overflow-hidden">
            <div className="h-full w-3/5 bg-[var(--color-accent)] rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
