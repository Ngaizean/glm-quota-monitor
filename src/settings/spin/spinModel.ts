import { supportsSpin } from "../../lib/platform";
import type { Account } from "../../types";

export function getSpinAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter(supportsSpin);
}
