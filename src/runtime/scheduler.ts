import { AchievementRuntime } from './achievement-runtime.ts';
import type { ChatContextPort } from './ports.ts';

export interface SchedulerStatus {
  phase: 'completed' | 'error' | 'idle' | 'running';
  message: string;
}

export class RuntimeScheduler {
  private readonly runtime: AchievementRuntime;
  private readonly chat: ChatContextPort;
  private readonly report: (status: SchedulerStatus) => void;
  private stops: Array<() => void> = [];
  private isRunning = false;
  private queuedMessageId: number | undefined;
  private queuedChatId: string | undefined;
  private stopped = false;

  constructor(
    runtime: AchievementRuntime,
    chat: ChatContextPort,
    report: (status: SchedulerStatus) => void,
  ) {
    this.runtime = runtime;
    this.chat = chat;
    this.report = report;
  }

  start(): void {
    if (this.stops.length > 0) return;
    this.stopped = false;
    this.stops.push(this.chat.onAssistantMessage(messageId => void this.onAssistantMessage(messageId)));
    this.stops.push(this.chat.onChatChanged(() => {
      this.queuedMessageId = this.queuedChatId = undefined;
      this.report({ phase: 'idle', message: '已切换聊天，成就存档随当前聊天切换。' });
    }));
  }

  stop(): void {
    this.stopped = true;
    this.queuedMessageId = this.queuedChatId = undefined;
    this.stops.forEach(stop => stop());
    this.stops = [];
  }

  private async onAssistantMessage(messageId: number): Promise<void> {
    if (this.stopped) return;
    if (this.isRunning) {
      this.queuedMessageId = Math.max(this.queuedMessageId ?? messageId, messageId);
      this.queuedChatId = this.chat.currentChatId();
      return;
    }
    this.isRunning = true;
    try {
      let nextMessageId: number | undefined = messageId;
      while (nextMessageId !== undefined) {
        this.queuedMessageId = this.queuedChatId = undefined;
        try {
          const completed = await this.runtime.runAutomatic(nextMessageId);
          if (completed && !this.stopped) this.report(completed.skipped ? { phase: 'idle', message: completed.response.judgementSummary } : { phase: 'completed', message: `自动判定完成，存档版本 ${completed.save.revision}。` });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!this.stopped) this.report({ phase: 'error', message });
        }
        nextMessageId = !this.stopped && this.queuedChatId === this.chat.currentChatId() ? this.queuedMessageId : undefined;
      }
    } finally {
      this.isRunning = false;
    }
  }
}
