import { invoke } from "@tauri-apps/api/core";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { TextField, SelectField } from "../../components/ui/Field";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { IconButton } from "../../components/ui/IconButton";
import {
  CheckIcon,
  ChevronDownIcon,
  TrashIcon,
  EditIcon,
} from "../../components/icons";
import { useDistribution } from "./useDistribution";
import type { CodexProfile } from "./types";
import type { AccountsController } from "../accounts/useAccountsController";

const newRelay = (): CodexProfile => ({
  account_id: "",
  alias: "",
  kind: "relay",
  base_url: "",
  model: "",
  reasoning_effort: "",
});

export function AccountProfiles({
  controller,
  onImportJson,
}: {
  controller: AccountsController;
  onImportJson: () => void;
}) {
  const { t } = useTranslation();
  const state = useDistribution();
  const [editing, setEditing] = useState<CodexProfile | null>(null);
  const [key, setKey] = useState("");
  const [usage, setUsage] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const manualRef = useRef<HTMLDetailsElement | null>(null);
  const disabled = state.loading || state.busy;
  const closeManual = () => manualRef.current?.removeAttribute("open");
  const field = (name: keyof CodexProfile, value: string) =>
    setEditing((p) => (p ? { ...p, [name]: value } : p));
  const edit = (p: CodexProfile) => {
    setKey("");
    setEditing({ ...p });
  };
  async function save() {
    if (!editing) return;
    if (
      await state.run(() =>
        invoke("save_codex_profile", { profile: editing, apiKey: key || null }),
      )
    ) {
      setEditing(null);
      setKey("");
      await controller.refresh(false);
    }
  }
  const repairSessions = () =>
    state.run(async () => {
      const report = await invoke<{ repaired: number; scanned: number }>(
        "repair_codex_sessions",
      );
      setNotice(
        t("distribution.sessionRepaired", {
          count: report.repaired,
          total: report.scanned,
        }),
      );
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <details ref={manualRef} className="group relative">
          <summary
            className="ui-button ui-button--sm ui-button--secondary list-none select-none gap-1.5 [&::-webkit-details-marker]:hidden"
            aria-label={t("distribution.importManual")}
          >
            {t("distribution.importManual")}
            <ChevronDownIcon
              size={13}
              className="transition-transform group-open:rotate-180"
            />
          </summary>
          <div
            role="menu"
            aria-label={t("distribution.importManual")}
            className="animate-slide-down absolute top-full left-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] shadow-md"
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
              onClick={() => {
                closeManual();
                edit(newRelay());
              }}
            >
              <span className="min-w-0 flex-1">
                {t("distribution.manualRelay")}
                <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                  {t("distribution.manualRelayDesc")}
                </span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 border-t border-[var(--color-border-subtle)] px-3 py-2.5 text-left text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]"
              onClick={() => {
                closeManual();
                void state.run(async () => {
                  await invoke("login_codex_official", { alias: null });
                  await controller.refresh(false);
                });
              }}
            >
              <span className="min-w-0 flex-1">
                {t("distribution.manualOfficial")}
                <span className="block text-[11px] text-[var(--color-text-tertiary)]">
                  {t("distribution.manualOfficialDesc")}
                </span>
              </span>
            </button>
          </div>
        </details>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            void state.run(async () => {
              const account = await invoke<{ alias: string }>(
                "add_codex_account",
                { alias: t("distribution.autoImportAlias") },
              );
              await controller.refresh(false);
              setNotice(
                t("distribution.autoImported", { name: account.alias }),
              );
            });
          }}
        >
          {t("distribution.importAuto")}
        </Button>
        <Button size="sm" variant="secondary" disabled={disabled} onClick={onImportJson}>
          {t("distribution.importJson")}
        </Button>
      </div>
      {state.error && <StatusNotice tone="danger">{state.error}</StatusNotice>}
      {notice && <StatusNotice tone="success">{notice}</StatusNotice>}
      {state.loading && (
        <StatusNotice>{t("accountsPane.loadingAccounts")}</StatusNotice>
      )}
      {state.data.accounts.map((profile) => {
        const account = controller.accounts.find(
          (a) => a.id === profile.account_id,
        );
        const devices = state.data.devices.filter(
          (d) =>
            d.account_id === profile.account_id ||
            (d.follow_local &&
              state.data.local_account_id === profile.account_id),
        );
        const isLocal = state.data.local_account_id === profile.account_id;
        return (
          <article
            key={profile.account_id}
            className="space-y-2.5 rounded-lg border border-[var(--color-border)] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="break-words">{profile.alias}</span>
                  <span className="rounded-md bg-[var(--color-bg-tertiary)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
                    {t(`distribution.${profile.kind}`)}
                  </span>
                  {isLocal && (
                    <span className="rounded-md bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                      {t("distribution.localActive")}
                    </span>
                  )}
                </h3>
                <p className="mt-0.5 truncate text-xs text-[var(--color-text-tertiary)]">
                  {[
                    profile.model,
                    profile.base_url,
                    usage[profile.account_id],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <IconButton
                  aria-label={t("distribution.editProfile")}
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => edit(profile)}
                >
                  <EditIcon size={14} />
                </IconButton>
                {account && (
                  <IconButton
                    aria-label={t("accountsPane.deleteAccount", {
                      name: profile.alias,
                    })}
                    variant="danger"
                    size="sm"
                    disabled={disabled}
                    onClick={() => controller.requestDelete(account)}
                  >
                    <TrashIcon size={14} />
                  </IconButton>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-2.5">
              <Button
                size="sm"
                variant={isLocal ? "secondary" : "primary"}
                leadingIcon={isLocal ? <CheckIcon size={14} /> : undefined}
                disabled={disabled}
                onClick={() => {
                  void state.run(async () => {
                    const report = await invoke<{
                      repaired: number;
                      scanned: number;
                    }>("apply_codex_account", {
                      accountId: profile.account_id,
                    });
                    setNotice(
                      report.repaired > 0
                        ? t("distribution.appliedWithRepair", {
                            count: report.repaired,
                          })
                        : t("distribution.applied"),
                    );
                  });
                }}
              >
                {isLocal
                  ? t("distribution.localActive")
                  : t("distribution.applyLocal")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={t("distribution.repairSessionsHint")}
                onClick={() => {
                  void repairSessions();
                }}
              >
                {t("distribution.repairSessions")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  void state.run(async () => {
                    const result = await invoke<{
                      balance?: number;
                      remaining?: number;
                      unit?: string;
                      level?: string;
                    }>(
                      profile.kind === "relay"
                        ? "get_codex_account_relay_usage"
                        : "get_codex_quota",
                      { accountId: profile.account_id },
                    );
                    setUsage((u) => ({
                      ...u,
                      [profile.account_id]:
                        profile.kind === "relay"
                          ? `${result.remaining ?? result.balance ?? "—"} ${result.unit ?? ""}`
                          : result.level || t("distribution.available"),
                    }));
                  });
                }}
              >
                {t("distribution.checkQuota")}
              </Button>
              {devices.length > 0 && (
                <span className="ml-auto truncate text-xs text-[var(--color-text-tertiary)]">
                  {devices
                    .map(
                      (d) =>
                        `${d.host} · ${t(`distribution.status.${d.status}`)}`,
                    )
                    .join("　")}
                </span>
              )}
            </div>
          </article>
        );
      })}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open && !state.busy) {
            setEditing(null);
            setKey("");
          }
        }}
        title={t(
          editing?.account_id
            ? "distribution.editProfile"
            : "distribution.addRelay",
        )}
        footer={
          <>
            <Button
              variant="secondary"
              disabled={state.busy}
              onClick={() => {
                setEditing(null);
                setKey("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button
              loading={state.busy}
              disabled={
                !editing?.alias.trim() ||
                (editing.kind === "relay" &&
                  (!editing.base_url ||
                    !editing.model ||
                    (!editing.account_id && !key)))
              }
              onClick={() => {
                void save();
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            {state.error && (
              <StatusNotice tone="danger">{state.error}</StatusNotice>
            )}
            <TextField
              label={t("accountsPane.aliasLabel")}
              value={editing.alias}
              disabled={state.busy}
              onChange={(e) => field("alias", e.target.value)}
            />
            {editing.kind === "relay" && (
              <>
                <TextField
                  label={t("codexPane.relayUrl")}
                  value={editing.base_url}
                  disabled={state.busy}
                  onChange={(e) => field("base_url", e.target.value)}
                />
                <TextField
                  label={t("codexPane.relayKey")}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    editing.account_id ? t("distribution.keepKey") : "sk-..."
                  }
                  value={key}
                  disabled={state.busy}
                  onChange={(e) => setKey(e.target.value)}
                />
              </>
            )}
            <TextField
              label={t("distribution.defaultModel")}
              value={editing.model}
              disabled={state.busy}
              onChange={(e) => field("model", e.target.value)}
            />
            <SelectField
              label={t("distribution.effort")}
              value={editing.reasoning_effort}
              disabled={state.busy}
              onChange={(e) => field("reasoning_effort", e.target.value)}
            >
              <option value="">{t("distribution.default")}</option>
              {["none", "minimal", "low", "medium", "high", "xhigh"].map(
                (v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ),
              )}
            </SelectField>
          </div>
        )}
      </Dialog>
    </div>
  );
}
