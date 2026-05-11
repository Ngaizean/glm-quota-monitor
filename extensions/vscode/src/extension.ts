import * as vscode from 'vscode';
import { Config } from './utils/config';
import { QuotaService } from './utils/quota-service';
import { StatusBar } from './utils/status-bar';
import { AlertManager } from './utils/alert-manager';
import { SpinScheduler } from './utils/spin-scheduler';
import { SidebarProvider } from './sidebar/SidebarProvider';
import type { AccountInfo } from './api/types';

let config: Config;
let quotaService: QuotaService;
let statusBar: StatusBar;
let alertManager: AlertManager;
let spinScheduler: SpinScheduler;
let sidebarProvider: SidebarProvider;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('GLM Quota Monitor');
  outputChannel.appendLine('[GLM] Extension activated');

  // 初始化模块
  config = new Config(context);
  quotaService = new QuotaService(config);
  statusBar = new StatusBar();
  alertManager = new AlertManager(config);
  spinScheduler = new SpinScheduler(config, quotaService, outputChannel);

  // Sidebar
  sidebarProvider = new SidebarProvider(context.extensionUri, config);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      SidebarProvider.viewType,
      sidebarProvider,
    ),
  );

  // ========== Commands ==========

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.refresh', async () => {
      statusBar.setLoading();
      try {
        const accounts = await config.getAccounts();
        const result = await quotaService.refreshAll();
        statusBar.update(result.maxPct, result.quotas);

        // 带别名信息的更新
        const enrichedQuotas: Record<string, typeof result.quotas[string] & { alias?: string }> = {};
        for (const [id, q] of Object.entries(result.quotas)) {
          const acc = accounts.find((a) => a.id === id);
          enrichedQuotas[id] = { ...q, alias: acc?.alias };

          // 告警检查
          if (acc && !q.error) {
            const tokenPct = q.limits.find((l) => l.type === 'TOKENS_LIMIT');
            if (tokenPct) {
              alertManager.resetIfLowered(id, Math.round(tokenPct.percentage));
              alertManager.checkAndNotify(id, acc.alias, q);
            }
          }
        }

        sidebarProvider.update(accounts, result.quotas);
        outputChannel.appendLine(`[GLM] Refreshed: maxPct=${result.maxPct}, accounts=${accounts.length}`);
      } catch (e) {
        outputChannel.appendLine(`[GLM] Refresh failed: ${e}`);
        vscode.window.showErrorMessage(`GLM Quota Monitor: 刷新失败 — ${e}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.addAccount', async () => {
      const alias = await vscode.window.showInputBox({
        prompt: '输入账号别名',
        placeHolder: '如：我的账号、工作号',
        title: '添加 GLM 账号',
      });
      if (!alias) {
        return;
      }

      const apiKey = await vscode.window.showInputBox({
        prompt: '输入智谱 API Key',
        placeHolder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxx',
        title: '添加 GLM 账号 — API Key',
        password: true,
        ignoreFocusOut: true,
      });
      if (!apiKey) {
        return;
      }

      await vscode.window.withProgress(
        {
          title: '验证 API Key...',
          location: vscode.ProgressLocation.Notification,
        },
        async () => {
          const result = await quotaService.validateApiKey(apiKey);
          if (!result.valid) {
            vscode.window.showErrorMessage(`API Key 验证失败: ${result.error}`);
            return;
          }
          await config.addAccount(alias, apiKey);
          vscode.window.showInformationMessage(`账号 "${alias}" 添加成功`);
          vscode.commands.executeCommand('glm-quota-monitor.refresh');
        },
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.removeAccount', async (accountId?: string) => {
      if (!accountId) {
        const accounts = await config.getAccounts();
        const items = accounts.map((a) => ({
          label: a.alias + (a.isPrimary ? ' (主)' : ''),
          description: a.id,
          accountId: a.id,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: '选择要移除的账号',
        });
        if (!picked) {
          return;
        }
        accountId = picked.accountId;
      }

      const confirm = await vscode.window.showWarningMessage(
        `确定要移除此账号吗？`,
        { modal: true },
        '移除',
      );
      if (confirm !== '移除') {
        return;
      }

      await config.removeAccount(accountId!);
      vscode.window.showInformationMessage('账号已移除');
      vscode.commands.executeCommand('glm-quota-monitor.refresh');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.setPrimaryAccount', async (accountId?: string) => {
      if (!accountId) {
        const accounts = await config.getAccounts();
        const items = accounts.map((a) => ({
          label: a.alias,
          description: a.isPrimary ? '(当前主账号)' : '',
          accountId: a.id,
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: '选择主账号',
        });
        if (!picked) {
          return;
        }
        accountId = picked.accountId;
      }
      await config.setPrimary(accountId!);
      vscode.commands.executeCommand('glm-quota-monitor.refresh');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.spinNow', async () => {
      const account = await config.getPrimaryAccount();
      if (!account) {
        vscode.window.showWarningMessage('没有可用的账号');
        return;
      }
      try {
        await vscode.window.withProgress(
          { title: `空转中 (${config.spinModel})...`, location: vscode.ProgressLocation.Notification },
          () => quotaService.spinNow(account, config.spinModel),
        );
        vscode.window.showInformationMessage(`${account.alias}: 空转成功`);
      } catch (e) {
        vscode.window.showErrorMessage(`空转失败: ${e}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.toggleSpin', async () => {
      const cfg = vscode.workspace.getConfiguration('glmQuotaMonitor');
      const current = cfg.get<boolean>('spinEnabled', false);
      await cfg.update('spinEnabled', !current, vscode.ConfigurationTarget.Global);
      if (!current) {
        spinScheduler.start();
        vscode.window.showInformationMessage('自动空转已开启');
      } else {
        spinScheduler.stop();
        vscode.window.showInformationMessage('自动空转已关闭');
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.exportUsage', async () => {
      const accounts = await config.getAccounts();
      if (accounts.length === 0) {
        vscode.window.showWarningMessage('没有账号数据可导出');
        return;
      }

      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`glm-usage-${new Date().toISOString().slice(0, 10)}.csv`),
        filters: { 'CSV Files': ['csv'] },
      });
      if (!uri) {
        return;
      }

      // 生成 CSV
      const snapshots = config.getSnapshots();
      const lines = ['account_id,timestamp,time_pct,token_pct'];
      for (const s of snapshots) {
        lines.push(`${s.accountId},${s.timestamp},${s.timeLimitPct ?? ''},${s.tokenLimitPct ?? ''}`);
      }

      const fs = await import('fs/promises');
      await fs.writeFile(uri.fsPath, lines.join('\n'), 'utf-8');
      vscode.window.showInformationMessage(`已导出到 ${uri.fsPath}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glm-quota-monitor.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'glmQuotaMonitor');
    }),
  );

  // ========== 定时刷新 ==========

  function startRefreshTimer() {
    stopRefreshTimer();
    const intervalMs = config.refreshIntervalMinutes * 60 * 1000;
    refreshTimer = setInterval(() => {
      vscode.commands.executeCommand('glm-quota-monitor.refresh');
    }, intervalMs);
  }

  function stopRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
  }

  // 设置变更监听
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('glmQuotaMonitor')) {
        startRefreshTimer();
        spinScheduler.restart();
      }
    }),
  );

  // ========== 启动 ==========

  // 延迟 3 秒后首次刷新
  setTimeout(() => {
    vscode.commands.executeCommand('glm-quota-monitor.refresh');
  }, 3000);

  startRefreshTimer();
  spinScheduler.start();

  // 清理
  context.subscriptions.push({
    dispose: () => {
      stopRefreshTimer();
      spinScheduler.stop();
      statusBar.dispose();
      outputChannel.dispose();
    },
  });

  outputChannel.appendLine('[GLM] All modules initialized');
}

export function deactivate() {
  outputChannel?.appendLine('[GLM] Extension deactivated');
}
