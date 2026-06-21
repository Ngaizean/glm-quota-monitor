import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import type { Update } from "@tauri-apps/plugin-updater";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; progress: number; total: number }
  | { kind: "downloaded" }
  | { kind: "installing" }
  | { kind: "upToDate" }
  | { kind: "error"; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function AboutPane() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [version, setVersion] = useState("5.1.0");

  // 首次渲染读取真实版本号
  if (version === "5.1.0") {
    getVersion().then((v) => setVersion(v)).catch(() => {});
  }

  async function handleCheckUpdate() {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      if (update?.available) {
        setStatus({ kind: "available", update });
      } else {
        setStatus({ kind: "upToDate" });
      }
    } catch (e) {
      setStatus({ kind: "error", message: t("aboutPane.checkFailed") + ": " + String(e) });
    }
  }

  async function handleDownloadAndInstall() {
    if (status.kind !== "available") return;
    const update = status.update;
    try {
      setStatus({ kind: "downloading", progress: 0, total: 0 });
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setStatus({ kind: "downloading", progress: downloaded, total });
            break;
          case "Finished":
            setStatus({ kind: "downloaded" });
            break;
        }
      });
      // 下载+安装完成，重启应用
      setStatus({ kind: "installing" });
      await relaunch();
    } catch (e) {
      setStatus({ kind: "error", message: t("aboutPane.downloadFailed") + ": " + String(e) });
    }
  }

  const pct = status.kind === "downloading" && status.total > 0
    ? Math.round((status.progress / status.total) * 100)
    : 0;

  return (
    <div className="flex flex-col items-center justify-center py-10 space-y-4">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-xl font-bold shadow-lg"
        style={{
          background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))",
          boxShadow: "0 8px 24px color-mix(in srgb, var(--color-accent) 25%, transparent)",
        }}
      >
        G
      </div>
      <div className="text-center space-y-1.5">
        <h2 className="text-[14px] font-semibold tracking-tight text-[var(--color-text-primary)]">
          {t("aboutPane.appName")}
        </h2>
        <span className="inline-block text-[10px] font-medium text-[var(--color-text-tertiary)] bg-[var(--color-bg-secondary)] px-2 py-0.5 rounded-md border border-[var(--color-border-subtle)] tabular-nums">
          v{version}
        </span>
      </div>
      <p
        className="text-[11px] text-[var(--color-text-tertiary)] text-center leading-relaxed"
        dangerouslySetInnerHTML={{ __html: t("aboutPane.appDesc") }}
      />

      {/* 更新操作区 */}
      <div className="flex flex-col items-center gap-2 w-full max-w-[220px]">
        {/* 检查更新按钮（idle / checking / upToDate / error 时显示） */}
        {(status.kind === "idle" || status.kind === "checking" || status.kind === "upToDate" || status.kind === "error") && (
          <>
            <button
              onClick={handleCheckUpdate}
              disabled={status.kind === "checking"}
              className="w-full text-[11px] font-medium px-4 py-1.5 bg-[var(--color-bg-secondary)] hover:bg-[var(--color-bg-tertiary)] border border-[var(--color-border-subtle)] rounded-lg text-[var(--color-text-secondary)] transition-[var(--transition-fast)] disabled:opacity-40 flex items-center justify-center gap-1.5"
            >
              {status.kind === "checking" && (
                <span className="w-3 h-3 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
              )}
              {status.kind === "checking" ? t("aboutPane.checking") : t("aboutPane.checkUpdate")}
            </button>
            {status.kind === "upToDate" && (
              <span className="text-[10px] text-[var(--color-success)]">✓ {t("aboutPane.upToDate")}</span>
            )}
            {status.kind === "error" && (
              <span className="text-[10px] text-[var(--color-danger)] text-center">{status.message}</span>
            )}
          </>
        )}

        {/* 发现新版本 — 下载安装按钮 */}
        {status.kind === "available" && (
          <>
            <span className="text-[11px] font-medium text-[var(--color-accent)]">
              {t("aboutPane.foundNew", { version: status.update.version })}
            </span>
            {status.update.body && (
              <p className="text-[10px] text-[var(--color-text-tertiary)] text-center leading-relaxed max-h-24 overflow-y-auto scroll-area px-2">
                {status.update.body}
              </p>
            )}
            <button
              onClick={handleDownloadAndInstall}
              className="w-full text-[11px] font-semibold px-4 py-2 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded-lg transition-[var(--transition-fast)] shadow-sm flex items-center justify-center gap-1.5"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t("aboutPane.installAndRestart")}
            </button>
          </>
        )}

        {/* 下载进度 */}
        {status.kind === "downloading" && (
          <div className="w-full space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-[var(--color-text-tertiary)]">
              <span>{t("aboutPane.downloading", { progress: pct })}</span>
              {status.total > 0 && (
                <span className="tabular-nums">
                  {formatBytes(status.progress)} / {formatBytes(status.total)}
                </span>
              )}
            </div>
            <div className="w-full h-2 bg-[var(--color-bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--color-accent)] rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* 安装中 */}
        {(status.kind === "downloaded" || status.kind === "installing") && (
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]">
            <div className="w-3 h-3 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin" />
            {status.kind === "downloaded" ? t("aboutPane.readyToInstall") : t("aboutPane.installing")}
          </div>
        )}
      </div>

      <a
        href="https://github.com/Ngaizean/glm-quota-monitor"
        target="_blank"
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-accent)] hover:text-[var(--color-accent-hover)] transition-[var(--transition-fast)] mt-1 px-3 py-1.5 rounded-lg hover:bg-[var(--color-accent-subtle)]"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
        </svg>
        GitHub
      </a>
    </div>
  );
}
