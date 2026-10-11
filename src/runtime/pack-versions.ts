import type { AchievementSave, ContentPackBinding, OrphanedProgress, OrphanedChapter } from '../domain/types.ts';
import { migratePackSave, restorePackSave, type PackMigrationResult } from '../domain/pack-migration.ts';
import { attachSaveToPack, type LoadedContentPack } from './content-pack.ts';
import type { ContentPackTransition } from './metadata.ts';
import type { ContentPackPort } from './ports.ts';

export interface PackVersionState {
  packId: string;
  packVersion: string;
  packName: string;
  rollbackVersion?: string;
  orphanedProgress: OrphanedProgress[];
  orphanedChapters: OrphanedChapter[];
}
export interface PackChangePreview extends Omit<PackMigrationResult, 'save'> {
  token: string;
  mode: 'upgrade' | 'restore';
  fromVersion: string;
  toVersion: string;
  completedCount: number;
  taskCount: number;
}
export interface PackVersionsPort {
  getVersionState(): PackVersionState;
  previewUpgrade(version: string): Promise<PackChangePreview>;
  previewRestore(): Promise<PackChangePreview>;
  applyPreview(token: string): Promise<void>;
}
interface CurrentPack { pack: LoadedContentPack; save: AchievementSave }
interface PendingChange {
  preview: PackChangePreview;
  source: LoadedContentPack;
  target: LoadedContentPack;
  signature: string;
  chatId: string;
}
interface PackVersionsOptions {
  readCurrent(): CurrentPack;
  currentChatId(): string | undefined;
  contentPacks: ContentPackPort;
  activate(pack: LoadedContentPack, transition: ContentPackTransition): Promise<void>;
}

/** The review token belongs to one chat and one exact working copy, never to an LLM request. */
export class PackVersions implements PackVersionsPort {
  private readonly options: PackVersionsOptions;
  private pending: PendingChange | undefined;
  private generation = 0;
  constructor(options: PackVersionsOptions) { this.options = options; }

  getVersionState(): PackVersionState {
    const { pack, save } = this.options.readCurrent();
    return { packId: pack.manifest.packId, packVersion: pack.manifest.packVersion, packName: pack.manifest.packName,
      ...(save.packRollback ? { rollbackVersion: save.packRollback.snapshot.packVersion! } : {}),
      orphanedProgress: structuredClone(save.orphanedProgress ?? []), orphanedChapters: structuredClone(save.orphanedChapters ?? []) };
  }
  previewUpgrade(version: string): Promise<PackChangePreview> {
    const current = this.options.readCurrent();
    return this.preview({ packId: current.pack.manifest.packId, packVersion: version }, 'upgrade');
  }
  previewRestore(): Promise<PackChangePreview> {
    const backup = this.options.readCurrent().save.packRollback?.snapshot;
    if (!backup?.packId || !backup.packVersion) throw new Error('没有可恢复的原版本快照。');
    return this.preview({ packId: backup.packId, packVersion: backup.packVersion }, 'restore');
  }
  private async preview(binding: ContentPackBinding, mode: PackChangePreview['mode']): Promise<PackChangePreview> {
    const generation = ++this.generation, initial = this.options.readCurrent(), chatId = this.chatId();
    this.pending = undefined;
    const target = await this.options.contentPacks.load(binding);
    const current = this.options.readCurrent();
    if (generation !== this.generation || initial.pack !== current.pack || chatId !== this.chatId()) throw new Error('聊天或内容版本已变化，请重新预览。');
    const now = new Date().toISOString();
    const result = mode === 'upgrade' ? migratePackSave(current.save, current.pack, target, now)
      : { save: restorePackSave(current.save, target, now), renamed: [], archived: [], archivedChapters: [], resetChapterIds: [] };
    attachSaveToPack(result.save, target);
    const preview: PackChangePreview = { token: crypto.randomUUID(), mode, fromVersion: current.pack.manifest.packVersion, toVersion: target.manifest.packVersion,
      renamed: result.renamed, archived: result.archived, archivedChapters: result.archivedChapters, resetChapterIds: result.resetChapterIds,
      completedCount: Object.keys(result.save.nodeProgress).length, taskCount: Object.keys(result.save.nodeTasks).length };
    this.pending = { preview, source: current.pack, target, signature: JSON.stringify(current.save), chatId };
    return structuredClone(preview);
  }
  async applyPreview(token: string): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.preview.token !== token) throw new Error('版本预览已失效，请重新预览。');
    this.assertCurrent(pending);
    const refreshed = await this.options.contentPacks.load({ packId: pending.target.manifest.packId, packVersion: pending.target.manifest.packVersion });
    if (refreshed.packHash !== pending.target.packHash) throw new Error('目标发布版本已改变，请重新预览。');
    const original = await this.options.contentPacks.load({ packId: pending.source.manifest.packId, packVersion: pending.source.manifest.packVersion });
    if (original.packHash !== pending.source.packHash) throw new Error('来源发布版本已改变，拒绝迁移。');
    this.assertCurrent(pending);
    const now = new Date().toISOString();
    await this.options.activate(refreshed, { source: pending.source, convert: save => {
      this.assertCurrent(pending);
      if (JSON.stringify(save) !== pending.signature) throw new Error('预览后存档已有变化，请重新预览再确认；尚未迁移。');
      return pending.preview.mode === 'upgrade' ? migratePackSave(save, pending.source, refreshed, now).save : restorePackSave(save, refreshed, now);
    } });
    if (this.pending === pending) this.pending = undefined;
  }
  private assertCurrent(pending: PendingChange): void {
    if (this.pending !== pending || this.chatId() !== pending.chatId || this.options.readCurrent().pack !== pending.source) throw new Error('聊天或内容版本已变化，版本预览失效。');
  }
  private chatId(): string {
    const chatId = this.options.currentChatId();
    if (!chatId?.trim()) throw new Error('请先打开一个聊天存档。');
    return chatId;
  }
}
