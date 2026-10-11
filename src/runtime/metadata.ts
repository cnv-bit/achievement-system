import {
  emptyAchievementSave,
  loadAchievementSave,
  validateAchievementSave,
  type AchievementSave,
  type ContentCatalog,
  type JsonValue,
} from '../domain/index.ts';
import type { AchievementMetadataPort } from './ports.ts';
import { attachSaveToPack, type LoadedContentPack } from './content-pack.ts';

function isEmptyMetadata(candidate: unknown): boolean {
  return candidate === undefined
    || candidate === null
    || (typeof candidate === 'object' && !Array.isArray(candidate) && Object.keys(candidate).length === 0);
}

export type MetadataCommitQueue = {
  tail: Promise<unknown>;
  saving?: { chatId: string | undefined; previous: AchievementSave };
};
export interface ContentPackTransition {
  source: LoadedContentPack;
  convert(save: AchievementSave): AchievementSave;
}

export class AchievementMetadataRepository {
  private readonly port: AchievementMetadataPort;
  private readonly catalog: ContentCatalog | undefined;
  private readonly queue: MetadataCommitQueue;
  private readonly contentPack: LoadedContentPack | undefined;
  private readonly transition: ContentPackTransition | undefined;
  private readonly boundChatId: string | undefined;
  private closed = false;
  private readonly currentChatId: (() => string) | undefined;
  private readonly onCommitted: ((save: AchievementSave) => void) | undefined;

  constructor(port: AchievementMetadataPort, catalog?: ContentCatalog, options: {
    currentChatId?: () => string;
    onCommitted?: (save: AchievementSave) => void;
    queue?: MetadataCommitQueue;
    contentPack?: LoadedContentPack;
    transition?: ContentPackTransition;
  } = {}) {
    this.port = port;
    this.catalog = catalog;
    this.currentChatId = options.currentChatId;
    this.onCommitted = options.onCommitted;
    this.queue = options.queue ?? { tail: Promise.resolve() };
    this.contentPack = options.contentPack;
    this.transition = options.transition;
    if (this.transition && !this.contentPack) throw new Error('版本迁移必须有已校验的目标内容包。');
    this.boundChatId = options.contentPack ? options.currentChatId?.() : undefined;
  }

  load(): AchievementSave {
    if (this.closed) throw new Error('成就内容实例已更换，本次结果未写入。');
    if (this.boundChatId !== undefined && this.boundChatId !== this.currentChatId?.()) throw new Error('聊天已切换，请等待对应内容包载入。');
    const confirmed = this.confirmedSave();
    if (this.contentPack) {
      const source = this.transition?.source;
      const matchesSource = source && confirmed.packId === source.manifest.packId && confirmed.packVersion === source.manifest.packVersion;
      const migrated = matchesSource ? this.transition!.convert(attachSaveToPack(confirmed, source)) : confirmed;
      return attachSaveToPack(migrated, this.contentPack);
    }
    if (confirmed.packId !== undefined) throw new Error('存档已绑定内容包，不能使用无版本的内联目录。');
    return confirmed;
  }

  private confirmedSave(): AchievementSave {
    const saving = this.queue.saving;
    const stored = saving && saving.chatId === this.currentChatId?.() ? saving.previous : this.port.read();
    const validated = isEmptyMetadata(stored) ? { ok: true as const, value: structuredClone(emptyAchievementSave) } : loadAchievementSave(stored, this.transition?.source.catalog ?? this.catalog);
    if (!validated.ok) {
      const details = validated.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
      throw new Error(`当前聊天的成就存档无效：${details}`);
    }
    return structuredClone(validated.value);
  }

  /** Bind only after the entire release has passed validation; no progress is invented. */
  initializeContent(assertCurrent?: () => void): Promise<void> {
    if (!this.contentPack) return Promise.resolve();
    return this.commit(save => {
      assertCurrent?.();
      const stored = this.port.read() as Partial<AchievementSave> | undefined;
      const unchanged = stored?.schemaVersion === 7 && stored.packId === save.packId && stored.packVersion === save.packVersion && stored.packHash === save.packHash;
      if (unchanged) {
        // Reloading a pinned release still publishes the latest queued snapshot before instance replacement.
        this.onCommitted?.(structuredClone(save));
        return { save, result: undefined };
      }
      const next = { ...save, revision: this.confirmedSave().revision + 1 };
      if (stored && Object.keys(stored).length && stored.packId === undefined && next.migrationBackup === undefined) next.migrationBackup = structuredClone(stored) as unknown as JsonValue;
      return { save: next, result: undefined };
    });
  }

  /** All callers enqueue intent; the latest confirmed save is read inside the queue. */
  commit<T>(apply: (save: AchievementSave) => { save: AchievementSave; result: T }): Promise<T> {
    return this.coordinate(async assertTarget => {
      const previous = this.load();
      const { save, result } = apply(previous);
      if (save === previous) return result;
      // Pack attachment is provisional until saveMetadata succeeds; other instances see the original binding.
      this.queue.saving = { chatId: this.currentChatId?.(), previous: this.confirmedSave() };
      try {
        await this.write(save);
        assertTarget();
      } finally {
        delete this.queue.saving;
      }
      this.onCommitted?.(structuredClone(save));
      return result;
    });
  }

  /** Chat settings use the same saveMetadata channel and therefore the same queue. */
  coordinate<T>(action: (assertTarget: () => void) => Promise<T>): Promise<T> {
    const chatId = this.currentChatId?.();
    const assertTarget = () => {
      if (this.closed) throw new Error('成就内容实例已更换，本次结果未写入。');
      if (this.boundChatId !== undefined && this.boundChatId !== this.currentChatId?.()) throw new Error('聊天已切换，本次结果未写入。');
      if (chatId !== this.currentChatId?.()) throw new Error('聊天已切换，本次结果未写入。');
    };
    const pending = this.queue.tail.then(async () => {
      assertTarget();
      const result = await action(assertTarget);
      assertTarget();
      return result;
    });
    // Only the queue tail recovers; the caller still receives the original rejection.
    this.queue.tail = pending.catch(() => undefined);
    return pending;
  }

  close(): void { this.closed = true; }

  private async write(nextState: AchievementSave): Promise<void> {
    const validated = validateAchievementSave(nextState);
    if (!validated.ok) throw new Error('拒绝写入无效的成就存档。');
    await this.port.write(structuredClone(validated.value) as unknown as Record<string, unknown>);
  }
}
