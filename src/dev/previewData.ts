import type { Account, QuotaData, RelayUsageView } from "../types";
import type { CodexRadarData } from "../popover/useDashboardData";

export const PREVIEW_ACCOUNTS: Account[] = [
  { id: "preview-glm", alias: "工作空间 · 主账号", purpose: "产品开发", platform: "zhipu", level: "max", is_active: true, is_primary: true },
  { id: "preview-codex", alias: "Codex Personal", purpose: "个人研究", platform: "codex", level: "pro", is_active: true, is_primary: false },
  { id: "preview-relay", alias: "Codex Relay", purpose: "团队中转", platform: "codex", level: "钱包余额", is_active: true, is_primary: false },
  { id: "preview-deepseek", alias: "DeepSeek API", purpose: "备用推理", platform: "deepseek", level: "api", is_active: true, is_primary: false },
];

export const PREVIEW_QUOTAS: Record<string, QuotaData> = {
  "preview-glm": {
    level: "max",
    last_active: new Date(Date.now() - 9 * 60_000).toISOString(),
    limits: [
      { type: "TOKENS_LIMIT", percentage: 38, nextResetTime: Date.now() + 2 * 3600_000, unit: 3 },
      { type: "TOKENS_LIMIT", percentage: 67, nextResetTime: Date.now() + 4 * 86400_000, unit: 6 },
      { type: "MCP_MONTHLY", percentage: 24, nextResetTime: Date.now() + 18 * 86400_000 },
    ],
  },
  "preview-codex": {
    level: "pro",
    last_active: new Date(Date.now() - 42 * 60_000).toISOString(),
    limits: [
      { type: "TOKENS_LIMIT", percentage: 22, nextResetTime: Date.now() + 3 * 3600_000, unit: 3 },
      { type: "TOKENS_LIMIT", percentage: 44, nextResetTime: Date.now() + 3 * 86400_000, unit: 6 },
    ],
  },
  "preview-deepseek": {
    level: "api",
    last_active: new Date(Date.now() - 2 * 3600_000).toISOString(),
    limits: [
      { type: "DEEPSEEK_BALANCE", percentage: 0, nextResetTime: 0, currentValue: 126.4 },
    ],
  },
  "preview-relay": {
    level: "钱包余额",
    last_active: new Date(Date.now() - 18 * 60_000).toISOString(),
    limits: [
      { type: "RELAY_BALANCE", percentage: 0, nextResetTime: 0, currentValue: 480, remaining: 480 },
    ],
  },
};

export const PREVIEW_RELAY_USAGE: RelayUsageView = {
  isValid: true,
  planName: "钱包余额",
  mode: "unrestricted",
  balance: 480,
  remaining: 480,
  unit: "USD",
  today: { cost: 1.5, actualCost: 1.2, totalTokens: 128_400, inputTokens: 96_200, outputTokens: 32_200, requests: 18 },
  total: { cost: 20, actualCost: 18, totalTokens: 1_024_800, inputTokens: 768_600, outputTokens: 256_200, requests: 142 },
  fetchedAt: new Date().toISOString(),
};

export const PREVIEW_RADAR: CodexRadarData = {
  best_model: "GPT-5.6 Sol xhigh",
  best_score: 106.4,
  probability_24h: 0.14,
  probability_level: "low",
  updated_at: new Date(Date.now() - 6 * 60_000).toISOString(),
  daily_models: ["GPT-5.6 Sol medium", "GPT-5.6 Sol high"],
  hard_problem_models: ["GPT-5.6 Sol ultra", "GPT-5.6 Sol max"],
};
