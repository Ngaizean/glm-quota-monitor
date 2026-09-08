export function isTauriRuntime(): boolean {
  // 预览模式注入了模拟 IPC（dev/previewInvoke），不是真实 Tauri 环境；
  // 否则窗口布局等原生调用会在浏览器里崩溃。
  if (isPreviewMode()) return false;
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isPreviewRequest(isDevelopment: boolean, search: string): boolean {
  return isDevelopment && new URLSearchParams(search).has("preview");
}

export function isPreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  return isPreviewRequest(import.meta.env.DEV, window.location.search);
}

export function getPreviewPage(): "quota" | "settings" | null {
  if (!isPreviewMode()) return null;
  return new URLSearchParams(window.location.search).get("preview") === "settings"
    ? "settings"
    : "quota";
}
