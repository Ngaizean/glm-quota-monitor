import * as vscode from 'vscode';
import { Config } from './config';
import { QuotaService } from './quota-service';
import type { AccountInfo } from '../api/types';

export class SpinScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private output: vscode.OutputChannel;

  constructor(
    private config: Config,
    private quotaService: QuotaService,
    output: vscode.OutputChannel,
  ) {
    this.output = output;
  }

  start(): void {
    this.stop();
    if (!this.config.spinEnabled) {
      return;
    }

    const intervalMs = this.config.spinIntervalMinutes * 60 * 1000;
    this.output.appendLine(`[Spin] 自动空转已启动，间隔 ${this.config.spinIntervalMinutes} 分钟，模型 ${this.config.spinModel}`);

    // 首次延迟 30 秒
    setTimeout(() => this.doSpin(), 30_000);

    this.timer = setInterval(() => this.doSpin(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  restart(): void {
    this.start();
  }

  async doSpin(): Promise<void> {
    const accounts = await this.config.getAccounts();
    const model = this.config.spinModel;

    for (const account of accounts) {
      try {
        await this.quotaService.spinNow(account, model);
        this.output.appendLine(`[Spin] ${account.alias}: 空转成功 (${model})`);
      } catch (e) {
        this.output.appendLine(`[Spin] ${account.alias}: 空转失败 — ${e}`);
      }
    }
  }
}
