import * as https from 'https';
import * as http from 'http';
import type {
  ApiResponse,
  QuotaData,
  ModelUsageData,
  ToolUsageData,
  ModelListResponse,
} from './types';

const BASE_URL = 'https://open.bigmodel.cn';

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public isUnauthorized = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function request<T>(path: string, apiKey: string, method = 'GET', body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };
    let postData: string | undefined;
    if (body) {
      postData = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }

    const req = mod.request(
      url,
      {
        method,
        headers,
        timeout: 15000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode === 401) {
            reject(new ApiError(401, 'API Key 无效或已过期', true));
            return;
          }

          // 模型列表接口不走 ApiResponse 包装
          if (path.includes('/api/paas/v4/models')) {
            try {
              resolve(JSON.parse(text));
            } catch {
              reject(new ApiError(-1, `模型列表解析失败: ${text.slice(0, 200)}`));
            }
            return;
          }

          try {
            const parsed: ApiResponse<T> = JSON.parse(text);
            if (!parsed.success || parsed.code !== 200) {
              reject(
                new ApiError(parsed.code, parsed.msg || 'Unknown API error'),
              );
              return;
            }
            if (parsed.data === undefined || parsed.data === null) {
              reject(new ApiError(parsed.code, 'No data in response'));
              return;
            }
            resolve(parsed.data);
          } catch {
            reject(
              new ApiError(-1, `响应解析失败: ${text.slice(0, 300)}`),
            );
          }
        });
      },
    );

    req.on('error', (err) => reject(new ApiError(-1, `请求失败: ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new ApiError(-1, '请求超时'));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

export class ZhipuClient {
  constructor(private apiKey: string) {}

  /** 查询额度限制 */
  getQuotaLimit(): Promise<QuotaData> {
    return request('/api/monitor/usage/quota/limit', this.apiKey);
  }

  /** 查询模型用量 */
  getModelUsage(startTime: string, endTime: string): Promise<ModelUsageData> {
    return request(
      `/api/monitor/usage/model-usage?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`,
      this.apiKey,
    );
  }

  /** 查询工具用量 */
  getToolUsage(startTime: string, endTime: string): Promise<ToolUsageData> {
    return request(
      `/api/monitor/usage/tool-usage?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`,
      this.apiKey,
    );
  }

  /** 获取可用模型列表 */
  listModels(): Promise<ModelListResponse> {
    return request('/api/paas/v4/models', this.apiKey);
  }

  /** 空转：使用 Anthropic 兼容接口触发计时器 */
  async spinWithModel(model: string): Promise<void> {
    await request('/api/anthropic/v1/messages', this.apiKey, 'POST', {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });
  }
}
