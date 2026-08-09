import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadIcon, ExternalLinkIcon, RefreshIcon } from "../components/icons";
import { Button } from "../components/ui/Button";
import { StatusNotice } from "../components/ui/StatusNotice";
import { version as APP_VERSION } from "../../package.json";
import SettingsSection from "./components/SettingsSection";

type Status =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; progress: number; total: number }
  | { kind: "installing" }
  | { kind: "upToDate" }
  | { kind: "error"; message: string }
  | { kind: "noSource" };

const GITHUB_RELEASES_URL = "https://github.com/Ngaizean/glm-quota-monitor/releases/latest";

async function openExternal(url: string) {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AboutPane() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [version, setVersion] = useState(APP_VERSION);

  useEffect(() => {
    let disposed = false;
    getVersion()
      .then((value) => {
        if (!disposed) setVersion(value);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  async function handleCheckUpdate() {
    setStatus({ kind: "checking" });
    try {
      const update = await check();
      setStatus(update?.available ? { kind: "available", update } : { kind: "upToDate" });
    } catch (error) {
      const message = String(error).toLowerCase();
      if (
        message.includes("release json")
        || message.includes("404")
        || message.includes("not found")
      ) {
        setStatus({ kind: "noSource" });
      } else if (
        message.includes("network")
        || message.includes("connection")
        || message.includes("timeout")
        || message.includes("fetch")
        || message.includes("dns")
      ) {
        setStatus({ kind: "error", message: t("aboutPane.updateNetworkError") });
      } else {
        setStatus({ kind: "error", message: t("aboutPane.checkFailed") });
      }
    }
  }

  async function handleDownloadAndInstall() {
    if (status.kind !== "available") return;
    const update = status.update;
    try {
      let total = 0;
      let downloaded = 0;
      setStatus({ kind: "downloading", progress: 0, total: 0 });
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
          setStatus({ kind: "downloading", progress: downloaded, total });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setStatus({ kind: "downloading", progress: downloaded, total });
        }
      });
      setStatus({ kind: "installing" });
      await relaunch();
    } catch (error) {
      setStatus({
        kind: "error",
        message: `${t("aboutPane.downloadFailed")}: ${String(error)}`,
      });
    }
  }

  const progress = status.kind === "downloading" && status.total > 0
    ? Math.min(100, Math.round((status.progress / status.total) * 100))
    : 0;

  return (
    <div className="space-y-4">
      <SettingsSection>
        <div className="flex items-center gap-5 p-6">
          <div
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-lg"
            style={{ background: "linear-gradient(135deg, var(--color-accent), var(--color-accent-hover))" }}
            aria-hidden="true"
          >
            G
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-[var(--color-text-primary)]">
              {t("aboutPane.appName")}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
              {t("aboutPane.appDesc")}
            </p>
            <span className="mt-2 inline-flex rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] px-2 py-1 text-[11px] font-medium tabular-nums text-[var(--color-text-secondary)]">
              v{version}
            </span>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t("aboutPane.updatesTitle")} description={t("aboutPane.updatesDesc")}>
        <div className="space-y-4 p-5">
          {status.kind === "upToDate" && (
            <StatusNotice tone="success">{t("aboutPane.upToDate")}</StatusNotice>
          )}
          {status.kind === "error" && (
            <StatusNotice tone="danger">{status.message}</StatusNotice>
          )}
          {status.kind === "noSource" && (
            <StatusNotice tone="warning">
              {t("aboutPane.updateSourceUnavailable")}
            </StatusNotice>
          )}
          {status.kind === "available" && (
            <StatusNotice tone="info" title={t("aboutPane.foundNew", { version: status.update.version })}>
              {status.update.body && (
                <span className="block max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {status.update.body}
                </span>
              )}
            </StatusNotice>
          )}
          {status.kind === "downloading" && (
            <div className="space-y-2" role="status" aria-live="polite">
              <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                <span>{t("aboutPane.downloading", { progress })}</span>
                {status.total > 0 && (
                  <span className="tabular-nums text-[var(--color-text-tertiary)]">
                    {formatBytes(status.progress)} / {formatBytes(status.total)}
                  </span>
                )}
              </div>
              <div
                role="progressbar"
                aria-label={t("aboutPane.downloading", { progress })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progress}
                className="h-2 overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]"
              >
                <div className="h-full rounded-full bg-[var(--color-accent)] transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
          {status.kind === "installing" && (
            <StatusNotice tone="info">{t("aboutPane.installing")}</StatusNotice>
          )}

          <div className="flex flex-wrap gap-3">
            {(status.kind === "idle"
              || status.kind === "checking"
              || status.kind === "upToDate"
              || status.kind === "error"
              || status.kind === "noSource") && (
              <Button
                variant="primary"
                leadingIcon={<RefreshIcon size={15} />}
                loading={status.kind === "checking"}
                loadingLabel={t("aboutPane.checking")}
                onClick={() => void handleCheckUpdate()}
              >
                {t("aboutPane.checkUpdate")}
              </Button>
            )}
            {status.kind === "available" && (
              <Button
                variant="primary"
                leadingIcon={<DownloadIcon size={15} />}
                onClick={() => void handleDownloadAndInstall()}
              >
                {t("aboutPane.downloadAndInstall")}
              </Button>
            )}
            <Button
              leadingIcon={<ExternalLinkIcon size={15} />}
              onClick={() => void openExternal(GITHUB_RELEASES_URL)}
            >
              {t("aboutPane.goToGithub")}
            </Button>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
