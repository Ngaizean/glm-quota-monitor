import * as vscode from 'vscode';
import { Config } from './config';
import type { QuotaData, AlertState } from '../api/types';

export class AlertManager {
  constructor(private config: Config) {}

  checkAndNotify(
    accountId: string,
    accountAlias: string,
    quota: QuotaData,
  ): void {
    if (quota.error) {
      return;
    }

    const thresholds = this.config.alertThresholds.sort((a, b) => a - b);
    const tokenPct = quota.limits.find((l) => l.type === 'TOKENS_LIMIT');
    if (!tokenPct) {
      return;
    }

    const pct = Math.round(tokenPct.percentage);
    const states = this.config.getAlertStates();
    const state: AlertState = states[accountId] || { lastAlertedPct: 0, lastAlertedTime: 0 };

    // 找到应该触发的最高阈值
    let triggeredThreshold: number | undefined;
    for (const threshold of thresholds) {
      if (pct >= threshold && state.lastAlertedPct < threshold) {
        triggeredThreshold = threshold;
      }
    }

    if (triggeredThreshold === undefined) {
      return;
    }

    // 防抖：同一阈值 10 分钟内不重复
    const now = Date.now();
    if (now - state.lastAlertedTime < 10 * 60 * 1000) {
      return;
    }

    vscode.window.showWarningMessage(
      `GLM Quota Alert: ${accountAlias} 已使用 ${pct}%（阈值 ${triggeredThreshold}%）`,
    );

    this.config.setAlertState(accountId, {
      lastAlertedPct: triggeredThreshold,
      lastAlertedTime: now,
    });
  }

  /** 百分比下降时重置告警状态（额度重置后） */
  resetIfLowered(accountId: string, newPct: number): void {
    const states = this.config.getAlertStates();
    const state = states[accountId];
    if (state && newPct < state.lastAlertedPct) {
      this.config.setAlertState(accountId, {
        lastAlertedPct: 0,
        lastAlertedTime: 0,
      });
    }
  }
}
