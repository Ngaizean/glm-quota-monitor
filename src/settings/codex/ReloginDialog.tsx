import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import type { ReloginRequest } from "./types";

interface ReloginDialogProps {
  request: ReloginRequest | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ReloginDialog({ request, pending, onClose, onConfirm }: ReloginDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => { if (!open && !pending) onClose(); }}
      title={t("codexPane.reloginTitle")}
      description={t("codexPane.reloginDesc", { reason: request?.reason })}
      closeLabel={t("codexPane.reloginCancel")}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            {t("codexPane.reloginCancel")}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            loadingLabel={t("codexPane.reloginPending")}
            onClick={() => { void onConfirm(); }}
          >
            {t("codexPane.reloginConfirm")}
          </Button>
        </>
      )}
    >
      <p className="text-xs leading-5 text-[var(--color-text-secondary)]">
        {t("codexPane.reloginHint")}
      </p>
    </Dialog>
  );
}
