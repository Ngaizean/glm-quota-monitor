import type { Account, RemoteCcState } from "../../types";

export type CodexRole = "owner" | "consumer";
export type CodexRuntimeMode = "official" | "relay";

export interface CodexRuntimeConfig {
  active_mode: CodexRuntimeMode;
  relay_base_url: string;
  relay_model: string;
  relay_key_configured: boolean;
  active_official_account_id: string | null;
}

export interface AuthSummary {
  exists: boolean;
  account_id: string;
  last_refresh: string | null;
  access_token_exp: string | null;
}

export interface SyncInfo {
  last_upload: string | null;
  last_sync: string | null;
}

export interface SshHost {
  alias: string;
  hostname: string;
  user: string;
  port: number;
  identity_file: string | null;
  has_local_key: boolean;
}

export interface SshOverrideState {
  host: string;
  auto_enabled: boolean;
  has_password: boolean;
}

export type PasswordMode = "push" | "auto" | "cc";

export interface PasswordRequest {
  host: string;
  mode: PasswordMode;
}

export interface RemoteBindingRequest {
  host: string;
}

export type { Account, RemoteCcState };
