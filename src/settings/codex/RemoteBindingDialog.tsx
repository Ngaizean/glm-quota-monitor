import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { Surface } from "../../components/ui/Surface";
import type { Account, RemoteBindingRequest } from "./types";

interface RemoteBindingDialogProps {
  request: RemoteBindingRequest | null;
  accounts: Account[];
  modelCache: Record<string, string[]>;
  pickerAccountId: string | null;
  pickerLoading: boolean;
  pending: boolean;
  onClose: () => void;
  onToggleAccount: (accountId: string) => void | Promise<void>;
  onBind: (accountId: string, model?: string) => void | Promise<void>;
}

export function RemoteBindingDialog({
  request,
  accounts,
  modelCache,
  pickerAccountId,
  pickerLoading,
  pending,
  onClose,
  onToggleAccount,
  onBind,
}: RemoteBindingDialogProps) {
  const { t } = useTranslation();
  const title = request
    ? `${t("codexPane.sshCcBindTitle")} · ${request.host}`
    : t("codexPane.sshCcBindTitle");

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => { if (!open && !pending) onClose(); }}
      title={title}
      description={t("codexPane.sshCcBindDesc")}
      closeLabel={t("codexPane.sshCancel")}
      size="md"
      footer={(
        <Button variant="secondary" disabled={pending} onClick={onClose}>
          {t("codexPane.sshCancel")}
        </Button>
      )}
    >
      <div className="space-y-3">
        <div className="text-xs font-medium text-[var(--color-text-secondary)]">
          {t("codexPane.sshCcSelectAccount")}
        </div>
        {accounts.length === 0 ? (
          <EmptyState title={t("codexPane.sshCcNoAccount")} />
        ) : (
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {accounts.map((account) => {
              const open = pickerAccountId === account.id;
              const models = modelCache[account.id] ?? [];
              return (
                <Surface key={account.id} tone="secondary" padding="none" className="overflow-hidden">
                  <Button
                    variant="ghost"
                    fullWidth
                    aria-expanded={open}
                    className="justify-between"
                    disabled={pending}
                    onClick={() => { void onToggleAccount(account.id); }}
                  >
                    <span className="min-w-0 truncate">{account.alias}</span>
                    <span className="shrink-0 text-[var(--color-text-tertiary)]">
                      {account.platform === "deepseek" ? "DeepSeek" : "GLM"}
                    </span>
                  </Button>
                  {open && (
                    <div className="space-y-1 border-t border-[var(--color-border-subtle)] p-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        fullWidth
                        disabled={pending}
                        onClick={() => { void onBind(account.id); }}
                      >
                        {t("codexPane.sshCcUseDefaultModel")}
                      </Button>
                      {pickerLoading ? (
                        <div className="px-3 py-2 text-xs text-[var(--color-text-tertiary)]">
                          {t("generalPane.loadingModels")}
                        </div>
                      ) : models.map((model) => (
                        <Button
                          key={model}
                          variant="ghost"
                          size="sm"
                          fullWidth
                          className="justify-start font-mono"
                          disabled={pending}
                          onClick={() => { void onBind(account.id, model); }}
                        >
                          {model}
                        </Button>
                      ))}
                    </div>
                  )}
                </Surface>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}

