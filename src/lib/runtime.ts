export function isTauriRuntime(): boolean {
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
