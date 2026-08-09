/**
 * 主题模式管理 — light / dark / system 三种模式
 * - system: 跟随操作系统 prefers-color-scheme（默认，向后兼容）
 * - light:  强制浅色（设置 data-mode="light"）
 * - dark:   强制深色（设置 data-mode="dark"）
 *
 * 配合 index.css: :root[data-mode="dark"] 与 :root:not([data-mode="light"]) media query
 */

export type ThemeMode = "light" | "dark" | "system";
export type AccentTheme = "default" | "ocean" | "forest" | "sunset";

const MODE_STORAGE_KEY = "theme-mode";
const ACCENT_STORAGE_KEY = "theme";
const LANGUAGE_STORAGE_KEY = "lang";

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // WebView 隐私设置可能禁止访问 localStorage，外观初始化仍应继续。
  }
  return null;
}

function storePreference(key: string, value: string) {
  try {
    getStorage()?.setItem(key, value);
  } catch {
    // 持久化失败不应阻止当前会话应用用户选择。
  }
}

export function getStoredMode(): ThemeMode {
  const v = getStorage()?.getItem(MODE_STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function getStoredAccent(): AccentTheme {
  const value = getStorage()?.getItem(ACCENT_STORAGE_KEY);
  return value === "ocean" || value === "forest" || value === "sunset"
    ? value
    : "default";
}

/** 应用模式到 <html data-mode="...">；system 模式移除属性以走 media query */
export function applyMode(mode: ThemeMode, root?: HTMLElement) {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;
  if (mode === "system") {
    target.removeAttribute("data-mode");
  } else {
    target.setAttribute("data-mode", mode);
  }
}

export function applyAccent(accent: AccentTheme, root?: HTMLElement) {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  if (!target) return;
  if (accent === "default") {
    target.removeAttribute("data-theme");
  } else {
    target.setAttribute("data-theme", accent);
  }
}

export function setMode(mode: ThemeMode) {
  storePreference(MODE_STORAGE_KEY, mode);
  applyMode(mode);
}

export function setAccent(accent: AccentTheme) {
  storePreference(ACCENT_STORAGE_KEY, accent);
  applyAccent(accent);
}

/**
 * 在 React 挂载前恢复会影响首帧的 DOM 属性，避免主题闪烁。
 * 无效或缺失的持久化值统一回落到 system/default/zh-CN。
 */
export function initializeAppearance(root?: HTMLElement) {
  if (typeof document === "undefined") return;

  const target = root ?? document.documentElement;
  applyMode(getStoredMode(), target);
  applyAccent(getStoredAccent(), target);

  const language = getStorage()?.getItem(LANGUAGE_STORAGE_KEY);
  target.lang = language === "en" ? "en" : "zh-CN";
}

/** 当前 OS 是否为深色（供组件判断） */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
