import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Surface } from "../../components/ui/Surface";
import { Toggle } from "../../components/ui/Toggle";
import type { SshHost } from "./types";
import type { CodexController } from "./useCodexController";

const PLATFORM_BADGE: Record<string, { label: string; className: string }> = {
  glm: { label: "GLM", className: "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]" },
  deepseek: { label: "DeepSeek", className: "bg-purple-500/10 text-purple-500" },
  unknown: { label: "?", className: "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]" },
};

interface HostCardProps {
  host: SshHost;
  controller: CodexController;
}

export function HostCard({ host, controller }: HostCardProps) {
  const { t } = useTranslation();
  const autoEnabled = controller.autoOverrides[host.alias] ?? false;
  const pending = controller.pendingHosts.has(host.alias);
  const checking = controller.checkingHosts.has(host.alias);
  const state = controller.ccStates[host.alias];
  const badge = state ? PLATFORM_BADGE[state.platform] ?? PLATFORM_BADGE.unknown : null;

  return (
    <Surface tone="primary" padding="md" className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <strong className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]" title={host.alias}>
              {host.alias}
            </strong>
            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
              autoEnabled
                ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                : host.has_local_key
                  ? "bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)]"
                  : "bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
            }`}>
              {autoEnabled
                ? t("codexPane.sshAutoOverride")
                : host.has_local_key
                  ? t("codexPane.sshLocalKey")
                  : t("codexPane.sshNoLocalKey")}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-[var(--color-text-tertiary)]" title={`${host.user}@${host.hostname}:${host.port}`}>
            {host.user}@{host.hostname}:{host.port}
          </div>
        </div>
        <Button
          size="sm"
          variant="primary"
          loading={pending}
          loadingLabel={t("codexPane.sshPushing")}
          disabled={controller.initializing}
          onClick={() => { void controller.pushHost(host); }}
        >
          {t("codexPane.sshPush")}
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 border-t border-[var(--color-border-subtle)] pt-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-[var(--color-text-primary)]">
            {t("codexPane.sshAutoOverride")}
          </div>
          <p className="mt-1 text-xs leading-5 text-[var(--color-text-tertiary)]">
            {t("codexPane.sshAutoOverrideDesc")}
          </p>
        </div>
        <Toggle
          checked={autoEnabled}
          disabled={controller.initializing || pending}
          aria-label={t("codexPane.sshAutoOverrideFor", { host: host.alias })}
          onCheckedChange={(enabled) => { void controller.toggleAutoOverride(host.alias, enabled); }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-subtle)] pt-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className="shrink-0 text-[var(--color-text-tertiary)]">Claude Code</span>
          {checking ? (
            <span className="text-[var(--color-text-tertiary)]">{t("codexPane.sshCcChecking")}</span>
          ) : state?.installed ? (
            state.base_url ? (
              <>
                {badge && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>}
                {state.model && <span className="min-w-0 truncate font-mono text-[var(--color-text-secondary)]" title={state.model}>{state.model}</span>}
              </>
            ) : <span className="text-[var(--color-text-tertiary)]">{t("codexPane.sshCcNoBinding")}</span>
          ) : state === null || state === undefined ? (
            <span className="text-[var(--color-text-tertiary)]">{t("codexPane.sshCcUnknown")}</span>
          ) : (
            <span className="text-[var(--color-text-tertiary)]">{t("codexPane.sshCcNotInstalled")}</span>
          )}
        </div>
        {state?.installed && (
          <div className="flex shrink-0 items-center gap-1">
            {state.model && (
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => { void controller.unbindRemote(host); }}>
                {t("codexPane.sshCcUnbind")}
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => { void controller.openRemoteBinding(host); }}>
              {t("codexPane.sshCcSwitch")}
            </Button>
          </div>
        )}
      </div>
    </Surface>
  );
}
