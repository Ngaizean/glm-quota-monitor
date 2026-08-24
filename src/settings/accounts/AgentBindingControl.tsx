import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon } from "../../components/icons";
import { Button } from "../../components/ui/Button";
import { IconButton } from "../../components/ui/IconButton";
import type { AccountsController } from "./useAccountsController";
import type { AgentType } from "./types";

interface AgentBindingControlProps {
  controller: AccountsController;
  agent: AgentType;
  accountId: string;
  defaultModel: string;
  shortLabel: string;
  agentLabel: string;
}

export function AgentBindingControl({
  controller,
  agent,
  accountId,
  defaultModel,
  shortLabel,
  agentLabel,
}: AgentBindingControlProps) {
  const { t } = useTranslation();
  const isBound = controller.bindings[agent] === accountId;
  const pickerOpen = controller.picker?.accountId === accountId && controller.picker.agent === agent;
  const pending = controller.isPending(accountId, "bind");

  return (
    <div className="flex items-stretch">
      <Button
        size="sm"
        variant={isBound ? "primary" : "secondary"}
        className="rounded-r-none"
        loading={pending}
        aria-label={isBound
          ? t("accountsPane.agentBound", { agent: agentLabel, model: defaultModel })
          : t("accountsPane.agentBind", { agent: agentLabel, model: defaultModel })}
        onClick={() => { void controller.bindAgent(agent, accountId); }}
      >
        {shortLabel}
      </Button>
      <IconButton
        size="sm"
        variant={pickerOpen ? "primary" : "secondary"}
        className="rounded-l-none border-l-0"
        aria-label={t("accountsPane.selectOverrideModel", { agent: agentLabel })}
        aria-expanded={pickerOpen}
        onClick={() => { void controller.openPicker(agent, accountId); }}
      >
        <ChevronDownIcon size={13} />
      </IconButton>
    </div>
  );
}

interface AccountModelPickerProps {
  controller: AccountsController;
  accountId: string;
  agent: AgentType;
  agentLabel: string;
  defaultModel: string;
  /** 是否展示自定义模型输入表单：自定义模型列表仅用于 GLM，DeepSeek 账号应关闭。 */
  allowCustomModel?: boolean;
}

export function AccountModelPicker({
  controller,
  accountId,
  agent,
  agentLabel,
  defaultModel,
  allowCustomModel = true,
}: AccountModelPickerProps) {
  const { t } = useTranslation();
  const [customInput, setCustomInput] = useState("");
  const open = controller.picker?.accountId === accountId && controller.picker.agent === agent;
  if (!open) return null;

  async function submitCustomModel() {
    const model = customInput.trim();
    if (!model) return;
    const success = await controller.submitCustomModel(agent, accountId, model);
    if (success) setCustomInput("");
  }

  return (
    <div className="border-t border-[var(--color-border-subtle)] px-3.5 pb-3.5 pt-3">
      <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-bg-primary)] p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--color-text-tertiary)]">
            {t("accountsPane.selectOverrideModel", { agent: agentLabel })}
          </span>
          <Button size="sm" variant="ghost" onClick={controller.closePicker}>
            {t("accountsPane.collapse")}
          </Button>
        </div>
        <button
          type="button"
          className="mb-2 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-left hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)]"
          onClick={() => { void controller.bindAgent(agent, accountId); }}
        >
          <span className="block text-xs font-medium text-[var(--color-text-primary)]">{t("accountsPane.useDefaultModel")}</span>
          <span className="mt-0.5 block font-mono text-[11px] text-[var(--color-text-tertiary)]">{defaultModel}</span>
        </button>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-[var(--color-border-subtle)]">
          {controller.picker?.loading ? (
            <div className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">{t("accountsPane.loadingModels")}</div>
          ) : controller.pickerModels.length > 0 ? (
            controller.pickerModels.map((model) => (
              <button
                key={model}
                type="button"
                className="block w-full border-b border-[var(--color-border-subtle)] px-3 py-2 text-left font-mono text-xs text-[var(--color-text-secondary)] last:border-b-0 hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)]"
                onClick={() => { void controller.bindAgent(agent, accountId, model); }}
              >
                {model}
              </button>
            ))
          ) : (
            <div className="px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]">{t("accountsPane.noModels")}</div>
          )}
        </div>
        {allowCustomModel && (
          <form
            className="mt-2 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCustomModel();
            }}
          >
            <input
              value={customInput}
              onChange={(event) => setCustomInput(event.target.value)}
              aria-label={t("accountsPane.customModelLabel")}
              placeholder={t("accountsPane.customModelPlaceholder")}
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 font-mono text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />
            <Button
              size="sm"
              variant="secondary"
              type="submit"
              disabled={!customInput.trim()}
              loading={controller.isPending(accountId, "bind")}
            >
              {t("accountsPane.customModelBind")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
