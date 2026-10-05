import { exampleCatalog, type AchievementPlayerView } from '../domain/index.ts';
import { bundledLayouts } from '../content/index.ts';
import { bundledContentImages } from '../content/images.ts';
import { mountJournal } from '../frontend/journal.ts';
import { notifications } from '../notifications.ts';
import { skeletonModelContext, type ModelContextReader } from '../runtime/model-context.ts';
import { BackendSecrets, requestBackend } from '../settings/backend.ts';
import { ApiSettingsController } from '../settings/controller.ts';
import { mountSettingsPage } from '../settings/settings-page.ts';
import { SettingsRepository } from '../settings/storage.ts';
import { TavernTextGeneration, TavernWorldbooks } from './adapters.ts';
import { installSettingsButton } from './settings-entry.ts';
import { startGoblinAchievementsPlugin, type GoblinAchievementsPluginHandle } from './startup.ts';

let activePlugin: GoblinAchievementsPluginHandle | undefined;
let activeJournal: ReturnType<typeof mountJournal> | undefined;
let journalRoot: HTMLElement | undefined;
let floatingEntry: HTMLButtonElement | undefined;
let floatingBadge: HTMLSpanElement | undefined;
let uninstallSettingsButton: (() => void) | undefined;
let uninstallChatListener: (() => void) | undefined;
let usingSkeletonCatalog = false;
let markingTaskNotifications = false;

function closeJournal(): void {
  activeJournal?.destroy();
  activeJournal = undefined;
  journalRoot?.remove();
  journalRoot = undefined;
}

function start(catalog: unknown, readModelContext = window.GOBLIN_ACHIEVEMENTS_MODEL_CONTEXT, layouts: unknown = window.GOBLIN_ACHIEVEMENTS_LAYOUTS): GoblinAchievementsPluginHandle {
  closeJournal();
  activePlugin?.destroy();
  activePlugin = startGoblinAchievementsPlugin(
    catalog,
    readModelContext,
    layouts,
    name => window.GOBLIN_ACHIEVEMENTS_IMAGES?.[name] ?? bundledContentImages[name],
    handlePlayerViewChange,
  );
  ensureFloatingEntry();
  handlePlayerViewChange(activePlugin.getPlayerView());
  return activePlugin;
}

function stop(): void {
  closeJournal();
  activePlugin?.destroy();
  activePlugin = undefined;
  floatingEntry?.remove();
  floatingEntry = floatingBadge = undefined;
}

function mountSettings(container: HTMLElement): () => void {
  const repository = new SettingsRepository(SillyTavern.accountStorage);
  const controller = new ApiSettingsController(repository, new TavernTextGeneration(), new BackendSecrets(requestBackend, window.localStorage), new TavernWorldbooks());
  return mountSettingsPage(container, controller);
}

function hostDocument(): Document {
  return window.parent.document;
}

function ensureJournalStyle(doc: Document): void {
  if (doc.querySelector('#goblin-achievements-journal-style')) return;
  const style = doc.createElement('style');
  style.id = 'goblin-achievements-journal-style';
  style.textContent = __GOBLIN_JOURNAL_CSS__;
  doc.head.append(style);
}

function ensureFloatingEntry(): void {
  if (floatingEntry?.isConnected) return;
  const doc = hostDocument();
  ensureJournalStyle(doc);
  floatingEntry = doc.createElement('button');
  floatingEntry.type = 'button';
  floatingEntry.className = 'goblin-achievements-entry';
  floatingEntry.title = '打开成就手账';
  floatingEntry.textContent = '✧';
  floatingEntry.addEventListener('click', openJournal);
  floatingBadge = doc.createElement('span');
  floatingBadge.className = 'goblin-achievements-entry-badge';
  floatingBadge.setAttribute('aria-hidden', 'true');
  floatingEntry.append(floatingBadge);
  doc.body.append(floatingEntry);
}

function updateFloatingEntry(view: AchievementPlayerView): void {
  ensureFloatingEntry();
  const count = view.actionableTaskCount;
  floatingBadge!.textContent = count > 99 ? '99+' : String(count);
  floatingBadge!.hidden = count === 0;
  floatingEntry!.setAttribute('aria-label', count ? `打开成就手账，有 ${view.availableTaskCount} 个任务可接取、${view.claimableTaskCount} 个成就可领取` : '打开成就手账');
}

async function markNewTasksNotified(view: AchievementPlayerView): Promise<void> {
  if (!activePlugin || markingTaskNotifications || (!view.newAvailableTaskIds.length && !view.newClaimableTaskIds.length)) return;
  markingTaskNotifications = true;
  const plugin = activePlugin;
  const availableCount = view.newAvailableTaskIds.length;
  const claimableCount = view.newClaimableTaskIds.length;
  try {
    let next = view;
    if (view.newAvailableTaskIds.length) next = await plugin.dispatchPlayerCommand({ type: 'markAvailableTasksNotified', nodeIds: view.newAvailableTaskIds });
    if (view.newClaimableTaskIds.length) next = await plugin.dispatchPlayerCommand({ type: 'markClaimableTasksNotified', nodeIds: view.newClaimableTaskIds });
    updateFloatingEntry(next);
    const messages = [availableCount ? `${availableCount} 个新任务可以接取` : '', claimableCount ? `${claimableCount} 个成就可以领取` : ''].filter(Boolean);
    notifications.info(`有 ${messages.join('，')}。`);
  } catch {
    notifications.error('任务提醒状态保存失败。');
  } finally {
    markingTaskNotifications = false;
  }
}

function handlePlayerViewChange(view: AchievementPlayerView): void {
  updateFloatingEntry(view);
  void markNewTasksNotified(view);
}

function openJournal(): void {
  if (journalRoot?.isConnected) return;
  if (!activePlugin) throw new Error('成就系统尚未初始化。');
  const doc = hostDocument();
  ensureJournalStyle(doc);
  journalRoot = doc.createElement('div');
  journalRoot.className = 'goblin-journal-overlay';
  journalRoot.dataset.goblinJournal = '';
  doc.body.append(journalRoot);
  activeJournal = mountJournal(journalRoot, activePlugin, { onClose: closeJournal });
  updateFloatingEntry(activePlugin.getPlayerView());
  if (usingSkeletonCatalog) notifications.info('当前使用内置样例内容；提示词预览与设置页面可正常测试。');
}

window.GoblinAchievementsPlugin = { start, stop, mountSettings, openJournal, notifications };

function startAvailableCatalog(): void {
  if (window.GOBLIN_ACHIEVEMENTS_CATALOG !== undefined) {
    usingSkeletonCatalog = false;
    start(window.GOBLIN_ACHIEVEMENTS_CATALOG);
    return;
  }
  const skeleton = structuredClone(exampleCatalog);
  delete skeleton.modules.bonds.people[0]?.lorebookEntry;
  usingSkeletonCatalog = true;
  const readSkeleton: ModelContextReader = () => skeletonModelContext(skeleton);
  start(skeleton, readSkeleton, bundledLayouts);
}

document.addEventListener('goblin-achievements:catalog-ready', event => {
  if (!(event instanceof CustomEvent)) return;
  usingSkeletonCatalog = false;
  start(event.detail);
  notifications.info('成就内容已载入，请重新打开手账。');
});

function initialize(): void {
  startAvailableCatalog();
  uninstallSettingsButton = installSettingsButton({
    replaceButtons: replaceScriptButtons,
    buttonEvent: getButtonEvent,
    subscribe: (event, listener) => eventOn(event, listener),
  }, openJournal);
  const chatSubscription = eventOn(tavern_events.CHAT_CHANGED, () => {
    setTimeout(() => { if (activePlugin) handlePlayerViewChange(activePlugin.getPlayerView()); }, 0);
  });
  uninstallChatListener = () => chatSubscription.stop();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();

window.addEventListener('pagehide', () => {
  uninstallSettingsButton?.();
  uninstallChatListener?.();
  stop();
}, { once: true });

export { mountSettings, openJournal, start, stop };
