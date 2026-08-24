import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "../../components/ui/Button";
import { StatusNotice } from "../../components/ui/StatusNotice";
import PageHeader from "../components/PageHeader";
import SettingsRow from "../components/SettingsRow";
import SettingsSection from "../components/SettingsSection";
import type { DeployResult } from "./useSub2apiController";
import { useSub2apiController } from "./useSub2apiController";

interface SshHostInfo {
  alias: string;
  hostname: string;
}

export default function Sub2apiPane() {
  const { t } = useTranslation();
  const controller = useSub2apiController();

  // 连接配置
  const [baseUrl, setBaseUrl] = useState("http://localhost:8080");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [model, setModel] = useState("gpt-5.6-sol");

  // 部署
  const [jsonText, setJsonText] = useState("");
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [sshHosts, setSshHosts] = useState<SshHostInfo[]>([]);
  const [selectedHost, setSelectedHost] = useState("");

  useEffect(() => {
    void controller.loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (controller.config) {
      setBaseUrl(controller.config.base_url);
      setEmail(controller.config.admin_email ?? "");
      setModel(controller.config.model);
    }
  }, [controller.config]);

  async function scanHosts() {
    try {
      const hosts = await invoke<SshHostInfo[]>("scan_ssh_hosts");
      setSshHosts(hosts);
      if (hosts.length > 0 && !selectedHost) {
        setSelectedHost(hosts[0].alias);
      }
    } catch {
      setSshHosts([]);
    }
  }

  async function runDeploy() {
    const result = await controller.deploy(jsonText, password || undefined);
    if (result) {
      setDeployResult(result);
      void controller.refreshStatus();
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("sub2apiPane.title")}
        description={t("sub2apiPane.desc")}
      />

      {controller.error && <StatusNotice tone="danger">{controller.error}</StatusNotice>}
      {controller.notice && <StatusNotice tone="success">{controller.notice}</StatusNotice>}

      <SettingsSection
        title={t("sub2apiPane.connectionTitle")}
        description={t("sub2apiPane.connectionDesc")}
      >
        <SettingsRow label={t("sub2apiPane.baseUrlLabel")} description={t("sub2apiPane.baseUrlDesc")}>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:8080"
          />
        </SettingsRow>
        <SettingsRow label={t("sub2apiPane.emailLabel")}>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@sub2api.local"
          />
        </SettingsRow>
        <SettingsRow
          label={t("sub2apiPane.passwordLabel")}
          description={controller.config?.has_password ? t("sub2apiPane.passwordStored") : undefined}
        >
          <input
            type="password"
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={controller.config?.has_password ? "••••••" : ""}
          />
        </SettingsRow>
        <SettingsRow label={t("sub2apiPane.modelLabel")} description={t("sub2apiPane.modelDesc")}>
          <input
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-5.6-sol"
          />
        </SettingsRow>
        <SettingsRow label={t("sub2apiPane.actionsLabel")} stacked>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              loading={controller.busy === "save"}
              onClick={() => {
                void controller.saveConfig({
                  base_url: baseUrl,
                  admin_email: email,
                  ...(password ? { admin_password: password } : {}),
                  model,
                });
              }}
            >
              {t("common.save")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={controller.busy === "test"}
              onClick={() => {
                void (async () => {
                  const ok = await controller.saveConfig({
                    base_url: baseUrl,
                    admin_email: email,
                    ...(password ? { admin_password: password } : {}),
                    model,
                  });
                  if (ok) await controller.testConnection(password || undefined);
                })();
              }}
            >
              {t("sub2apiPane.testConnection")}
            </Button>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title={t("sub2apiPane.deployTitle")}
        description={t("sub2apiPane.deployDesc")}
      >
        <div className="space-y-3 px-5 py-4">
          <textarea
            className="h-40 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 font-mono text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            placeholder={t("sub2apiPane.deployPlaceholder")}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={!jsonText.trim()}
              loading={controller.busy === "deploy"}
              onClick={() => { void runDeploy(); }}
            >
              {t("sub2apiPane.deployButton")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={controller.busy === "topup"}
              onClick={() => { void controller.topup(100); }}
            >
              {t("sub2apiPane.topup")}
            </Button>
          </div>

          {deployResult && (
            <div className="space-y-3 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-tertiary)] p-4">
              <div className="text-xs text-[var(--color-text-secondary)]">
                {t("sub2apiPane.deploySummary", {
                  created: deployResult.import_stats.account_created,
                  group: deployResult.group_name,
                })}
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-primary)]">
                  {deployResult.api_key}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { void navigator.clipboard.writeText(deployResult.api_key); }}
                >
                  {t("sub2apiPane.copyKey")}
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  loading={controller.busy === "applyLocal"}
                  onClick={() => { void controller.applyLocal(deployResult.api_key); }}
                >
                  {t("sub2apiPane.applyLocal")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { void scanHosts(); }}
                >
                  {t("sub2apiPane.scanHosts")}
                </Button>
                {sshHosts.length > 0 && (
                  <>
                    <select
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-xs text-[var(--color-text-primary)]"
                      value={selectedHost}
                      onChange={(e) => setSelectedHost(e.target.value)}
                    >
                      {sshHosts.map((h) => (
                        <option key={h.alias} value={h.alias}>{h.alias}</option>
                      ))}
                    </select>
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={!selectedHost}
                      loading={controller.busy === "applyRemote"}
                      onClick={() => { void controller.applyRemote(selectedHost, deployResult.api_key); }}
                    >
                      {t("sub2apiPane.applyRemote")}
                    </Button>
                  </>
                )}
              </div>
              {controller.config?.lan_ip && (
                <div className="text-[11px] text-[var(--color-text-tertiary)]">
                  {t("sub2apiPane.lanIpHint", { ip: controller.config.lan_ip })}
                </div>
              )}
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("sub2apiPane.statusTitle")}
        description={t("sub2apiPane.statusDesc")}
        action={(
          <Button
            variant="secondary"
            size="sm"
            loading={controller.busy === "status"}
            onClick={() => { void controller.refreshStatus(); }}
          >
            {t("sub2apiPane.refresh")}
          </Button>
        )}
      >
        {controller.accounts.length === 0 && controller.groups.length === 0 ? (
          <div className="px-5 py-6 text-center text-xs text-[var(--color-text-tertiary)]">
            {t("sub2apiPane.empty")}
          </div>
        ) : (
          <>
            {controller.accounts.map((account) => (
              <SettingsRow
                key={account.id}
                label={account.name}
                description={`${account.platform} / ${account.type}`}
              >
                <span
                  className={
                    account.status === "active"
                      ? "rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400"
                      : "rounded-md bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[11px] text-[var(--color-text-tertiary)]"
                  }
                >
                  {account.status}
                </span>
              </SettingsRow>
            ))}
            {controller.groups.map((group) => (
              <SettingsRow
                key={group.id}
                label={`${t("sub2apiPane.groupPrefix")}${group.name}`}
                description={group.platform}
              >
                <span className="text-[11px] text-[var(--color-text-tertiary)]">{group.status}</span>
              </SettingsRow>
            ))}
          </>
        )}
      </SettingsSection>
    </div>
  );
}
