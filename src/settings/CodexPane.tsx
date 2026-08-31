import { useTranslation } from "react-i18next";
import { StatusNotice } from "../components/ui/StatusNotice";
import { CloudSyncSection } from "./codex/CloudSyncSection";
import { LocalAuthSection } from "./codex/LocalAuthSection";
import { PasswordDialog } from "./codex/PasswordDialog";
import { RemoteBindingDialog } from "./codex/RemoteBindingDialog";
import { RemoteHostsSection } from "./codex/RemoteHostsSection";
import { RuntimeProfileSection } from "./codex/RuntimeProfileSection";
import { useCodexController } from "./codex/useCodexController";

export default function CodexPane() {
  const { t } = useTranslation();
  const controller = useCodexController();
  const passwordPending = controller.passwordRequest
    ? controller.pendingHosts.has(controller.passwordRequest.host)
    : false;
  const bindingPending = controller.bindingRequest
    ? controller.pendingHosts.has(controller.bindingRequest.host)
    : false;

  return (
    <div className="space-y-5">
      {controller.initializing && (
        <StatusNotice tone="info">{t("codexPane.loadingSettings")}</StatusNotice>
      )}
      {controller.error && <StatusNotice tone="danger">{controller.error}</StatusNotice>}
      {controller.info && <StatusNotice tone="success">{controller.info}</StatusNotice>}

      <RuntimeProfileSection controller={controller} />
      <LocalAuthSection controller={controller} />
      <CloudSyncSection controller={controller} />
      <RemoteHostsSection controller={controller} />

      <PasswordDialog
        request={controller.passwordRequest}
        pending={passwordPending}
        onClose={controller.closePasswordDialog}
        onConfirm={controller.confirmPassword}
      />
      <RemoteBindingDialog
        request={controller.bindingRequest}
        accounts={controller.bindableAccounts}
        modelCache={controller.modelCache}
        pickerAccountId={controller.pickerAccountId}
        pickerLoading={controller.pickerLoading}
        pending={bindingPending}
        onClose={controller.closeBindingDialog}
        onToggleAccount={controller.togglePickerAccount}
        onBind={controller.bindRemote}
      />
    </div>
  );
}
