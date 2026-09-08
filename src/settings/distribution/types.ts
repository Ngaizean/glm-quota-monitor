export interface CodexProfile {
  account_id: string;
  alias: string;
  kind: "official" | "relay";
  base_url: string;
  model: string;
  reasoning_effort: string;
}

export interface CodexDevice {
  host: string;
  account_id: string | null;
  follow_local: boolean;
  model: string;
  reasoning_effort: string;
  auto_sync: boolean;
  status: "unbound" | "bound" | "pending" | "verified" | "failed";
  last_sync: string | null;
  last_error: string | null;
}

export interface DistributionState {
  accounts: CodexProfile[];
  devices: CodexDevice[];
  local_account_id: string | null;
  cloud_account_id: string | null;
  cloud_account_ids: string[];
}

export const EMPTY_DISTRIBUTION: DistributionState = {
  accounts: [],
  devices: [],
  local_account_id: null,
  cloud_account_id: null,
  cloud_account_ids: [],
};
