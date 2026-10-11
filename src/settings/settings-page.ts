import type { RuntimeSettings } from './model.ts';
import type { ApiSettingsPort, SettingsSnapshot } from './ports.ts';
import { errorMessage, option, requiredElement, setStatus } from './dom.ts';
import { mountWorldbookPage } from './worldbook-page.ts';

const SETTINGS_TEMPLATE = `
<form data-settings-form class="journal-admin-form">
  <h2>文本子 API</h2>
  <p class="journal-form-note">独立用于成就判定，不修改酒馆正文 API。密钥保存在当前酒馆账号的后端密钥库，已保存密钥不回传浏览器。更换 API 地址须重新填写密钥。</p>

  <label for="goblin-text-source">来源</label>
  <select id="goblin-text-source" name="text-source">
    <option value="openai">OpenAI</option>
    <option value="custom">OpenAI 兼容</option>
  </select>

  <label for="goblin-text-url">API 地址</label>
  <input id="goblin-text-url" name="text-url" type="url" autocomplete="url" placeholder="https://api.example.com/v1" required>

  <label for="goblin-text-key">API Key</label>
  <input id="goblin-text-key" name="text-key" type="password" autocomplete="new-password" spellcheck="false" aria-describedby="goblin-key-state" placeholder="留空则保留已保存密钥">
  <small id="goblin-key-state" class="journal-form-note" data-key-state></small>

  <label for="goblin-text-model">模型</label>
  <div class="journal-model-row">
    <input id="goblin-text-model" name="text-model" list="goblin-text-models" placeholder="可手动输入模型 ID" required>
    <datalist id="goblin-text-models"></datalist>
    <button type="button" data-action="load-models">拉取模型</button>
  </div>

  <details>
    <summary>生成参数</summary>
    <label for="goblin-text-max-tokens">最大输出</label>
    <input id="goblin-text-max-tokens" name="text-max-tokens" type="number" min="1" step="1" required>
    <label for="goblin-text-temperature">温度</label>
    <input id="goblin-text-temperature" name="text-temperature" type="number" min="0" max="2" step="0.1" required>
  </details>

  <div class="journal-form-actions">
    <button type="button" data-action="test-text">测试连接</button>
    <button type="submit">保存设置</button>
  </div>
  <p data-status role="status" aria-live="polite"></p>
</form>`;

function input(root: ParentNode, name: string): HTMLInputElement {
  return requiredElement(root, `[name="${name}"]`);
}

function select(root: ParentNode, name: string): HTMLSelectElement {
  return requiredElement(root, `[name="${name}"]`);
}

function populateForm(root: HTMLElement, snapshot: SettingsSnapshot): void {
  const config = snapshot.settings.textApi;
  select(root, 'text-source').value = config.source;
  input(root, 'text-url').value = config.apiUrl;
  input(root, 'text-model').value = config.model;
  input(root, 'text-max-tokens').value = String(config.maxTokens);
  input(root, 'text-temperature').value = String(config.temperature);
  setKeyState(root, snapshot.hasTextApiKey);
}

function setKeyState(root: HTMLElement, hasSavedKey: boolean): void {
  requiredElement<HTMLElement>(root, '[data-key-state]').textContent = hasSavedKey
    ? '后端已保存密钥；留空不会覆盖。'
    : '尚未保存密钥；无鉴权接口可留空。';
}

function readForm(root: HTMLElement, snapshot: SettingsSnapshot): SettingsSnapshot {
  const settings = structuredClone(snapshot.settings);
  settings.textApi = {
    source: select(root, 'text-source').value as RuntimeSettings['textApi']['source'],
    apiUrl: input(root, 'text-url').value.trim(),
    model: input(root, 'text-model').value.trim(),
    maxTokens: Number(input(root, 'text-max-tokens').value),
    temperature: Number(input(root, 'text-temperature').value),
  };
  return {
    settings,
    hasTextApiKey: snapshot.hasTextApiKey,
  };
}

async function reportAction(
  root: HTMLElement,
  button: HTMLButtonElement,
  action: () => Promise<string>,
): Promise<void> {
  button.disabled = true;
  root.setAttribute('aria-busy', 'true');
  setStatus(root, '处理中…');
  try {
    setStatus(root, await action(), 'success');
  } catch (error) {
    setStatus(root, errorMessage(error), 'error');
  } finally {
    button.disabled = false;
    root.removeAttribute('aria-busy');
  }
}

export function mountSettingsPage(container: HTMLElement, controller: ApiSettingsPort): () => void {
  container.innerHTML = SETTINGS_TEMPLATE;
  const worldbookContainer = container.ownerDocument.createElement('section');
  container.append(worldbookContainer);
  const unmountWorldbooks = mountWorldbookPage(worldbookContainer, controller);
  const root = requiredElement<HTMLElement>(container, '[data-settings-form]');
  let snapshot = controller.load();
  populateForm(root, snapshot);
  const controls = [...root.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')];
  controls.forEach(control => { control.disabled = true; });
  setStatus(root, '正在确认后端密钥状态并迁移旧记录…');
  let disposed = false;
  void controller.initialize().then(() => {
    if (disposed) return;
    snapshot = controller.load();
    setKeyState(root, snapshot.hasTextApiKey);
    controls.forEach(control => { control.disabled = false; });
    setStatus(root, '后端密钥存储已就绪。');
  }).catch(error => {
    if (!disposed) setStatus(root, errorMessage(error), 'error');
  });

  const loadModelsButton = requiredElement<HTMLButtonElement>(root, '[data-action="load-models"]');
  const testTextButton = requiredElement<HTMLButtonElement>(root, '[data-action="test-text"]');

  const loadModels = () => reportAction(root, loadModelsButton, async () => {
    const form = readForm(root, snapshot);
    const models = await controller.listTextModels(form.settings.textApi, input(root, 'text-key').value.trim());
    const list = requiredElement<HTMLDataListElement>(root, '#goblin-text-models');
    list.replaceChildren(...models.map(model => option(model)));
    return models.length > 0
      ? `已获取 ${models.length} 个模型，可从模型输入框选择。`
      : '接口未返回模型列表，请手动填写模型 ID。';
  });

  const testText = () => reportAction(root, testTextButton, async () => {
    const form = readForm(root, snapshot);
    await controller.testTextConnection(form.settings.textApi, input(root, 'text-key').value.trim());
    return '文本 API 连接正常。';
  });

  loadModelsButton.addEventListener('click', loadModels);
  testTextButton.addEventListener('click', testText);
  root.addEventListener('submit', event => {
    event.preventDefault();
    const button = requiredElement<HTMLButtonElement>(root, '[type="submit"]');
    if (button.disabled) return;
    void reportAction(root, button, async () => {
      const form = readForm(root, snapshot);
      const key = input(root, 'text-key').value.trim();
      await controller.save(form.settings, key);
      snapshot = controller.load();
      if (input(root, 'text-key').value.trim() === key) input(root, 'text-key').value = '';
      setKeyState(root, snapshot.hasTextApiKey);
      return '文本 API 设置与后端密钥已保存。';
    });
  });

  return () => { disposed = true; unmountWorldbooks(); container.replaceChildren(); };
}
