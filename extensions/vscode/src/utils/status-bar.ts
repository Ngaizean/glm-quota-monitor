import * as vscode from 'vscode';
import type { QuotaData } from '../api/types';

export class StatusBar {
  private statusItem: vscode.StatusBarItem;

  constructor() {
    this.statusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.statusItem.name = 'GLM Quota Monitor';
    this.statusItem.command = 'glm-quota-monitor.refresh';
    this.statusItem.text = '$(globe) GLM --';
    this.statusItem.tooltip = 'GLM Quota Monitor — 点击刷新';
    this.statusItem.show();
  }

  update(maxPct: number, quotas: Record<string, QuotaData>): void {
    const pct = Math.round(maxPct);

    // 图标根据阈值变化
    let icon = '$(globe)';
    let color: string | vscode.ThemeColor | undefined;
    if (pct >= 95) {
      icon = '$(error)';
      color = new vscode.ThemeColor('errorForeground');
    } else if (pct >= 85) {
      icon = '$(warning)';
      color = new vscode.ThemeColor('notificationsWarningIcon.foreground');
    } else if (pct >= 70) {
      icon = '$(info)';
    }

    this.statusItem.text = `${icon} GLM ${pct}%`;
    this.statusItem.color = color;

    // 详细 tooltip
    const lines: string[] = ['GLM Quota Monitor'];
    for (const [id, quota] of Object.entries(quotas)) {
      if (quota.error) {
        lines.push(`\n  ⚠ ${id}: ${quota.error}`);
        continue;
      }
      const token = quota.limits.find((l) => l.type === 'TOKENS_LIMIT');
      const time = quota.limits.find((l) => l.type === 'TIME_LIMIT');
      lines.push(`\n  账号 ${id}:`);
      if (token) {
        lines.push(`    Token: ${Math.round(token.percentage)}%`);
      }
      if (time) {
        lines.push(`    Time: ${Math.round(time.percentage)}%`);
      }
    }
    this.statusItem.tooltip = new vscode.MarkdownString(lines.join('\n'));
  }

  setLoading(): void {
    this.statusItem.text = '$(loading~spin) GLM ...';
  }

  dispose(): void {
    this.statusItem.dispose();
  }
}
