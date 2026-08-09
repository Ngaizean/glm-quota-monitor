import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Section } from "../../components/ui/Surface";
import { HostCard } from "./HostCard";
import type { CodexController } from "./useCodexController";

interface RemoteHostsSectionProps {
  controller: CodexController;
}

export function RemoteHostsSection({ controller }: RemoteHostsSectionProps) {
  const { t } = useTranslation();
  return (
    <Section
      title={t("codexPane.remoteSectionTitle")}
      description={t("codexPane.sshRemoteOverrideDesc")}
      action={(
        <Button
          size="sm"
          variant="secondary"
          loading={controller.scanningHosts}
          loadingLabel={t("codexPane.sshScanning")}
          disabled={controller.initializing}
          onClick={() => { void controller.scanHosts(); }}
        >
          {t("codexPane.sshScan")}
        </Button>
      )}
    >
      {!controller.hostsLoaded ? (
        <EmptyState
          title={t("codexPane.sshRemoteOverride")}
          description={t("codexPane.sshScanHint")}
        />
      ) : controller.hosts.length === 0 ? (
        <EmptyState title={t("codexPane.sshNoHosts")} />
      ) : (
        <div className="space-y-3">
          {controller.hosts.map((host) => (
            <HostCard key={host.alias} host={host} controller={controller} />
          ))}
        </div>
      )}
    </Section>
  );
}

