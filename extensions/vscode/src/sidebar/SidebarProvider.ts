import * as vscode from 'vscode';
import { Config } from '../utils/config';
import type { AccountInfo, QuotaData } from '../api/types';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'glm-quota-monitor.sidebar';
  private view?: vscode.WebviewView;
  private currentAccounts: AccountInfo[] = [];
  private currentQuotas: Record<string, QuotaData> = {};

  constructor(
    private extensionUri: vscode.Uri,
    private config: Config,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.command) {
        case 'refresh':
          vscode.commands.executeCommand('glm-quota-monitor.refresh');
          break;
        case 'addAccount':
          vscode.commands.executeCommand('glm-quota-monitor.addAccount');
          break;
        case 'removeAccount':
          vscode.commands.executeCommand('glm-quota-monitor.removeAccount', msg.accountId);
          break;
        case 'setPrimary':
          vscode.commands.executeCommand('glm-quota-monitor.setPrimaryAccount', msg.accountId);
          break;
        case 'spinNow':
          vscode.commands.executeCommand('glm-quota-monitor.spinNow');
          break;
        case 'openSettings':
          vscode.commands.executeCommand('glm-quota-monitor.openSettings');
          break;
      }
    });
  }

  update(accounts: AccountInfo[], quotas: Record<string, QuotaData>): void {
    this.currentAccounts = accounts;
    this.currentQuotas = quotas;
    if (this.view) {
      this.view.webview.postMessage({
        command: 'update',
        accounts,
        quotas,
      });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-sideBar-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-focusBorder);
      --card: var(--vscode-editorWidget-background, var(--vscode-sideBarSectionHeader-background));
      --border: var(--vscode-sideBar-border, var(--vscode-widget-border, transparent));
      --danger: var(--vscode-errorForeground);
      --success: #4caf50;
      --warning: #ff9800;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--fg);
      background: var(--bg);
      padding: 12px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .header h2 {
      font-size: 14px;
      font-weight: 600;
    }
    .header-actions {
      display: flex;
      gap: 6px;
    }
    .btn {
      background: var(--card);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .btn-danger { color: var(--danger); border-color: var(--danger); }

    .account-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
    }
    .account-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .account-name {
      font-weight: 600;
      font-size: 13px;
    }
    .primary-badge {
      font-size: 10px;
      background: var(--accent);
      color: #fff;
      padding: 1px 6px;
      border-radius: 3px;
    }
    .account-actions {
      display: flex;
      gap: 4px;
    }
    .account-actions button {
      background: none;
      border: none;
      color: var(--muted);
      cursor: pointer;
      font-size: 12px;
      padding: 2px 4px;
    }
    .account-actions button:hover { color: var(--fg); }

    .quota-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
    }
    .quota-label {
      font-size: 11px;
      color: var(--muted);
      min-width: 48px;
    }
    .quota-bar {
      flex: 1;
      height: 6px;
      background: var(--border);
      border-radius: 3px;
      overflow: hidden;
    }
    .quota-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .quota-fill.safe { background: var(--success); }
    .quota-fill.warning { background: var(--warning); }
    .quota-fill.danger { background: var(--danger); }
    .quota-pct {
      font-size: 11px;
      min-width: 36px;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .level-tag {
      display: inline-block;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
      margin-top: 6px;
      background: var(--accent);
      color: #fff;
    }

    .error-msg {
      font-size: 11px;
      color: var(--danger);
      margin-top: 4px;
    }

    .empty {
      text-align: center;
      padding: 32px 16px;
      color: var(--muted);
    }
    .empty-icon { font-size: 32px; margin-bottom: 8px; }
    .empty p { margin-bottom: 12px; }

    .footer {
      margin-top: 12px;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>GLM Quota Monitor</h2>
    <div class="header-actions">
      <button class="btn" onclick="post('refresh')" title="刷新">&#x21BB;</button>
      <button class="btn" onclick="post('addAccount')" title="添加账号">+</button>
    </div>
  </div>

  <div id="content"></div>

  <div class="footer">
    <button class="btn" onclick="post('spinNow')">空转</button>
    <button class="btn" onclick="post('openSettings')">设置</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function post(cmd, data) {
      vscode.postMessage(Object.assign({ command: cmd }, data || {}));
    }

    function pctClass(pct) {
      if (pct >= 95) return 'danger';
      if (pct >= 70) return 'warning';
      return 'safe';
    }

    function formatReset(ts) {
      if (!ts) return '';
      const d = new Date(ts * 1000);
      return '重置: ' + d.toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    }

    function render(accounts, quotas) {
      const el = document.getElementById('content');
      if (!accounts || accounts.length === 0) {
        el.innerHTML = '<div class="empty"><div class="empty-icon">🔑</div><p>还没有添加账号</p><button class="btn btn-primary" onclick="post(\\'addAccount\\')">添加 API Key</button></div>';
        return;
      }

      let html = '';
      for (const acc of accounts) {
        const q = quotas && quotas[acc.id];
        html += '<div class="account-card">';

        // header
        html += '<div class="account-header">';
        html += '<span class="account-name">' + escapeHtml(acc.alias) + '</span>';
        if (acc.isPrimary) {
          html += '<span class="primary-badge">主</span>';
        }
        html += '<div class="account-actions">';
        if (!acc.isPrimary) {
          html += '<button onclick="post(\\'setPrimary\\',{accountId:\\''+acc.id+'\\'})" title="设为主账号">★</button>';
        }
        html += '<button onclick="post(\\'removeAccount\\',{accountId:\\''+acc.id+'\\'})" title="移除">✕</button>';
        html += '</div></div>';

        if (q && q.error) {
          html += '<div class="error-msg">' + escapeHtml(q.error) + '</div>';
        } else if (q && q.limits && q.limits.length > 0) {
          for (const lim of q.limits) {
            const pct = Math.round(lim.percentage);
            const label = lim.type === 'TOKENS_LIMIT' ? 'Token' : lim.type === 'TIME_LIMIT' ? 'Time' : lim.type;
            html += '<div class="quota-row">';
            html += '<span class="quota-label">' + label + '</span>';
            html += '<div class="quota-bar"><div class="quota-fill ' + pctClass(pct) + '" style="width:' + Math.min(pct, 100) + '%"></div></div>';
            html += '<span class="quota-pct">' + pct + '%</span>';
            html += '</div>';
            if (lim.nextResetTime) {
              html += '<div style="font-size:10px;color:var(--muted);margin-left:56px">' + formatReset(lim.nextResetTime) + '</div>';
            }
          }
          if (q.level) {
            html += '<span class="level-tag">' + escapeHtml(q.level) + '</span>';
          }
        } else if (!q) {
          html += '<div style="font-size:11px;color:var(--muted)">加载中...</div>';
        }

        html += '</div>';
      }
      el.innerHTML = html;
    }

    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    window.addEventListener('message', (e) => {
      const msg = e.data;
      if (msg.command === 'update') {
        render(msg.accounts, msg.quotas);
      }
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
