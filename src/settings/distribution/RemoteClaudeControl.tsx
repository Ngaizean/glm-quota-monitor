import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/Button";
import { SelectField, TextField } from "../../components/ui/Field";
import { StatusNotice } from "../../components/ui/StatusNotice";
import type { Account, RemoteCcState } from "../../types";

// 远程 Claude Code 控制面板：显隐由设备卡片的「同步目标」下拉控制，
// 挂载时拉取一次可选账号列表（zhipu / deepseek）。
export function RemoteClaudeControl({ host }: { host: string }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<RemoteCcState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    invoke<Account[]>("list_accounts")
      .then((items) => {
        if (mounted)
          setAccounts(
            (Array.isArray(items) ? items : []).filter(
              (a) => a.platform === "zhipu" || a.platform === "deepseek",
            ),
          );
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const args = { host, password: password || null };
  async function inspect() {
    setState(await invoke<RemoteCcState>("ssh_check_claude_code", args));
  }
  return (
    <div className="space-y-3 border-t border-[var(--color-border-subtle)] pt-2.5">
      {error && <StatusNotice tone="danger">{error}</StatusNotice>}
      <TextField
        label={t("codexPane.sshPasswordPlaceholder")}
        type="password"
        value={password}
        disabled={busy}
        onChange={(e) => setPassword(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void run(inspect);
          }}
        >
          {t("codexPane.refresh")}
        </Button>
        {state && (
          <p className="min-w-0 break-all text-xs">
            {state.installed
              ? `${state.platform ?? ""} ${state.model ?? ""}`
              : t("codexPane.sshCcNotInstalled")}
          </p>
        )}
      </div>
      <SelectField
        label={t("codexPane.sshCcSelectAccount")}
        value={account}
        disabled={busy}
        onChange={(e) => {
          const id = e.target.value;
          setAccount(id);
          setModel("");
          setModels([]);
          if (id)
            void run(async () => {
              setModels(
                await invoke<string[]>("fetch_models", { accountId: id }),
              );
            });
        }}
      >
        <option value="">{t("distribution.selectAccount")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.alias}
          </option>
        ))}
      </SelectField>
      <SelectField
        label={t("distribution.deviceModel")}
        value={model}
        disabled={busy}
        onChange={(e) => setModel(e.target.value)}
      >
        <option value="">{t("distribution.default")}</option>
        {models.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </SelectField>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || !account}
          onClick={() => {
            void run(async () => {
              await invoke("ssh_bind_claude_code", {
                ...args,
                accountId: account,
                model: model || null,
              });
              await inspect();
              setPassword("");
            });
          }}
        >
          {t("distribution.bindAccount")}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void run(async () => {
              await invoke("ssh_unbind_claude_code", args);
              await inspect();
              setPassword("");
            });
          }}
        >
          {t("distribution.unbind")}
        </Button>
      </div>
    </div>
  );
}
