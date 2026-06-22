/**
 * 主题模式管理 — light / dark / system 三种模式
 * - system: 跟随操作系统 prefers-color-scheme（默认，向后兼容）
 * - light:  强制浅色（设置 data-mode="light"）
 * - dark:   强制深色（设置 data-mode="dark"）
 *
 * 配合 index.css: :root[data-mode="dark"] 与 :root:not([data-mode="light"]) media query
 */

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "theme-mode";

export function getStoredMode(): ThemeMode {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

/** 应用模式到 <html data-mode="...">；system 模式移除属性以走 media query */
export function applyMode(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-mode");
  } else {
    root.setAttribute("data-mode", mode);
  }
}

export function setMode(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  applyMode(mode);
}

/** 当前 OS 是否为深色（供组件判断） */
export function systemPrefersDark(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
