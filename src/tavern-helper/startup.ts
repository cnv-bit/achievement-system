import {
  validateContentCatalog,
  validateContentLayouts,
  buildPlayerView,
  type AchievementPlayerView,
  type ContentCatalog,
  type ContentModule,
  type ContentLayouts,
  type ContentPackTheme,
  type AchievementSave,
} from '../domain/index.ts';
import { buildJournalScene, type ImageResolver } from '../frontend/view-scene.ts';
import type { JournalScene } from '../frontend/journal-port.ts';
import { PromptingController } from '../prompting/controller.ts';
import { mountPromptingPage } from '../prompting/prompting-page.ts';
import { notifications } from '../notifications.ts';
import { AchievementRuntime } from '../runtime/achievement-runtime.ts';
import { AchievementMetadataRepository, type MetadataCommitQueue, type ContentPackTransition } from '../runtime/metadata.ts';
import { AchievementPlayerController } from '../runtime/player-controller.ts';
import type { PlayerUseCases } from '../runtime/player-port.ts';
import { RuntimeScheduler } from '../runtime/scheduler.ts';
import type { ModelContextReader } from '../runtime/model-context.ts';
import type { LoadedContentPack } from '../runtime/content-pack.ts';
import { ApiSettingsController } from '../settings/controller.ts';
import { mountSettingsPage } from '../settings/settings-page.ts';
import { SettingsRepository } from '../settings/storage.ts';
import { BackendSecrets, requestBackend } from '../settings/backend.ts';
import {
  MvuVariableContext,
  TavernAchievementMetadata,
  TavernChatSendingStorage,
  TavernChatContext,
  TavernTextGeneration,
  TavernWorldbooks,
} from './adapters.ts';

export interface GoblinAchievementsPluginHandle extends PlayerUseCases {
  initializeContent(assertCurrent?: () => void): Promise<void>;
  resume(): void;
  mountPrompting(container: HTMLElement): () => void;
  mountSettings(container: HTMLElement): () => void;
  getContentTheme(): ContentPackTheme | undefined;
  getSaveSnapshot(): AchievementSave;
  mountVersions?(container: HTMLElement): () => void;
  getPlayerScene(module: ContentModule): JournalScene;
  runManual(startFloor: number, endFloor: number, moduleIds: ContentModule[]): ReturnType<AchievementRuntime['runManual']>;
  getCurrentChapterId(): string | undefined;
  setCurrentChapter(chapterId: string): Promise<void>;
  destroy(): void;
}

export interface PluginStartupOptions {
  readModelContext?: ModelContextReader;
  layouts?: unknown;
  resolveImage?: ImageResolver;
  onPlayerViewChange?: (view: AchievementPlayerView) => void;
  contentPack?: LoadedContentPack;
  transition?: ContentPackTransition;
  mountVersions?: (container: HTMLElement) => () => void;
  queue?: MetadataCommitQueue;
  startPaused?: boolean;
  onChatChanged?: () => void;
}

function validatedCatalog(candidate: unknown): ContentCatalog {
  const validated = validateContentCatalog(candidate);
  if (validated.ok) return validated.value;
  const details = validated.issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
  throw new Error(`成就内容目录无效：${details}`);
}

export function startGoblinAchievementsPlugin(candidateCatalog: unknown, options: PluginStartupOptions = {}): GoblinAchievementsPluginHandle {
  const { readModelContext, layouts: candidateLayouts, resolveImage, onPlayerViewChange } = options;
  const catalog = validatedCatalog(structuredClone(candidateCatalog));
  const emptyLayouts: ContentLayouts = {schemaVersion:1,chapters:{},storyTrees:{},bondTrees:{},careerTrees:{},skillTrees:{},combatTrees:{},knowledgeTrees:{},maps:{}};
  const validated = validateContentLayouts(structuredClone(candidateLayouts ?? emptyLayouts), catalog);
  if (!validated.ok) throw new Error('成就布局无效：' + validated.issues.map(issue=>`${issue.path}: ${issue.message}`).join('；'));
  const layouts = validated.value;
  const chat = new TavernChatContext();
  const generation = new TavernTextGeneration();
  const worldbooks = new TavernWorldbooks();
  let playerView: AchievementPlayerView;
  const metadata = new AchievementMetadataRepository(new TavernAchievementMetadata(), catalog, {
    currentChatId: () => chat.currentChatId(),
    ...(options.queue ? { queue: options.queue } : {}),
    ...(options.contentPack ? { contentPack: options.contentPack } : {}),
    ...(options.transition ? { transition: options.transition } : {}),
    onCommitted: save => {
      playerView = buildPlayerView(catalog, save);
      try {
        onPlayerViewChange?.(structuredClone(playerView));
      } catch {
        notifications.error('存档已保存，但界面刷新失败，请重新打开手账。');
      }
    },
  });
  playerView = buildPlayerView(catalog, metadata.load());
  const settings = new SettingsRepository(SillyTavern.accountStorage, new TavernChatSendingStorage(), write => metadata.coordinate(write));
  const runtime = new AchievementRuntime({
    catalog,
    chat,
    metadata,
    settings,
    generation,
    worldbooks,
    variables: new MvuVariableContext(),
    ...(readModelContext ? { readModelContext } : {}),
    onModelCommitted: result => {
      const outcome = result.outcome;
      if (!outcome || outcome.duplicate) return;
      const skipped = outcome.rejectedProposals.length;
      if (outcome.changed) notifications.success(`本轮写入完成，接收 ${outcome.acceptedProposalIds.length} 条更新${skipped ? `，跳过 ${skipped} 条不满足条件的更新` : ''}。`);
      else if (skipped) notifications.error(`本轮更新未达成，跳过 ${skipped} 条：${outcome.rejectedProposals[0]!.reason}`);
    },
  });
  const playerController = new AchievementPlayerController(catalog, metadata);
  const settingsController = new ApiSettingsController(settings, generation, new BackendSecrets(requestBackend, window.localStorage), worldbooks);
  const promptingController = new PromptingController(settings, runtime);
  const scheduler = new RuntimeScheduler(runtime, chat, status => {
    if (status.phase === 'completed') return; // Commit entry already refreshed and notified once.
    else if (status.phase === 'error') notifications.error(status.message);
    else if (status.message) notifications.info(status.message);
  });
  const unmounts: Array<() => void> = [];
  unmounts.push(chat.onChatChanged(() => {
    if (options.onChatChanged) { options.onChatChanged(); return; }
    playerView = buildPlayerView(catalog, metadata.load());
    onPlayerViewChange?.(structuredClone(playerView));
  }));
  if (!options.startPaused) scheduler.start();

  const handle: GoblinAchievementsPluginHandle = {
    initializeContent: assertCurrent => metadata.initializeContent(assertCurrent),
    resume: () => scheduler.start(),
    mountSettings: container => mountSettingsPage(container, settingsController),
    mountPrompting: container => mountPromptingPage(container, promptingController),
    getPlayerView: () => structuredClone(playerView),
    getContentTheme: () => options.contentPack ? structuredClone(options.contentPack.theme) : undefined,
    getSaveSnapshot: () => metadata.load(),
    ...(options.mountVersions ? { mountVersions: options.mountVersions } : {}),
    getPlayerScene: module => buildJournalScene(playerView, layouts, module, resolveImage, options.contentPack?.theme),
    dispatchPlayerCommand: command => playerController.dispatch(command),
    runManual: (startFloor, endFloor, moduleIds) => runtime.runManual({ startFloor, endFloor, moduleIds }),
    getCurrentChapterId: () => runtime.currentChapterId(),
    setCurrentChapter: chapterId => runtime.setCurrentChapter(chapterId),
    destroy: () => {
      metadata.close();
      scheduler.stop();
      unmounts.splice(0).forEach(unmount => unmount());
    },
  };

  const settingsPage = document.querySelector<HTMLElement>('[data-goblin-page="settings"]');
  if (settingsPage) unmounts.push(handle.mountSettings(settingsPage));
  const promptingPage = document.querySelector<HTMLElement>('[data-goblin-page="prompting"]');
  if (promptingPage) unmounts.push(handle.mountPrompting(promptingPage));
  return handle;
}
