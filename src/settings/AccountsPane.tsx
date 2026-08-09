import { useTranslation } from "react-i18next";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { StatusNotice } from "../components/ui/StatusNotice";
import { AccountDialogs } from "./accounts/AccountDialogs";
import { CodexAccountsPanel } from "./accounts/CodexAccountsPanel";
import { DeepSeekAccountsPanel } from "./accounts/DeepSeekAccountsPanel";
import { GlmAccountsPanel } from "./accounts/GlmAccountsPanel";
import type { AccountPlatform } from "./accounts/types";
import { useAccountsController } from "./accounts/useAccountsController";

export default function AccountsPane() {
  const { t } = useTranslation();
  const controller = useAccountsController();
  const platformOptions: ReadonlyArray<{ value: AccountPlatform; label: string }> = [
    { value: "zhipu", label: t("accountsPane.platformGlm") },
    { value: "codex", label: t("accountsPane.platformCodex") },
    { value: "deepseek", label: t("accountsPane.platformDeepseek") },
  ];

  return (
    <div className="space-y-4">
      <SegmentedControl
        aria-label={t("accountsPane.platformNavigation")}
        value={controller.platform}
        options={platformOptions}
        onValueChange={controller.changePlatform}
      />

      {controller.globalError && <StatusNotice tone="danger">{controller.globalError}</StatusNotice>}
      {controller.notice && <StatusNotice tone="info">{controller.notice}</StatusNotice>}
      {controller.loading && <StatusNotice>{t("accountsPane.loadingAccounts")}</StatusNotice>}

      {!controller.loading && controller.platform === "zhipu" && <GlmAccountsPanel controller={controller} />}
      {!controller.loading && controller.platform === "codex" && <CodexAccountsPanel controller={controller} />}
      {!controller.loading && controller.platform === "deepseek" && <DeepSeekAccountsPanel controller={controller} />}

      <AccountDialogs controller={controller} />
    </div>
  );
}
