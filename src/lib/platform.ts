import type { Account } from "../types";

export type AccountPlatform = "zhipu" | "codex" | "deepseek";

export interface AccountPlatformGroup {
  platform: AccountPlatform;
  accounts: Account[];
}

export const PLATFORM_ORDER: readonly AccountPlatform[] = ["zhipu", "codex", "deepseek"];

/** 旧账号、空值和未知平台按 GLM 兼容处理。 */
export function normalizePlatform(platform: string | null | undefined): AccountPlatform {
  const normalized = platform?.trim().toLowerCase();
  if (normalized === "codex" || normalized === "deepseek" || normalized === "zhipu") {
    return normalized;
  }
  return "zhipu";
}

export function isAccountPlatform(account: Account, platform: AccountPlatform): boolean {
  return normalizePlatform(account.platform) === platform;
}

export function groupAccountsByPlatform(accounts: readonly Account[]): AccountPlatformGroup[] {
  const grouped: Record<AccountPlatform, Account[]> = {
    zhipu: [],
    codex: [],
    deepseek: [],
  };

  for (const account of accounts) {
    grouped[normalizePlatform(account.platform)].push(account);
  }

  return PLATFORM_ORDER
    .filter((platform) => grouped[platform].length > 0)
    .map((platform) => ({ platform, accounts: grouped[platform] }));
}

export function getAccountsByPlatform(
  accounts: readonly Account[],
  platform: AccountPlatform,
): Account[] {
  return accounts.filter((account) => isAccountPlatform(account, platform));
}

export function supportsSpin(account: Account): boolean {
  return isAccountPlatform(account, "zhipu");
}

export function supportsClaudeBinding(account: Account): boolean {
  const platform = normalizePlatform(account.platform);
  return platform === "zhipu" || platform === "deepseek";
}
