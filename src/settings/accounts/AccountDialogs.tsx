import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { StatusNotice } from "../../components/ui/StatusNotice";
import { TextField } from "../../components/ui/Field";
import type { AccountsController } from "./useAccountsController";

interface AccountDialogsProps {
  controller: AccountsController;
}

export function AccountDialogs({ controller }: AccountDialogsProps) {
  const { t } = useTranslation();
  const [replacementKey, setReplacementKey] = useState("");

  useEffect(() => {
    if (!controller.editDialog) setReplacementKey("");
  }, [controller.editDialog]);

  const deletePending = controller.deleteDialog
    ? controller.isPending(controller.deleteDialog.id, "delete")
    : false;
  const copyPending = controller.copyDialog
    ? controller.isPending(controller.copyDialog.id, "copy")
    : false;
  const editPending = controller.editDialog
    ? controller.isPending(controller.editDialog.id, "update")
    : false;

  return (
    <>
      <Dialog
        open={Boolean(controller.deleteDialog)}
        onOpenChange={(open) => { if (!open && !deletePending) controller.closeDeleteDialog(); }}
        title={t("accountsPane.deleteTitle")}
        description={controller.deleteDialog
          ? t("accountsPane.deleteDescription", { name: controller.deleteDialog.alias })
          : undefined}
        size="sm"
        closeOnBackdrop={!deletePending}
        footer={(
          <>
            <Button variant="ghost" disabled={deletePending} onClick={controller.closeDeleteDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="danger"
              loading={deletePending}
              loadingLabel={t("accountsPane.deleting")}
              onClick={() => { void controller.confirmDelete(); }}
            >
              {t("common.delete")}
            </Button>
          </>
        )}
      >
        {controller.deleteDialog && controller.accountErrors[controller.deleteDialog.id] && (
          <StatusNotice tone="danger">{controller.accountErrors[controller.deleteDialog.id]}</StatusNotice>
        )}
      </Dialog>

      <Dialog
        open={Boolean(controller.copyDialog)}
        onOpenChange={(open) => { if (!open && !copyPending) controller.closeCopyDialog(); }}
        title={t("accountsPane.copyKey")}
        description={t("accountsPane.copyConfirm")}
        size="sm"
        closeOnBackdrop={!copyPending}
        footer={(
          <>
            <Button variant="ghost" disabled={copyPending} onClick={controller.closeCopyDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={copyPending}
              onClick={() => { void controller.confirmCopy(); }}
            >
              {t("common.confirm")}
            </Button>
          </>
        )}
      >
        <StatusNotice tone="warning">{t("accountsPane.secretClipboardWarning")}</StatusNotice>
      </Dialog>

      <Dialog
        open={Boolean(controller.editDialog)}
        onOpenChange={(open) => { if (!open && !editPending) controller.closeEditDialog(); }}
        title={t("accountsPane.modifyKey")}
        description={controller.editDialog?.alias}
        size="sm"
        closeOnBackdrop={!editPending}
        footer={(
          <>
            <Button variant="ghost" disabled={editPending} onClick={controller.closeEditDialog}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              loading={editPending}
              loadingLabel={t("accountsPane.modifyKeyVerifying")}
              disabled={!replacementKey.trim()}
              onClick={() => { void controller.saveApiKey(replacementKey); }}
            >
              {t("accountsPane.modifyKeySave")}
            </Button>
          </>
        )}
      >
        <TextField
          type="password"
          autoComplete="off"
          label={t("accountsPane.apiKeyLabel")}
          placeholder={t("accountsPane.newKeyPlaceholder")}
          value={replacementKey}
          onChange={(event) => setReplacementKey(event.target.value)}
        />
      </Dialog>

      <Dialog
        open={Boolean(controller.secretDialog)}
        onOpenChange={(open) => { if (!open) controller.closeSecretDialog(); }}
        title={t("accountsPane.secretTitle")}
        description={controller.secretDialog?.account.alias}
        size="sm"
        footer={(
          <Button variant="primary" onClick={controller.closeSecretDialog}>
            {t("common.confirm")}
          </Button>
        )}
      >
        {controller.secretDialog?.loading ? (
          <StatusNotice>{t("accountsPane.loadingSecret")}</StatusNotice>
        ) : (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 font-mono text-xs break-all text-[var(--color-text-primary)]">
            {controller.secretDialog?.secret}
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-text-tertiary)]">
          {t("accountsPane.secretEphemeral")}
        </p>
      </Dialog>
    </>
  );
}
