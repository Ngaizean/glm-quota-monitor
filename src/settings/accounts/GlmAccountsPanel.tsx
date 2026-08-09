import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon, CopyIcon, EditIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { TextField } from "../../components/ui/Field";
import { IconButton } from "../../components/ui/IconButton";
import { Section, Surface } from "../../components/ui/Surface";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { getLevelStyle } from "../../lib/ui";
import { AccountRow } from "./AccountRow";
import { AccountModelPicker, AgentBindingControl } from "./AgentBindingControl";
import { groupGlmAccountsByAlias } from "./accountModel";
import { NEW_ACCOUNT_OPERATION_IDS } from "./types";
import type { AccountsController } from "./useAccountsController";

interface GlmAccountsPanelProps {
  controller: AccountsController;
}

export function GlmAccountsPanel({ controller }: GlmAccountsPanelProps) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [alias, setAlias] = useState("");
  const [purpose, setPurpose] = useState("");
  const [apiKey, setApiKey] = useState("");
  const groups = groupGlmAccountsByAlias(controller.accounts);
  const accountCount = Object.values(groups).reduce((total, group) => total + group.length, 0);
  const createId = NEW_ACCOUNT_OPERATION_IDS.zhipu;
  const creating = controller.isPending(createId, "create");

  async function submit() {
    if (!alias.trim() || !purpose.trim() || !apiKey.trim()) return;
    const success = await controller.addGlmAccount(alias, purpose, apiKey);
    if (!success) return;
    setAlias("");
    setPurpose("");
    setApiKey("");
    setAdding(false);
  }

  return (
    <Section
      title={t("accountsPane.platformGlm")}
      description={t("accountsPane.glmDescription")}
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
              label={t("accountsPane.purposeLabel")}
              placeholder={t("accountsPane.purposePlaceholder")}
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            />
            <TextField
              label={t("accountsPane.apiKeyLabel")}
              type="password"
              autoComplete="off"
              placeholder={t("accountsPane.apiKeyPlaceholder")}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
            {controller.accountErrors[createId] && <StatusNotice tone="danger">{controller.accountErrors[createId]}</StatusNotice>}
            <Button
              variant="primary"
              fullWidth
              loading={creating}
              loadingLabel={t("accountsPane.verifying")}
              disabled={!alias.trim() || !purpose.trim() || !apiKey.trim()}
              onClick={() => { void submit(); }}
            >
              {t("accountsPane.addAccount")}
            </Button>
          </Surface>
        )}

        {accountCount > 0 ? Object.entries(groups).map(([groupName, accounts]) => (
          <div key={groupName} className="space-y-2">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-[11px] font-semibold text-[var(--color-text-secondary)]">{groupName}</h3>
              <span className="text-[11px] text-[var(--color-text-tertiary)]">{t("accountsPane.keyCount", { count: accounts.length })}</span>
            </div>
            {accounts.map((account) => (
              <AccountRow
                key={account.id}
                account={account}
                subtitle={account.purpose}
                metadata={account.level && (
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase ${getLevelStyle(account.level)}`}>
                    {account.level}
                  </span>
                )}
                error={controller.accountErrors[account.id]}
                actions={(
                  <>
                    <AgentBindingControl
                      controller={controller}
                      agent="claude_code"
                      accountId={account.id}
                      defaultModel={controller.defaultModel}
                      shortLabel="CC"
                      agentLabel="Claude Code"
                    />
                    <AgentBindingControl
                      controller={controller}
                      agent="openclaw"
                      accountId={account.id}
                      defaultModel={controller.defaultModel}
                      shortLabel="OC"
                      agentLabel="OpenClaw"
                    />
                    <IconButton
                      size="sm"
                      aria-label={controller.copiedAccountId === account.id ? t("accountsPane.copied") : t("accountsPane.copyKey")}
                      onClick={() => controller.requestCopy(account)}
                    >
                      {controller.copiedAccountId === account.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    </IconButton>
                    <IconButton size="sm" aria-label={t("accountsPane.modifyKey")} onClick={() => controller.requestEdit(account)}>
                      <EditIcon size={14} />
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
                  defaultModel={controller.defaultModel}
                />
                <AccountModelPicker
                  controller={controller}
                  accountId={account.id}
                  agent="openclaw"
                  agentLabel="OpenClaw"
                  defaultModel={controller.defaultModel}
                />
              </AccountRow>
            ))}
          </div>
        )) : !adding && (
          <EmptyState title={t("accountsPane.noAccounts")} description={t("accountsPane.glmEmptyDescription")} />
        )}
      </div>
    </Section>
  );
}
