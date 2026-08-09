import * as vscode from 'vscode';
import { ZhipuClient, ApiError } from '../api/client';
import { Config, UsageSnapshot } from '../utils/config';
import { preferredTokenLimit, type AccountInfo, type QuotaData, type RefreshResult } from '../api/types';

export class QuotaService {
  private refreshing = false;

  constructor(private config: Config) {}

  async refreshAll(): Promise<RefreshResult> {
    if (this.refreshing) {
      return { maxPct: 0, quotas: {} };
    }
    this.refreshing = true;

    try {
      // 尝试从桌面 App 获取
      if (this.config.isDesktopAppLinked) {
        try {
          const result = await this.fetchFromDesktopApp();
          if (result) {
            return result;
          }
        } catch {
          // 联动失败，回退到直接 API 调用
        }
      }

      // 直接 API 调用
      return await this.fetchDirectly();
    } finally {
      this.refreshing = false;
    }
  }

  private async fetchDirectly(): Promise<RefreshResult> {
    const accounts = await this.config.getAccounts();
    if (accounts.length === 0) {
      return { maxPct: 0, quotas: {} };
    }

    let maxPct = 0;
    const quotas: Record<string, QuotaData> = {};

    await Promise.allSettled(
      accounts.map(async (account) => {
        try {
          const client = new ZhipuClient(account.apiKey);
          const quota = await client.getQuotaLimit();

          const tokenPct = preferredTokenLimit(quota);
          const pct = tokenPct?.percentage ?? 0;
          if (pct > maxPct) {
            maxPct = pct;
          }

          // 记录快照
          const snapshot: UsageSnapshot = {
            accountId: account.id,
            timestamp: new Date().toISOString(),
            timeLimitPct: quota.limits.find((l) => l.type === 'TIME_LIMIT')?.percentage ?? null,
            timeLimitReset: quota.limits.find((l) => l.type === 'TIME_LIMIT')?.nextResetTime ?? null,
            tokenLimitPct: tokenPct?.percentage ?? null,
            tokenLimitReset: tokenPct?.nextResetTime ?? null,
          };
          await this.config.addSnapshot(snapshot);

          quotas[account.id] = quota;
        } catch (e) {
          if (e instanceof ApiError) {
            quotas[account.id] = {
              limits: [],
              level: '',
              error: e.message,
            };
          }
        }
      }),
    );

    return { maxPct: Math.round(maxPct), quotas };
  }

  private async fetchFromDesktopApp(): Promise<RefreshResult | null> {
    const port = this.config.desktopAppPort;
    const token = this.config.desktopAppToken;

    const http = await import('http');
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/__openclaw__/api/quota',
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 5000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              resolve(data as RefreshResult);
            } catch {
              reject(new Error('Desktop app response parse failed'));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Desktop app timeout'));
      });
      req.end();
    });
  }

  async spinNow(account: AccountInfo, model: string): Promise<void> {
    const client = new ZhipuClient(account.apiKey);
    await client.spinWithModel(model);
  }

  async validateApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const client = new ZhipuClient(apiKey);
      await client.getQuotaLimit();
      return { valid: true };
    } catch (e) {
      if (e instanceof ApiError) {
        return { valid: false, error: e.message };
      }
      return { valid: false, error: String(e) };
    }
  }
}
