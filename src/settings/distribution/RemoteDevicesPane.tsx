import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { SelectField, TextField } from "../../components/ui/Field";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { Toggle } from "../../components/ui/Toggle";
import type { SshHost } from "../codex/types";
import { RemoteClaudeControl } from "./RemoteClaudeControl";
import type { CodexDevice, CodexProfile } from "./types";
import { useDistribution } from "./useDistribution";

export default function RemoteDevicesPane() {
  const { t } = useTranslation();
  const state = useDistribution();
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [hostError, setHostError] = useState("");
  const scan = useCallback(async () => {
    try {
      setHosts(await invoke<SshHost[]>("scan_ssh_hosts"));
      setHostError("");
    } catch (error) {
      setHostError(String(error));
    }
  }, []);
  useEffect(() => {
    void scan();
  }, [scan]);
  const displayedHosts = [
    ...hosts,
    ...state.data.devices
      .filter((d) => !hosts.some((h) => h.alias === d.host))
      .map((d) => ({
        alias: d.host,
        hostname: d.host,
        user: "",
        port: 22,
        identity_file: null,
        has_local_key: false,
      })),
  ];
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="secondary"
          disabled={state.busy}
          onClick={() => {
            void scan();
            void state.refresh();
          }}
        >
          {t("codexPane.sshScan")}
        </Button>
      </div>
      {(state.error || hostError) && (
        <StatusNotice tone="danger">{state.error || hostError}</StatusNotice>
      )}
      {state.loading && (
        <StatusNotice>{t("codexPane.loadingSettings")}</StatusNotice>
      )}
      {!state.loading && displayedHosts.length === 0 && (
        <StatusNotice>{t("codexPane.sshNoHosts")}</StatusNotice>
      )}
      {displayedHosts.map((host) => (
        <DeviceRow
          key={host.alias}
          host={host}
          accounts={state.data.accounts}
          saved={state.data.devices.find((d) => d.host === host.alias)}
          busy={state.busy}
          run={state.run}
        />
      ))}
    </div>
  );
}

function DeviceRow({
  host,
  accounts,
  saved,
  busy,
  run,
}: {
  host: SshHost;
  accounts: CodexProfile[];
  saved?: CodexDevice;
  busy: boolean;
  run: ReturnType<typeof useDistribution>["run"];
}) {
  const { t } = useTranslation();
  // 该设备的同步目标：Codex 账号或 Claude Code，二者绑定互不干扰
  const [target, setTarget] = useState<"codex" | "claude">("codex");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CodexDevice | null>(null);
  const [password, setPassword] = useState("");
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  // 打开绑定对话框时检测远端是否安装 Codex；未安装则显示不支持并禁止绑定。
  const [codexInstalled, setCodexInstalled] = useState<boolean | null>(null);
  const begin = () => {
    setError("");
    setDraft(
      saved ?? {
        host: host.alias,
        account_id: null,
        follow_local: false,
        model: "",
        reasoning_effort: "",
        auto_sync: false,
        status: "bound",
        last_sync: null,
        last_error: null,
      },
    );
    setEditing(true);
    setCodexInstalled(null);
    invoke<boolean>("ssh_check_codex", { host: host.alias, password: null })
      .then(setCodexInstalled)
      .catch(() => setCodexInstalled(null));
  };
  async function sync() {
    await run(async () => {
      const stored = await invoke<boolean>("has_ssh_password", {
        host: host.alias,
      });
      if (
        !stored &&
        !(await invoke<boolean>("check_ssh_passwordless", { host: host.alias }))
      ) {
        setPassword("");
        setRemember(false);
        setPasswordOpen(true);
        return;
      }
      await invoke("sync_codex_device", { host: host.alias, password: null });
    });
  }
  const account = accounts.find((a) => a.account_id === saved?.account_id);
  const metaParts = [
    saved?.follow_local
      ? t("distribution.followLocal")
      : (account?.alias ?? t("distribution.selectAccount")),
    saved?.model,
    saved?.last_sync
      ? `${t("distribution.lastVerified")} ${new Date(saved.last_sync).toLocaleString()}`
      : null,
  ].filter(Boolean);
  return (
    <article className="space-y-2.5 rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-all text-sm font-semibold">
          {host.alias}
          <span className="ml-2 text-xs font-normal text-[var(--color-text-tertiary)]">
            {host.user}@{host.hostname}:{host.port}
          </span>
        </h3>
        <span className="shrink-0 text-xs">
          {t(`distribution.status.${saved?.status ?? "unbound"}`)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-[var(--color-text-secondary)]">
          {metaParts.join(" · ")}
        </p>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--color-text-secondary)]">
          {t("distribution.syncTarget")}
          <select
            value={target}
            onChange={(event) =>
              setTarget(event.target.value === "claude" ? "claude" : "codex")
            }
            className="min-h-7 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
          </select>
        </label>
      </div>
      {target === "codex" && (
        <>
          {saved?.last_error && (
            <StatusNotice tone="danger">{saved.last_error}</StatusNotice>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-2.5">
            <Button size="sm" variant="secondary" disabled={busy} onClick={begin}>
              {t("distribution.bindAccount")}
            </Button>
            <Button
              size="sm"
              disabled={
                busy || !saved || (!saved.account_id && !saved.follow_local)
              }
              onClick={() => {
                void sync();
              }}
            >
              {t("distribution.syncNow")}
            </Button>
            {saved && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void run(() =>
                    invoke("unbind_codex_device", { host: host.alias }),
                  );
                }}
              >
                {t("distribution.unbind")}
              </Button>
            )}
            <label className="ml-auto flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
              {t("distribution.autoSync")}
              <Toggle
                checked={saved?.auto_sync ?? false}
                disabled={
                  busy || !saved || (!saved.account_id && !saved.follow_local)
                }
                aria-label={t("distribution.autoSync")}
                onCheckedChange={(checked) => {
                  if (saved)
                    void run(() =>
                      invoke("bind_codex_device", {
                        device: { ...saved, auto_sync: checked },
                      }),
                    );
                }}
              />
            </label>
          </div>
        </>
      )}
      {target === "claude" && <RemoteClaudeControl host={host.alias} />}
      <Dialog
        open={editing}
        onOpenChange={(open) => {
          if (!busy) setEditing(open);
        }}
        title={`${t("distribution.bindAccount")} · ${host.alias}`}
        footer={
          <Button
            loading={busy}
            disabled={
              !draft ||
              (!draft.account_id && !draft.follow_local) ||
              codexInstalled === false
            }
            onClick={() => {
              void run(async () => {
                try {
                  await invoke("bind_codex_device", { device: draft });
                  setEditing(false);
                } catch (e) {
                  setError(String(e));
                  throw e;
                }
              });
            }}
          >
            {t("common.save")}
          </Button>
        }
      >
        {draft && (
          <div className="space-y-3">
            {error && <StatusNotice tone="danger">{error}</StatusNotice>}
            {codexInstalled === false && (
              <StatusNotice tone="danger">
                {t("codexPane.sshCodexNotInstalled")}
              </StatusNotice>
            )}
            {codexInstalled === null && (
              <p className="text-xs text-[var(--color-text-tertiary)]">
                {t("codexPane.sshCodexChecking")}
              </p>
            )}
            <SelectField
              label={t("distribution.selectAccount")}
              value={draft.follow_local ? "__local" : (draft.account_id ?? "")}
              disabled={busy}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  follow_local: e.target.value === "__local",
                  account_id:
                    e.target.value === "__local"
                      ? null
                      : e.target.value || null,
                })
              }
            >
              <option value="">{t("distribution.selectAccount")}</option>
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.alias} · {t(`distribution.${a.kind}`)}
                </option>
              ))}
              <option value="__local">{t("distribution.followLocal")}</option>
            </SelectField>
            <TextField
              label={t("distribution.deviceModel")}
              placeholder={t("distribution.inherit")}
              value={draft.model}
              disabled={busy}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
            />
            <SelectField
              label={t("distribution.effort")}
              value={draft.reasoning_effort}
              disabled={busy}
              onChange={(e) =>
                setDraft({ ...draft, reasoning_effort: e.target.value })
              }
            >
              <option value="">{t("distribution.inherit")}</option>
              {["none", "minimal", "low", "medium", "high", "xhigh"].map(
                (v) => (
                  <option key={v}>{v}</option>
                ),
              )}
            </SelectField>
          </div>
        )}
      </Dialog>
      <Dialog
        open={passwordOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setPasswordOpen(open);
            setPassword("");
          }
        }}
        title={`${t("codexPane.sshNeedPasswordTitle")} · ${host.alias}`}
        footer={
          <Button
            loading={busy}
            disabled={!password}
            onClick={() => {
              void run(async () => {
                try {
                  await invoke("sync_codex_device", {
                    host: host.alias,
                    password,
                  });
                  if (remember)
                    await invoke("set_ssh_password", {
                      host: host.alias,
                      password,
                    });
                  setPasswordOpen(false);
                  setPassword("");
                } catch (e) {
                  setError(String(e));
                  throw e;
                }
              });
            }}
          >
            {t("distribution.syncNow")}
          </Button>
        }
      >
        <div className="space-y-3">
          {error && <StatusNotice tone="danger">{error}</StatusNotice>}
          <TextField
            label={t("codexPane.sshPasswordPlaceholder")}
            type="password"
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("distribution.rememberPassword")}</span>
            <Toggle
              checked={remember}
              onCheckedChange={setRemember}
              disabled={busy}
            />
          </label>
        </div>
      </Dialog>
    </article>
  );
}
