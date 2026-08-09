import { getAccountsByPlatform, type AccountPlatform } from "../../lib/platform";
import type { Account } from "../../types";

export function getPlatformAccounts(accounts: readonly Account[], platform: AccountPlatform): Account[] {
  return getAccountsByPlatform(accounts, platform);
}

export function groupGlmAccountsByAlias(accounts: readonly Account[]): Record<string, Account[]> {
  return getPlatformAccounts(accounts, "zhipu").reduce<Record<string, Account[]>>((groups, account) => {
    (groups[account.alias] ??= []).push(account);
    return groups;
  }, {});
}
