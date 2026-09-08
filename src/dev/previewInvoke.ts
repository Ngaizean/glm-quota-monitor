// 浏览器预览模式（?preview=...）下模拟 Tauri IPC，让设置页无需后端即可渲染。
// 仅在 dev preview 生效，不影响 Tauri 运行时。
import { isPreviewMode } from "../lib/runtime";

type CommandTable = Record<string, (args: Record<string, unknown>) => unknown>;

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const distribution = {
  accounts: [
    { account_id: "acc-official", alias: "官方订阅", kind: "official", base_url: "", model: "gpt-5.3", reasoning_effort: "high" },
    { account_id: "acc-relay", alias: "中转站 A", kind: "relay", base_url: "https://relay.example.com/v1", model: "gpt-5.6-sol", reasoning_effort: "medium" },
    { account_id: "acc-relay2", alias: "中转站 B", kind: "relay", base_url: "https://relay-b.example.com/v1", model: "gpt-6-astra", reasoning_effort: "low" },
  ],
  devices: [
    { host: "gpu-server", account_id: "acc-relay", follow_local: false, model: "", reasoning_effort: "", auto_sync: true, status: "verified", last_sync: iso(3_600_000), last_error: null },
    { host: "lab-master", account_id: null, follow_local: true, model: "gpt-5.6-sol", reasoning_effort: "high", auto_sync: false, status: "failed", last_sync: null, last_error: "SSH 连接超时" },
  ],
  local_account_id: "acc-official",
  cloud_account_id: "acc-relay",
  cloud_account_ids: ["acc-relay"],
};

const accounts = [
  { id: "acc-glm", alias: "智谱主账号", purpose: "产品开发", platform: "zhipu", level: "max", is_active: true, is_primary: true },
  { id: "acc-glm2", alias: "智谱备用", purpose: "备用", platform: "zhipu", level: "pro", is_active: true, is_primary: false },
  { id: "acc-ds", alias: "DeepSeek", purpose: "推理", platform: "deepseek", level: "api", is_active: true, is_primary: false },
];

const quota = {
  level: "max",
  last_active: iso(540_000),
  limits: [
    { type: "TOKENS_LIMIT", percentage: 38, nextResetTime: now + 2 * 3_600_000, unit: 3 },
    { type: "TOKENS_LIMIT", percentage: 67, nextResetTime: now + 3 * 86_400_000, unit: 6 },
    { type: "MCP_MONTHLY", percentage: 24, nextResetTime: now + 18 * 86_400_000 },
  ],
};

const COMMANDS: CommandTable = {
  get_setting: () => null,
  list_accounts: () => accounts,
  get_quota: () => quota,
  get_usage_summary: () => ({ total_tokens: 1_024_800, total_calls: 142 }),
  get_token_history: () => [],
  get_cost_estimate: () => ({ total: 18.4 }),
  get_alert_rules: () => [],
  get_alert_muted: () => false,
  get_agent_bindings: () => [],
  get_default_model: () => "glm-4.6",
  get_custom_models: () => [],
  get_unit_price: () => ({}),
  get_spin_status: () => ({ enabled: false }),
  get_distribution_state: () => distribution,
  get_codex_role: () => "owner",
  get_codex_gist_url: () => "https://gist.github.com/demo/abc123",
  get_codex_proxy: () => "",
  get_codex_auto_upload: () => true,
  get_codex_auto_sync: () => true,
  get_codex_sync_info: () => ({ last_upload: iso(7_200_000), last_sync: iso(600_000) }),
  get_codex_runtime_config: () => ({
    active_mode: "official",
    relay_base_url: "https://relay.example.com/v1",
    relay_model: "gpt-5.6-sol",
    relay_key_configured: true,
    active_official_account_id: "acc-official",
  }),
  get_codex_radar: () => ({
    best_model: "GPT-5.6 Sol xhigh",
    best_score: 106.4,
    probability_24h: 0.14,
    probability_level: "low",
    updated_at: iso(360_000),
    daily_models: ["GPT-5.6 Sol medium"],
    hard_problem_models: ["GPT-5.6 Sol ultra"],
  }),
  get_ssh_override_state: () => [],
  get_sub2api_config: () => ({}),
  get_deepseek_balance: () => ({ balance: 126.4 }),
  get_deepseek_balance_history: () => [],
  get_deepseek_models: () => ["deepseek-chat", "deepseek-reasoner"],
  mask_deepseek_api_key: () => "sk-***preview",
  get_api_key_raw: () => "sk-preview",
  get_deepseek_api_key_raw: () => "sk-preview",
  read_local_codex_auth: () => ({ exists: true, account_id: "acc-official" }),
  scan_ssh_hosts: () => [
    { alias: "gpu-server", hostname: "192.168.1.10", user: "ngaizean", port: 22, identity_file: "~/.ssh/id_ed25519", has_local_key: true },
    { alias: "lab-master", hostname: "lab.example.edu", user: "root", port: 2222, identity_file: null, has_local_key: false },
  ],
  has_ssh_password: () => false,
  check_ssh_passwordless: () => true,
  ssh_check_codex: () => true,
  ssh_check_claude_code: () => ({
    installed: true,
    base_url: "https://open.bigmodel.cn/api/anthropic",
    model: "glm-4.6",
    platform: "glm",
  }),
  fetch_models: () => ["glm-4.6", "glm-4.5-air"],
  get_relay_usage: () => ({
    isValid: true,
    planName: "钱包余额",
    mode: "unrestricted",
    balance: 480,
    remaining: 480,
    unit: "USD",
    today: { cost: 1.5, actualCost: 1.2, totalTokens: 128_400, requests: 18 },
    total: { cost: 20, actualCost: 18, totalTokens: 1_024_800, requests: 142 },
    fetchedAt: iso(300_000),
  }),
};

export function installPreviewInvoke(): void {
  if (!isPreviewMode()) return;
  const w = window as typeof window & {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      transformCallback?: (callback: (response: unknown) => void, once?: boolean) => number;
    };
  };
  let callbackId = 0;
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd, args = {}) =>
      Promise.resolve(
        Object.prototype.hasOwnProperty.call(COMMANDS, cmd)
          ? COMMANDS[cmd](args)
          : null,
      ),
    // 事件监听（@tauri-apps/api/event）依赖 transformCallback 注册回调
    transformCallback: (callback) => {
      callbackId += 1;
      const key = `_${callbackId}`;
      (w as unknown as Record<string, unknown>)[key] = callback;
      return callbackId;
    },
  };
}
