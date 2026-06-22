import * as vscode from 'vscode';
import type { AccountInfo, AlertState } from '../api/types';

const ACCOUNTS_KEY = 'glm.accounts';
const ALERT_STATES_KEY = 'glm.alertStates';
const SNAPSHOT_KEY = 'glm.snapshots';

export interface UsageSnapshot {
  accountId: string;
  timestamp: string;
  timeLimitPct: number | null;
  timeLimitReset: number | null;
  tokenLimitPct: number | null;
  tokenLimitReset: number | null;
}

export class Config {
  constructor(
    private context: vscode.ExtensionContext,
  ) {}

  // ========== VS Code Settings ==========

  get refreshIntervalMinutes(): number {
    return this.getConfig().get<number>('refreshIntervalMinutes', 5);
  }

  get alertThresholds(): number[] {
    return this.getConfig().get<number[]>('alertThresholds', [70, 85, 95]);
  }

  get spinEnabled(): boolean {
    return this.getConfig().get<boolean>('spinEnabled', false);
  }

  get spinIntervalMinutes(): number {
    return this.getConfig().get<number>('spinIntervalMinutes', 30);
  }

  get spinModel(): string {
    return this.getConfig().get<string>('spinModel', 'glm-4.5-flash');
  }

  get planPrice(): number {
    return this.getConfig().get<number>('planPrice', 0);
  }

  get desktopAppPort(): number {
    return this.getConfig().get<number>('desktopAppPort', 18789);
  }

  get desktopAppToken(): string {
    return this.getConfig().get<string>('desktopAppToken', '');
  }

  get isDesktopAppLinked(): boolean {
    return this.desktopAppPort > 0 && this.desktopAppToken.length > 0;
  }

  private getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('glmQuotaMonitor');
  }

  // ========== SecretStorage (API Keys) ==========

  private get secrets(): vscode.SecretStorage {
    return this.context.secrets;
  }

  async getAccounts(): Promise<AccountInfo[]> {
    const raw = await this.secrets.get(ACCOUNTS_KEY);
    if (!raw) {
      return [];
    }
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  async saveAccounts(accounts: AccountInfo[]): Promise<void> {
    await this.secrets.store(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  async addAccount(alias: string, apiKey: string, isPrimary = false): Promise<AccountInfo> {
    const accounts = await this.getAccounts();
    // 如果是第一个账号或标记为主账号，取消其他的主账号标记
    const id = crypto.randomUUID();
    if (isPrimary || accounts.length === 0) {
      for (const acc of accounts) {
        acc.isPrimary = false;
      }
    }
    const account: AccountInfo = { id, alias, apiKey, isPrimary: isPrimary || accounts.length === 0 };
    accounts.push(account);
    await this.saveAccounts(accounts);
    return account;
  }

  async removeAccount(id: string): Promise<void> {
    const accounts = await this.getAccounts();
    const filtered = accounts.filter((a) => a.id !== id);
    // 如果删除的是主账号，把第一个设为主
    if (!filtered.some((a) => a.isPrimary) && filtered.length > 0) {
      filtered[0].isPrimary = true;
    }
    await this.saveAccounts(filtered);
  }

  async setPrimary(id: string): Promise<void> {
    const accounts = await this.getAccounts();
    for (const acc of accounts) {
      acc.isPrimary = acc.id === id;
    }
    await this.saveAccounts(accounts);
  }

  async getPrimaryAccount(): Promise<AccountInfo | undefined> {
    const accounts = await this.getAccounts();
    return accounts.find((a) => a.isPrimary) || accounts[0];
  }

  // ========== Memento (Alert States) ==========

  getAlertStates(): Record<string, AlertState> {
    return this.context.globalState.get<Record<string, AlertState>>(ALERT_STATES_KEY, {});
  }

  async setAlertState(accountId: string, state: AlertState): Promise<void> {
    const states = this.getAlertStates();
    states[accountId] = state;
    await this.context.globalState.update(ALERT_STATES_KEY, states);
  }

  // ========== Memento (Snapshots / History) ==========

  getSnapshots(accountId?: string): UsageSnapshot[] {
    const all = this.context.globalState.get<UsageSnapshot[]>(SNAPSHOT_KEY, []);
    if (accountId) {
      return all.filter((s) => s.accountId === accountId);
    }
    return all;
  }

  async addSnapshot(snapshot: UsageSnapshot): Promise<void> {
    const all = this.getSnapshots();
    all.push(snapshot);
    // 只保留最近 7 天的数据
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const trimmed = all.filter(
      (s) => new Date(s.timestamp).getTime() > sevenDaysAgo,
    );
    await this.context.globalState.update(SNAPSHOT_KEY, trimmed);
  }
}
