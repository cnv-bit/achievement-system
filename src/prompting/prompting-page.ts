import { CONTENT_MODULES, type ContentModule } from '../domain/index.ts';
import type { RuntimePreview } from '../runtime/achievement-runtime.ts';
import type { RuntimeSettings } from '../settings/model.ts';
import type { ModelGroupOption } from '../runtime/model-context.ts';
import { errorMessage, requiredElement, setStatus } from '../settings/dom.ts';
import { PromptingController } from './controller.ts';

const MODULE_LABELS: Record<ContentModule, string> = {
  adventure: '冒险与故事', bonds: '人物与羁绊', careers: '职业与成长', abilities: '战斗与技艺',
  knowledge: '知识体系', travel: '旅行与探索', journal: '随手日记',
};

type PromptSlot = 'task' | 'reasoning' | ContentModule;

const PROMPTING_TEMPLATE = `
<form data-prompting-form class="journal-admin-form">
  <p class="journal-form-note">手动模式必须先生成完整预览，发送按钮只会发出这份已预览快照。</p>
  <details open><summary>正文范围与发送方式</summary>
    <div class="journal-form-grid">
      <label>起始楼层 <input name="start-floor" type="number" min="0"></label>
      <label>结束楼层 <input name="end-floor" type="number" min="0"></label>
      <label>每次正文数 <input name="body-rounds" type="number" min="1"></label>
      <label>发送方式 <select name="send-mode"><option value="manual">手动</option><option value="automatic">自动</option></select></label>
      <label>每新增几篇正文自动发送 <input name="auto-every" type="number" min="1"></label>
      <label>当前剧情章节（仅本聊天） <select name="current-chapter"><option value="" disabled>请选择当前章节…</option></select></label>
    </div>
    <fieldset class="journal-module-switches">
      <legend>本次允许模型更改的模块</legend>
      <div data-module-switches></div>
    </fieldset>
    <fieldset>
      <legend>旅行与探索：发送哪些地区</legend>
      <div data-group-switches></div>
      <p class="journal-form-note">剧情发送当前大阶段整树；人物与羁绊、战斗成就继续按所选用户输入和清洗正文匹配关键词；职业、技能、知识只发送玩家已接取的任务。旅行保留地区选择，日记无需选树。所有内容仍受模块开关、数据准入、正文正则和世界书装配约束。</p>
    </fieldset>
    <p class="journal-form-note">每次请求中，每个勾选模块最多接受一条更新；批量正文不增加名额。</p>
  </details>
  <details open><summary>选择要编辑的提示词</summary>
    <label>提示词块
      <select name="prompt-slot"></select>
    </label>
    <label><span data-prompt-label>总任务提示词</span>
      <textarea name="prompt-editor" rows="12" placeholder="等待玩家填写…"></textarea>
    </label>
    <p class="journal-form-note">后端负责固定的段落顺序、请求身份、模块权限与 JSON 外层协议；此处只编辑内容提示词。</p>
  </details>
  <details><summary>正文清洗正则</summary>
    <label>正文提取正则
      <textarea name="extract-pattern" rows="4" placeholder="第一个捕获组作为正文；可匹配多段"></textarea>
    </label>
    <label>排除正则（每行一条）
      <textarea name="remove-patterns" rows="5" placeholder="用于删除思维链、小剧场和自检块"></textarea>
    </label>
    <p class="journal-form-note">正则直接作为 JavaScript 正则源，程序统一使用 g/i/s。提取规则留空或某楼无匹配时会停止，不会回退发送未清洗全文。</p>
  </details>
  <div class="journal-form-actions">
    <button type="submit">保存配置</button>
    <button type="button" data-action="preview">生成完整预览</button>
  </div>
  <p data-status role="status" aria-live="polite"></p>
  <section data-preview hidden class="journal-prompt-preview">
    <h2>本次实际发送内容</h2>
    <p data-preview-meta class="journal-form-note"></p>
    <textarea data-preview-content readonly rows="24" aria-label="本次实际发送内容"></textarea>
    <div class="journal-form-actions">
      <button type="button" data-action="send-preview">确认发送这份预览</button>
    </div>
  </section>
</form>`;

function input(root: ParentNode, name: string): HTMLInputElement {
  return requiredElement(root, `[name="${name}"]`);
}

function textArea(root: ParentNode, name: string): HTMLTextAreaElement {
  return requiredElement(root, `[name="${name}"]`);
}

function promptLabel(slot: PromptSlot): string {
  if (slot === 'task') return '总任务提示词';
  if (slot === 'reasoning') return '判定思维链提示词';
  return `${MODULE_LABELS[slot]}模块提示词`;
}

function promptDrafts(settings: RuntimeSettings): Record<PromptSlot, string> {
  return Object.fromEntries([
    ['task', settings.prompts.taskPrompt],
    ['reasoning', settings.prompts.reasoningPrompt],
    ...CONTENT_MODULES.map(module => [module, settings.prompts.modulePrompts[module] ?? '']),
  ]) as Record<PromptSlot, string>;
}

function renderPromptOptions(root: HTMLElement): void {
  const selector = requiredElement<HTMLSelectElement>(root, '[name="prompt-slot"]');
  for (const slot of ['task', 'reasoning', ...CONTENT_MODULES] as PromptSlot[]) {
    const option = root.ownerDocument.createElement('option');
    option.value = slot;
    option.textContent = promptLabel(slot);
    selector.append(option);
  }
}

function renderModuleSwitches(root: HTMLElement, settings: RuntimeSettings): void {
  const container = requiredElement<HTMLElement>(root, '[data-module-switches]');
  for (const module of CONTENT_MODULES) {
    const label = root.ownerDocument.createElement('label');
    label.className = 'journal-checkbox';
    label.dataset.moduleId = module;
    const checkbox = root.ownerDocument.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.enabled = '';
    checkbox.checked = settings.sending.enabledModuleIds.includes(module);
    label.append(checkbox, ` ${MODULE_LABELS[module]}`);
    container.append(label);
  }
}

function renderGroupSwitches(root: HTMLElement, settings: RuntimeSettings, groups: ModelGroupOption[]): void {
  const container = requiredElement<HTMLElement>(root, '[data-group-switches]');
  container.replaceChildren();
  const regions = groups.filter(group => group.module === 'travel');
  for (const group of regions) {
    const label = root.ownerDocument.createElement('label');
    label.className = 'journal-checkbox';
    const checkbox = root.ownerDocument.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.groupId = group.id;
    checkbox.dataset.groupModule = group.module;
    checkbox.checked = settings.sending.selectedGroupIds.includes(group.id);
    label.append(checkbox, ` ${MODULE_LABELS[group.module]} · ${group.label}`);
    container.append(label);
  }
  if (!regions.length) container.textContent = '当前数据侧未提供可发送地区。';
  syncGroupSwitches(root);
}

function syncGroupSwitches(root: HTMLElement): void {
  const modules = enabledModules(root);
  for (const checkbox of root.querySelectorAll<HTMLInputElement>('[data-group-id]')) {
    checkbox.disabled = !modules.includes(checkbox.dataset.groupModule as ContentModule);
    if (checkbox.disabled) checkbox.checked = false;
  }
}

function populate(root: HTMLElement, settings: RuntimeSettings, latestFloor: number): Record<PromptSlot, string> {
  textArea(root, 'extract-pattern').value = settings.sending.tagFilter.extractPattern;
  textArea(root, 'remove-patterns').value = settings.sending.tagFilter.removePatterns.join('\n');
  input(root, 'body-rounds').value = String(settings.sending.bodyRounds);
  requiredElement<HTMLSelectElement>(root, '[name="send-mode"]').value = settings.sending.mode;
  input(root, 'auto-every').value = String(settings.sending.autoEveryRounds);
  input(root, 'end-floor').value = String(latestFloor);
  input(root, 'start-floor').value = String(Math.max(0, latestFloor - settings.sending.bodyRounds * 2 + 1));
  renderModuleSwitches(root, settings);
  renderPromptOptions(root);
  const drafts = promptDrafts(settings);
  textArea(root, 'prompt-editor').value = drafts.task;
  return drafts;
}

function lineList(source: string): string[] {
  return source.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean);
}

function enabledModules(root: HTMLElement): ContentModule[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-module-id]')).flatMap(label => (
    requiredElement<HTMLInputElement>(label, '[data-enabled]').checked ? [label.dataset.moduleId as ContentModule] : []
  ));
}

function readSettings(root: HTMLElement, current: RuntimeSettings, drafts: Record<PromptSlot, string>, activeSlot: PromptSlot): RuntimeSettings {
  drafts[activeSlot] = textArea(root, 'prompt-editor').value;
  const settings = structuredClone(current);
  settings.prompts = {
    taskPrompt: drafts.task,
    reasoningPrompt: drafts.reasoning,
    modulePrompts: Object.fromEntries(CONTENT_MODULES.flatMap(module => (
      drafts[module].trim() ? [[module, drafts[module]]] : []
    ))),
  };
  settings.sending = {
    mode: requiredElement<HTMLSelectElement>(root, '[name="send-mode"]').value as RuntimeSettings['sending']['mode'],
    autoEveryRounds: Number(input(root, 'auto-every').value),
    bodyRounds: Number(input(root, 'body-rounds').value),
    enabledModuleIds: enabledModules(root),
    selectedGroupIds: [...root.querySelectorAll<HTMLInputElement>('[data-group-id]:checked:not(:disabled)')].map(input => input.dataset.groupId!),
    tagFilter: {
      extractPattern: textArea(root, 'extract-pattern').value.trim(),
      removePatterns: lineList(textArea(root, 'remove-patterns').value),
    },
  };
  return settings;
}

function previewText(preview: RuntimePreview): string {
  return preview.prompts.map((prompt, index) => [
    `===== ${String(index + 1).padStart(2, '0')} · ${prompt.role.toUpperCase()} · ${prompt.name} =====`,
    prompt.content,
  ].join('\n')).join('\n\n');
}

export function mountPromptingPage(container: HTMLElement, controller: PromptingController): () => void {
  container.innerHTML = PROMPTING_TEMPLATE;
  const root = requiredElement<HTMLElement>(container, '[data-prompting-form]');
  let settings = controller.load();
  let dirty = false;
  let activeSlot: PromptSlot = 'task';
  let pendingPreviewId: string | undefined;
  let previewRevision = 0;
  const drafts = populate(root, settings, controller.latestMessageId());
  renderGroupSwitches(root, settings, controller.modelGroups());
  const chapterSelector = requiredElement<HTMLSelectElement>(root, '[name="current-chapter"]');
  for (const chapter of controller.chapters()) {
    const option = root.ownerDocument.createElement('option');
    option.value = chapter.chapterId;
    option.textContent = `${chapter.chapterNumber} · ${chapter.chapterName}`;
    chapterSelector.append(option);
  }
  chapterSelector.value = controller.currentChapterId() ?? '';
  const preview = requiredElement<HTMLElement>(root, '[data-preview]');
  const promptSelector = requiredElement<HTMLSelectElement>(root, '[name="prompt-slot"]');

  function invalidatePreview(message?: string): void {
    previewRevision++;
    pendingPreviewId = undefined;
    preview.hidden = true;
    if (message) setStatus(root, message);
  }

  promptSelector.addEventListener('change', () => {
    drafts[activeSlot] = textArea(root, 'prompt-editor').value;
    activeSlot = promptSelector.value as PromptSlot;
    textArea(root, 'prompt-editor').value = drafts[activeSlot];
    requiredElement<HTMLElement>(root, '[data-prompt-label]').textContent = promptLabel(activeSlot);
  });

  const markDirty = (event: Event) => {
    const target = event.target;
    if (target === promptSelector) return;
    syncGroupSwitches(root);
    const Input = root.ownerDocument.defaultView?.HTMLInputElement;
    if (Input && target instanceof Input && (target.name === 'start-floor' || target.name === 'end-floor')) {
      invalidatePreview('楼层范围已变化，请重新生成预览。');
      return;
    }
    dirty = true;
    invalidatePreview('配置有未保存修改；保存后才能生成预览。');
  };
  root.addEventListener('input', markDirty);
  root.addEventListener('change', markDirty);

  root.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      settings = readSettings(root, settings, drafts, activeSlot);
      const savedRevision = previewRevision;
      await controller.save(settings, chapterSelector.value || undefined);
      dirty = savedRevision !== previewRevision;
      invalidatePreview();
      setStatus(root, dirty ? '配置已保存；保存期间的新改动仍需再保存。' : '提示词与发送配置已保存。', 'success');
    } catch (error) {
      setStatus(root, errorMessage(error), 'error');
    }
  });

  requiredElement<HTMLButtonElement>(root, '[data-action="preview"]').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    const revision = previewRevision;
    try {
      if (dirty) throw new Error('请先保存提示词与发送配置。');
      button.disabled = true;
      setStatus(root, '正在整理正文与最终提示词…', 'info');
      const result = await controller.previewManual(Number(input(root, 'start-floor').value), Number(input(root, 'end-floor').value));
      if (revision !== previewRevision) throw new Error('生成期间楼层或配置已变化，请重新预览。');
      pendingPreviewId = result.previewId;
      requiredElement<HTMLElement>(preview, '[data-preview-meta]').textContent = `正文楼层：${result.selectedFloors.join('、')}；关键词扫描的用户楼层：${result.userInputFloors.join('、') || '无'}；发送的树／地区：${result.request.moduleContext.map(group => group.label).join('、') || '无'}；人设／背景条目：${result.request.worldContext.length}；提示词消息：${result.prompts.length} 条。`;
      requiredElement<HTMLTextAreaElement>(preview, '[data-preview-content]').value = previewText(result);
      preview.hidden = false;
      requiredElement<HTMLButtonElement>(preview, '[data-action="send-preview"]').disabled = result.request.allowedModules.length === 0;
      setStatus(root, result.request.allowedModules.length ? '完整提示词预览已生成，尚未发送。' : '本次没有命中的可发送材料，不会请求模型。', result.request.allowedModules.length ? 'success' : 'info');
    } catch (error) {
      invalidatePreview();
      setStatus(root, errorMessage(error), 'error');
    } finally { button.disabled = false; }
  });

  requiredElement<HTMLButtonElement>(root, '[data-action="send-preview"]').addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      if (dirty) throw new Error('请先保存配置并重新预览。');
      if (!pendingPreviewId) throw new Error('请先生成本次完整预览。');
      button.disabled = true;
      setStatus(root, '正在发送已预览的请求…', 'info');
      const completed = await controller.sendPreview(pendingPreviewId);
      pendingPreviewId = undefined;
      preview.hidden = true;
      setStatus(root, completed.skipped ? completed.response.judgementSummary : `判定已完成，接收 ${completed.response.updates.length} 条更新。`, completed.skipped ? 'info' : 'success');
    } catch (error) {
      pendingPreviewId = undefined;
      preview.hidden = true;
      setStatus(root, errorMessage(error), 'error');
    } finally {
      button.disabled = false;
    }
  });
  return () => container.replaceChildren();
}
