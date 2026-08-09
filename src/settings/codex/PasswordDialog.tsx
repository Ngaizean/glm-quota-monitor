import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import type { PasswordRequest } from "./types";

interface PasswordDialogProps {
  request: PasswordRequest | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void | Promise<void>;
}

export function PasswordDialog({ request, pending, onClose, onConfirm }: PasswordDialogProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPassword("");
  }, [request?.host, request?.mode]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || pending) return;
    void onConfirm(password);
  }

  const description = request?.mode === "push"
    ? t("codexPane.sshNeedPasswordPush")
    : request?.mode === "auto"
      ? t("codexPane.sshNeedPasswordAuto")
      : t("codexPane.sshNeedPasswordCc");

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => { if (!open && !pending) onClose(); }}
      title={t("codexPane.sshNeedPasswordTitle")}
      description={description}
      closeLabel={t("codexPane.sshCancel")}
      initialFocusRef={inputRef}
      size="sm"
      footer={(
        <>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            {t("codexPane.sshCancel")}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            loadingLabel={t("codexPane.sshSaving")}
            disabled={!password}
            onClick={() => { void onConfirm(password); }}
          >
            {t("codexPane.sshConfirm")}
          </Button>
        </>
      )}
    >
      <form onSubmit={submit}>
        <Field label={t("codexPane.sshPasswordPlaceholder")} htmlFor="codex-ssh-password">
          <input
            ref={inputRef}
            id="codex-ssh-password"
            className="ui-field__control"
            type="password"
            autoComplete="current-password"
            value={password}
            disabled={pending}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  );
}

