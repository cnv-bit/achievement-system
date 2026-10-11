import type { AchievementPlayerView } from '../domain/index.ts';
import { mountJournal } from '../frontend/journal.ts';
import { notifications } from '../notifications.ts';
import { button, element } from '../frontend/journal-port.ts';
import { BackendSecrets, requestBackend } from '../settings/backend.ts';
import { ApiSettingsController } from '../settings/controller.ts';
import { mountSettingsPage } from '../settings/settings-page.ts';
import { SettingsRepository } from '../settings/storage.ts';
import { TavernTextGeneration, TavernWorldbooks } from './adapters.ts';
import { installSettingsButton } from './settings-entry.ts';
import { startGoblinAchievementsPlugin, type GoblinAchievementsPluginHandle } from './startup.ts';
import { selectContentPack, type LoadedContentPack } from '../runtime/content-pack.ts';
import { createContentPackPort } from './content-pack-adapter.ts';
import { validatePackBinding, type ContentPackBinding } from '../domain/index.ts';
import { PackVersions } from '../runtime/pack-versions.ts';
import type { ContentPackTransition } from '../runtime/metadata.ts';
import { mountPackVersionsPage } from '../frontend/pack-versions.ts';
import { mountAuthorPage } from '../frontend/author-page.ts';
import { AuthorEditor } from '../runtime/authoring.ts';
import { authorAssetUrl, createAuthorStoragePort } from './author-adapter.ts';

let activePlugin: GoblinAchievementsPluginHandle | undefined;
let activeJournal: ReturnType<typeof mountJournal> | undefined;
let journalRoot: HTMLElement | undefined;
let floatingEntry: HTMLButtonElement | undefined;
let floatingBadge: HTMLSpanElement | undefined;
let uninstallSettingsButton: (() => void) | undefined;
let uninstallChatListener: (() => void) | undefined;
let unmountStandaloneSettings: (() => void) | undefined;
let markingTaskNotifications = false;
const commitQueue = { tail: Promise.resolve() as Promise<unknown> };
const contentPacks = createContentPackPort(requestBackend);
let loadGeneration = 0;
let loadedChatId: string | undefined;
let activePack: LoadedContentPack | undefined;
let unmountAuthor: (() => void) | undefined;
const authorStorage = createAuthorStoragePort(requestBackend);
function openAuthor(): void {
  if (unmountAuthor) return;
  const doc = hostDocument(), previousFocus = doc.activeElement as HTMLElement | null;
  const host = doc.createElement('div'); doc.body.append(host);
  const cleanup = mountAuthorPage(host, authorStorage, { createSession: draft => new AuthorEditor(draft), assetUrl: authorAssetUrl,
    onClose: () => { unmountAuthor?.(); unmountAuthor = undefined; host.remove(); previousFocus?.focus(); } });
  unmountAuthor = () => { cleanup(); host.remove(); };
}
const versions = new PackVersions({
  contentPacks, currentChatId: () => SillyTavern.getCurrentChatId(),
  readCurrent: () => {
    if (!activePlugin || !activePack || loadedChatId !== SillyTavern.getCurrentChatId()) throw new Error('当前聊天没有已载入的发布内容包。');
    return { pack: activePack, save: activePlugin.getSaveSnapshot() };
  },
  activate: async (pack, transition) => {
    const generation = ++loadGeneration, chatId = SillyTavern.getCurrentChatId();
    if (!chatId?.trim()) throw new Error('请先打开一个聊天存档。');
    await activatePack(pack, generation, chatId, transition);
  },
});

function installPlugin(plugin: GoblinAchievementsPluginHandle): void {
  closeJournal();
  activePlugin?.destroy();
  activePlugin = plugin;
  loadedChatId = SillyTavern.getCurrentChatId();
  ensureFloatingEntry();
  floatingEntry!.disabled = false;
}

function closeJournal(): void {
  activeJournal?.destroy();
  activeJournal = undefined;
  unmountStandaloneSettings?.();
  unmountStandaloneSettings = undefined;
  journalRoot?.remove();
  journalRoot = undefined;
}

function start(catalog: unknown, readModelContext = window.GOBLIN_ACHIEVEMENTS_MODEL_CONTEXT, layouts: unknown = window.GOBLIN_ACHIEVEMENTS_LAYOUTS): GoblinAchievementsPluginHandle {
  const candidate = startGoblinAchievementsPlugin(catalog, {
    ...(readModelContext ? { readModelContext } : {}),
    layouts,
    resolveImage: name => window.GOBLIN_ACHIEVEMENTS_IMAGES?.[name],
    onPlayerViewChange: handlePlayerViewChange,
    queue: commitQueue, onChatChanged: () => undefined,
  });
  ++loadGeneration;
  activePack = undefined;
  installPlugin(candidate);
  handlePlayerViewChange(candidate.getPlayerView());
  return candidate;
}

function stop(): void {
  loadGeneration++;
  closeJournal();
  activePlugin?.destroy();
  activePlugin = undefined;
  activePack = undefined;
  loadedChatId = undefined;
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
  const chatId = SillyTavern.getCurrentChatId();
  const stillCurrent = () => activePlugin === plugin && chatId === SillyTavern.getCurrentChatId();
  let saved = false;
  const availableCount = view.newAvailableTaskIds.length;
  const claimableCount = view.newClaimableTaskIds.length;
  try {
    let next = view;
    if (view.newAvailableTaskIds.length) next = await plugin.dispatchPlayerCommand({ type: 'markAvailableTasksNotified', nodeIds: view.newAvailableTaskIds });
    if (!stillCurrent()) return;
    if (view.newClaimableTaskIds.length) next = await plugin.dispatchPlayerCommand({ type: 'markClaimableTasksNotified', nodeIds: view.newClaimableTaskIds });
    if (!stillCurrent()) return;
    saved = true;
    updateFloatingEntry(next);
    const messages = [availableCount ? `${availableCount} 个新任务可以接取` : '', claimableCount ? `${claimableCount} 个成就可以领取` : ''].filter(Boolean);
    notifications.info(`有 ${messages.join('，')}。`);
  } catch {
    if (stillCurrent()) notifications.error('任务提醒状态保存失败。');
  } finally {
    markingTaskNotifications = false;
    // A commit can reveal more tasks while this reminder is being saved; never retry a failed save in a loop.
    if (activePlugin && (saved || !stillCurrent())) void markNewTasksNotified(activePlugin.getPlayerView());
  }
}

function handlePlayerViewChange(view: AchievementPlayerView): void {
  updateFloatingEntry(view);
  activeJournal?.refresh(view);
  void markNewTasksNotified(view);
}

function openStandaloneSettings(): void {
  const doc = hostDocument();
  ensureJournalStyle(doc);
  const previousFocus = doc.activeElement as HTMLElement | null;
  journalRoot = element(doc, 'div', 'goblin-journal-overlay');
  journalRoot.dataset.goblinJournal = '';
  const book = element(doc, 'section', 'travel-journal');
  book.style.gridTemplateColumns = '1fr';
  book.setAttribute('role', 'dialog');
  book.setAttribute('aria-modal', 'true');
  book.setAttribute('aria-label', '成就系统设置');
  const page = element(doc, 'main', 'journal-page');
  const header = element(doc, 'header', 'journal-header');
  const close = button(doc, '×', closeJournal, 'journal-close');
  close.setAttribute('aria-label', '关闭设置');
  header.append(element(doc, 'h1', '', '成就系统设置'), close);
  const content = element(doc, 'div', 'journal-content journal-content-settings');
  page.append(header, element(doc, 'p', 'journal-empty', '当前聊天尚未载入内容包。请检查角色卡或存档的内容包绑定后重新加载。'), content);
  book.append(page);
  journalRoot.append(book);
  doc.body.append(journalRoot);
  const unmount = mountSettings(content);
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); closeJournal(); }
    if (event.key !== 'Tab') return;
    const controls = [...book.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')].filter(control => control.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  doc.addEventListener('keydown', onKeydown);
  unmountStandaloneSettings = () => { unmount(); doc.removeEventListener('keydown', onKeydown); previousFocus?.focus(); };
  close.focus();
}

function openJournal(): void {
  if (journalRoot?.isConnected) return;
  if (!activePlugin || loadedChatId !== SillyTavern.getCurrentChatId()) { openStandaloneSettings(); return; }
  const doc = hostDocument();
  ensureJournalStyle(doc);
  journalRoot = doc.createElement('div');
  journalRoot.className = 'goblin-journal-overlay';
  journalRoot.dataset.goblinJournal = '';
  doc.body.append(journalRoot);
  activeJournal = mountJournal(journalRoot, activePlugin, { onClose: closeJournal });
  updateFloatingEntry(activePlugin.getPlayerView());
}

window.GoblinAchievementsPlugin = { start, loadPack, stop, mountSettings, openJournal, openAuthor, notifications, versions };

function cardBindings(): { current?: ContentPackBinding; legacy?: ContentPackBinding } {
  const extension = typeof getCharData === 'function' ? getCharData('current')?.data.extensions?.goblin_achievements : undefined;
  if (extension !== undefined && (!extension || typeof extension !== 'object' || Array.isArray(extension))) throw new Error('角色卡内容包配置无效。');
  const config = extension as { contentPack?: unknown; legacyContentPack?: unknown } | undefined;
  const current = window.GOBLIN_ACHIEVEMENTS_PACK ?? config?.contentPack;
  const legacy = window.GOBLIN_ACHIEVEMENTS_LEGACY_PACK ?? config?.legacyContentPack;
  return { ...(current !== undefined ? { current: validatePackBinding(current) } : {}), ...(legacy !== undefined ? { legacy: validatePackBinding(legacy) } : {}) };
}

function assertLoadCurrent(generation: number, chatId: string): void {
  if (generation !== loadGeneration || chatId !== SillyTavern.getCurrentChatId()) throw new Error('聊天或加载请求已变化，本次内容未替换。');
}

async function activatePack(pack: LoadedContentPack, generation: number, chatId: string, transition?: ContentPackTransition): Promise<GoblinAchievementsPluginHandle> {
  let installed = false;
  const install = () => {
    if (chatId !== SillyTavern.getCurrentChatId()) throw new Error('聊天已切换，未激活旧内容包。');
    installPlugin(candidate);
    activePack = pack;
    installed = true;
    candidate.resume();
  };
  const candidate = startGoblinAchievementsPlugin(pack.catalog, {
    ...(window.GOBLIN_ACHIEVEMENTS_MODEL_CONTEXT ? { readModelContext: window.GOBLIN_ACHIEVEMENTS_MODEL_CONTEXT } : {}),
    layouts: pack.layouts, resolveImage: ref => pack.images[ref], onPlayerViewChange: view => {
      // Activate synchronously after confirmed binding, before older queued commands can run.
      if (!installed) install();
      if (activePlugin === candidate) handlePlayerViewChange(view);
    }, contentPack: pack, queue: commitQueue, startPaused: true, onChatChanged: () => undefined,
    ...(transition ? { transition } : {}), mountVersions: container => mountPackVersionsPage(container, versions) });
  try {
    await candidate.initializeContent(() => assertLoadCurrent(generation, chatId));
    if (!installed) { assertLoadCurrent(generation, chatId); install(); }
    if (activePlugin === candidate) handlePlayerViewChange(candidate.getPlayerView());
    return candidate;
  } catch (error) {
    if (activePlugin !== candidate) candidate.destroy();
    throw error;
  }
}

/** This chooses defaults only for an empty chat; existing chat bindings always win. */
async function loadPack(defaultBinding?: ContentPackBinding): Promise<GoblinAchievementsPluginHandle> {
  const generation = ++loadGeneration, chatId = SillyTavern.getCurrentChatId();
  if (typeof chatId !== 'string' || !chatId.trim()) throw new Error('请先打开一个聊天存档，再载入内容包。');
  const configured = cardBindings();
  const binding = selectContentPack(SillyTavern.chatMetadata.goblin_achievements, defaultBinding ?? configured.current, configured.legacy);
  const pack = await contentPacks.load(binding);
  assertLoadCurrent(generation, chatId);
  return activatePack(pack, generation, chatId);
}

async function startAvailableCatalog(): Promise<void> {
  const configured = cardBindings();
  const save = SillyTavern.chatMetadata.goblin_achievements as { packId?: unknown } | undefined;
  if (configured.current || configured.legacy || save?.packId !== undefined) { await loadPack(); return; }
  ++loadGeneration;
  if (window.GOBLIN_ACHIEVEMENTS_CATALOG !== undefined) { start(window.GOBLIN_ACHIEVEMENTS_CATALOG); return; }
  throw new Error('当前聊天未绑定内容包，请配置角色卡的内容包绑定后重新加载。');
}

function reloadCurrentContent(): void {
  void startAvailableCatalog().catch(error => notifications.error(error instanceof Error ? error.message : '成就内容载入失败，保留原实例。'));
}

document.addEventListener('goblin-achievements:catalog-ready', event => {
  if (!(event instanceof CustomEvent)) return;
  try {
    ++loadGeneration;
    start(event.detail);
    notifications.info('成就内容已载入，请重新打开手账。');
  } catch (error) { notifications.error(error instanceof Error ? error.message : '成就内容载入失败，保留原实例。'); }
});

function initialize(): void {
  reloadCurrentContent();
  uninstallSettingsButton = installSettingsButton({
    replaceButtons: replaceScriptButtons,
    buttonEvent: getButtonEvent,
    subscribe: (event, listener) => eventOn(event, listener),
  }, openJournal, openAuthor);
  const chatSubscription = eventOn(tavern_events.CHAT_CHANGED, () => {
    closeJournal();
    if (floatingEntry) floatingEntry.disabled = true;
    reloadCurrentContent();
  });
  uninstallChatListener = () => chatSubscription.stop();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
else initialize();

window.addEventListener('pagehide', () => {
  unmountAuthor?.(); unmountAuthor = undefined;
  uninstallSettingsButton?.();
  uninstallChatListener?.();
  stop();
}, { once: true });

export { mountSettings, openJournal, openAuthor, start, loadPack, stop };
