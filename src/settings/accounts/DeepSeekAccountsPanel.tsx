import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EyeIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextField } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Section, Surface } from "../../components/ui/Surface";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { AccountRow } from "./AccountRow";
import { AccountModelPicker, AgentBindingControl } from "./AgentBindingControl";
import { getPlatformAccounts } from "./accountModel";
import { DEEPSEEK_DEFAULT_MODEL, NEW_ACCOUNT_OPERATION_IDS } from "./types";
import type { AccountsController } from "./useAccountsController";

interface DeepSeekAccountsPanelProps {
  controller: AccountsController;
}

export function DeepSeekAccountsPanel({ controller }: DeepSeekAccountsPanelProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [alias, setAlias] = useState("");
  const [apiKey, setApiKey] = useState("");
  const accounts = getPlatformAccounts(controller.accounts, "deepseek");
  const createId = NEW_ACCOUNT_OPERATION_IDS.deepseek;
  const creating = controller.isPending(createId, "create");

  async function submit() {
    if (!alias.trim() || !apiKey.trim()) return;
    const success = await controller.addDeepseekAccount(alias, apiKey);
    if (!success) return;
    setAlias("");
    setApiKey("");
    setAdding(false);
  }

  return (
    <Section
      title={t("accountsPane.platformDeepseek")}
      description={t("accountsPane.deepseekDescription")}
      action={(
        <Button
          size="sm"
          variant={adding ? "ghost" : "primary"}
          leadingIcon={adding ? undefined : <PlusIcon size={14} />}
          onClick={() => setAdding((current) => !current)}
        >
          {adding ? t("common.cancel") : t("accountsPane.add")}
        </Button>
      )}
    >
      <div className="space-y-3">
        {adding && (
          <Surface tone="secondary" padding="md" className="space-y-3">
            <TextField
              label={t("accountsPane.aliasLabel")}
              placeholder={t("accountsPane.aliasPlaceholder")}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              autoFocus
            />
            <TextField
              label={t("accountsPane.apiKeyLabel")}
              type="password"
              autoComplete="off"
              placeholder={t("accountsPane.deepseekApiKeyPlaceholder")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            {controller.accountErrors[createId] && <StatusNotice tone="danger">{controller.accountErrors[createId]}</StatusNotice>}
            <Button
              variant="primary"
              fullWidth
              loading={creating}
              loadingLabel={t("accountsPane.verifying")}
              disabled={!alias.trim() || !apiKey.trim()}
              onClick={() => { void submit(); }}
            >
              {t("accountsPane.addAccount")}
            </Button>
          </Surface>
        )}

        {accounts.length > 0 ? accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            subtitle={<span className="font-mono">{controller.maskedKeys[account.id] ?? "—"}</span>}
            metadata={account.is_primary && (
              <span className="rounded-md bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
                {t("account.primary")}
              </span>
            )}
            error={controller.accountErrors[account.id]}
            actions={(
              <>
                <AgentBindingControl
                  controller={controller}
                  agent="claude_code"
                  accountId={account.id}
                  defaultModel={DEEPSEEK_DEFAULT_MODEL}
                  shortLabel="CC"
                  agentLabel="Claude Code"
                />
                <IconButton
                  size="sm"
                  aria-label={t("accountsPane.showKey")}
                  loading={controller.isPending(account.id, "secret")}
                  onClick={() => { void controller.openDeepseekSecret(account); }}
                >
                  <EyeIcon size={14} />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="danger"
                  aria-label={t("accountsPane.deleteAccount", { name: account.alias })}
                  disabled={controller.isPending(account.id, "delete")}
                  onClick={() => controller.requestDelete(account)}
                >
                  <TrashIcon size={14} />
                </IconButton>
              </>
            )}
          >
            <AccountModelPicker
              controller={controller}
              accountId={account.id}
              agent="claude_code"
              agentLabel="Claude Code"
              defaultModel={DEEPSEEK_DEFAULT_MODEL}
            />
          </AccountRow>
        )) : !adding && (
          <EmptyState title={t("accountsPane.noAccounts")} description={t("accountsPane.deepseekEmptyDescription")} />
        )}
      </div>
    </Section>
  );
}
