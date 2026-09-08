import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { TextField } from "../../components/ui/Field";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { Toggle } from "../../components/ui/Toggle";
import { useDistribution } from "./useDistribution";
import { useCloudSync } from "./useCloudSync";

export default function CloudSyncPane() {
  const { t } = useTranslation();
  const cloud = useCloudSync();
  const state = useDistribution();
  const owner = cloud.role === "owner";
  const disabled = cloud.loading || cloud.busy || state.loading || state.busy;
  const selected = state.data.cloud_account_ids;
  const toggleAccount = (accountId: string) => {
    const next = selected.includes(accountId)
      ? selected.filter((id) => id !== accountId)
      : [...selected, accountId];
    if (next.length > 0) {
      void state.run(() => invoke("set_cloud_accounts", { accountIds: next }));
    }
  };
  return (
    <div className="space-y-5">
      {(cloud.error || state.error) && (
        <StatusNotice tone="danger">{cloud.error || state.error}</StatusNotice>
      )}
      {cloud.success && (
        <StatusNotice tone="success">{t("distribution.completed")}</StatusNotice>
      )}
      <SegmentedControl
        aria-label={t("codexPane.role")}
        value={cloud.role}
        options={[
          { value: "owner", label: t("distribution.publisher"), disabled },
          { value: "consumer", label: t("distribution.receiver"), disabled },
        ]}
        onValueChange={(v) => {
          void cloud.changeRole(v);
        }}
      />
      {owner && (
        <fieldset className="space-y-1.5" disabled={disabled}>
          <legend className="text-sm font-medium">
            {t("distribution.publishAccount")}
          </legend>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {t("distribution.publishAccountHint")}
          </p>
          {state.data.accounts.length === 0 && (
            <p className="text-xs text-[var(--color-text-tertiary)]">
              {t("distribution.selectAccount")}
            </p>
          )}
          <div className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-xl border border-[var(--color-border-subtle)]">
            {state.data.accounts.map((a) => (
              <label
                key={a.account_id}
                className="flex cursor-default items-center gap-2.5 px-3 py-2 text-sm hover:bg-[var(--color-bg-secondary)]"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={selected.includes(a.account_id)}
                  disabled={disabled}
                  onChange={() => toggleAccount(a.account_id)}
                />
                <span className="min-w-0 flex-1 truncate">{a.alias}</span>
                <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
                  {a.kind === "relay" ? a.base_url : t("distribution.official")}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--color-text-tertiary)]">
            {t("distribution.selectedCount", { count: selected.length })}
          </p>
        </fieldset>
      )}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border-subtle)] px-4 py-3">
        <span className="text-sm">
          {t(owner ? "codexPane.autoUpload" : "codexPane.autoSync")}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--color-text-tertiary)]">
            {((owner ? cloud.info?.last_upload : cloud.info?.last_sync) &&
              new Date(
                (owner ? cloud.info?.last_upload : cloud.info?.last_sync)!,
              ).toLocaleString()) ||
              t("codexPane.never")}
          </span>
          <Toggle
            checked={owner ? cloud.upload : cloud.download}
            disabled={disabled}
            aria-label={t(owner ? "codexPane.autoUpload" : "codexPane.autoSync")}
            onCheckedChange={(enabled) => {
              void cloud.toggleAuto(enabled);
            }}
          />
        </div>
      </div>
      <Button
        fullWidth
        disabled={disabled || !cloud.url.trim() || (owner && selected.length === 0)}
        loading={cloud.busy}
        onClick={() => {
          void cloud.sync().then(state.refresh);
        }}
      >
        {t(owner ? "distribution.publish" : "distribution.receive")}
      </Button>
      <details className="group rounded-xl border border-[var(--color-border-subtle)] open:bg-[var(--color-bg-secondary)]">
        <summary className="flex cursor-default list-none items-center justify-between gap-2 px-4 py-3 text-sm text-[var(--color-text-secondary)] select-none [&::-webkit-details-marker]:hidden">
          {t("distribution.advancedSettings")}
          <ChevronDownIcon
            size={15}
            className="transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="space-y-3 border-t border-[var(--color-border-subtle)] p-4">
          <TextField
            label={t("codexPane.gistUrlLabel")}
            value={cloud.url}
            disabled={disabled}
            onChange={(e) => cloud.setUrl(e.target.value)}
          />
          <TextField
            label={t("codexPane.githubTokenLabel")}
            type="password"
            autoComplete="new-password"
            placeholder={t("distribution.keepKey")}
            value={cloud.token}
            disabled={disabled}
            onChange={(e) => cloud.setToken(e.target.value)}
          />
          <TextField
            label={t("codexPane.proxyLabel")}
            value={cloud.proxy}
            disabled={disabled}
            onChange={(e) => cloud.setProxy(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={disabled}
              onClick={() => {
                void cloud.save();
              }}
            >
              {t("common.save")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                void cloud.clearToken();
              }}
            >
              {t("distribution.clearGithubToken")}
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}
