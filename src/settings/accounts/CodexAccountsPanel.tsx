import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon, TrashIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextField } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Section, Surface } from "../../components/ui/Surface";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { AccountRow } from "./AccountRow";
import { getPlatformAccounts } from "./accountModel";
import { NEW_ACCOUNT_OPERATION_IDS } from "./types";
import type { AccountsController } from "./useAccountsController";

interface CodexAccountsPanelProps {
  controller: AccountsController;
}

export function CodexAccountsPanel({ controller }: CodexAccountsPanelProps) {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const [alias, setAlias] = useState("");
  const accounts = getPlatformAccounts(controller.accounts, "codex");
  const createId = NEW_ACCOUNT_OPERATION_IDS.codex;
  const creating = controller.isPending(createId, "create");

  async function submit() {
    if (!alias.trim() || !controller.codexAuthExists) return;
    const success = await controller.importCodexAccount(alias);
    if (!success) return;
    setAlias("");
    setImporting(false);
  }

  return (
    <Section
      title={t("accountsPane.platformCodex")}
      description={t("codexPane.codexImportDesc")}
      action={(
        <Button
          size="sm"
          variant={importing ? "ghost" : "primary"}
          leadingIcon={importing ? undefined : <PlusIcon size={14} />}
          onClick={() => setImporting((current) => !current)}
        >
          {importing ? t("common.cancel") : t("codexPane.importCodex")}
        </Button>
      )}
    >
      <div className="space-y-3">
        <StatusNotice tone={controller.codexAuthExists ? "success" : "warning"}>
          {controller.codexAuthExists ? t("codexPane.localAuthDetected") : t("codexPane.noLocalAuth")}
        </StatusNotice>

        {importing && (
          <Surface tone="secondary" padding="md" className="space-y-3">
            <TextField
              label={t("accountsPane.aliasLabel")}
              placeholder={t("accountsPane.aliasPlaceholder")}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              autoFocus
            />
            {controller.accountErrors[createId] && <StatusNotice tone="danger">{controller.accountErrors[createId]}</StatusNotice>}
            <Button
              variant="primary"
              fullWidth
              loading={creating}
              loadingLabel={t("accountsPane.verifying")}
              disabled={!alias.trim() || !controller.codexAuthExists}
              onClick={() => { void submit(); }}
            >
              {t("codexPane.importCodex")}
            </Button>
          </Surface>
        )}

        {accounts.length > 0 ? accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            subtitle={account.level || t("accountsPane.codexCredential")}
            metadata={account.is_primary && (
              <span className="rounded-md bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                {t("account.primary")}
              </span>
            )}
            error={controller.accountErrors[account.id]}
            actions={(
              <IconButton
                size="sm"
                variant="danger"
                aria-label={t("accountsPane.deleteAccount", { name: account.alias })}
                disabled={controller.isPending(account.id, "delete")}
                onClick={() => controller.requestDelete(account)}
              >
                <TrashIcon size={14} />
              </IconButton>
            )}
          />
        )) : !importing && (
          <EmptyState title={t("codexPane.noAccounts")} description={t("accountsPane.codexEmptyDescription")} />
        )}
      </div>
    </Section>
  );
}
