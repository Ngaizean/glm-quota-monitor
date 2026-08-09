import type { Account } from "../../types";
import type { AccountPlatform } from "../../lib/platform";

export type { AccountPlatform };
export type AgentType = "claude_code" | "openclaw";
export type AccountOperation = "delete" | "copy" | "update" | "bind" | "secret" | "create";

export interface ModelPickerState {
  accountId: string;
  agent: AgentType;
  loading: boolean;
  requestId: number;
}

export interface SecretDialogState {
  account: Account;
  secret: string | null;
  loading: boolean;
}

export const NEW_ACCOUNT_OPERATION_IDS: Record<AccountPlatform, string> = {
  zhipu: "$new:zhipu",
  codex: "$new:codex",
  deepseek: "$new:deepseek",
};

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
