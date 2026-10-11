import type { ApiSettingsPort } from './ports.ts';
import { errorMessage, requiredElement, setStatus } from './dom.ts';
import type { WorldbookEntry } from '../runtime/ports.ts';

const TEMPLATE = `<form data-worldbooks-form class="journal-admin-form">
  <h2>世界书与人设</h2>
  <p class="journal-form-note">仅扫描本次所选楼层内的全部用户消息。助手正文不触发人设；没有用户消息就静默略过。公共背景按勾选加载，与关键词无关。</p>
  <label>世界书 <select name="worldbook"></select></label>
  <label class="journal-checkbox"><input name="bind-book" type="checkbox"> 绑定此世界书，用用户输入匹配绿灯关键词</label>
  <label class="journal-checkbox"><input name="all-entries" type="checkbox"> 扫描全部已启用绿灯条目（含今后新增条目）</label>
  <div data-entries class="journal-worldbook-entries"></div>
  <div class="journal-form-actions">
    <button type="submit">保存世界书选择</button>
    <button type="button" data-reload>重新读取世界书</button>
    <button type="button" data-unbind>取消此书全部绑定</button>
  </div>
  <p data-status role="status" aria-live="polite"></p>
</form>`;

export function mountWorldbookPage(container: HTMLElement, controller: ApiSettingsPort): () => void {
  container.innerHTML = TEMPLATE;
  const root = requiredElement<HTMLElement>(container, '[data-worldbooks-form]');
  const selector = requiredElement<HTMLSelectElement>(root, '[name="worldbook"]');
  const bind = requiredElement<HTMLInputElement>(root, '[name="bind-book"]');
  const all = requiredElement<HTMLInputElement>(root, '[name="all-entries"]');
  const rows = requiredElement<HTMLElement>(root, '[data-entries]');
  let draft = structuredClone(controller.load().settings.worldbooks);
  let currentBook = '';
  let entries: WorldbookEntry[] = [];
  let readId = 0;
  let disposed = false;
  let reading = false;

  function remember(): void {
    if (!currentBook) return;
    draft.keywordBooks = draft.keywordBooks.filter(book => book.worldbookName !== currentBook);
    if (bind.checked) draft.keywordBooks.push({
      worldbookName: currentBook,
      entryUids: all.checked ? null : [...rows.querySelectorAll<HTMLInputElement>('[data-keyword]:checked')].map(input => Number(input.dataset.uid)),
    });
    // Preserve missing entry references until the player explicitly unchecks them.
    draft.sharedEntries = draft.sharedEntries.filter(entry => entry.worldbookName !== currentBook);
    draft.sharedEntries.push(...[...rows.querySelectorAll<HTMLInputElement>('[data-shared]:checked')].map(input => ({ worldbookName: currentBook, entryUid: Number(input.dataset.uid) })));
  }

  function render(): void {
    const binding = draft.keywordBooks.find(book => book.worldbookName === currentBook);
    bind.checked = Boolean(binding);
    all.checked = binding?.entryUids === null || !binding;
    rows.replaceChildren();
    const missingUids = new Set([
      ...(binding?.entryUids ?? []),
      ...draft.sharedEntries.filter(entry => entry.worldbookName === currentBook).map(entry => entry.entryUid),
    ]);
    for (const entry of entries) missingUids.delete(entry.uid);
    for (const entry of [...entries, ...[...missingUids].map<WorldbookEntry>(uid => ({ uid, name: `条目 #${uid} 已不存在（取消勾选可移除绑定）`, content: '' }))]) {
      const row = root.ownerDocument.createElement('fieldset');
      const legend = root.ownerDocument.createElement('legend');
      legend.textContent = `${entry.name} · #${entry.uid}${entry.enabled === false ? '（已停用）' : ''}`;
      row.append(legend);
      for (const [kind, labelText] of [['keyword', '关键词匹配'], ['shared', '公共背景（直接发送）']] as const) {
        const label = root.ownerDocument.createElement('label');
        label.className = 'journal-checkbox';
        const checkbox = root.ownerDocument.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset[kind] = '';
        checkbox.dataset.uid = String(entry.uid);
        checkbox.checked = kind === 'shared'
          ? draft.sharedEntries.some(binding => binding.worldbookName === currentBook && binding.entryUid === entry.uid)
          : binding?.entryUids === null || (binding?.entryUids.includes(entry.uid) ?? false);
        label.append(checkbox, ` ${labelText}`);
        row.append(label);
      }
      const keys = root.ownerDocument.createElement('small');
      keys.className = 'journal-form-note';
      keys.textContent = `主关键词：${entry.keys?.join('、') || '无'}；${entry.strategy ?? '未知策略'}`;
      row.append(keys);
      rows.append(row);
    }
    updateDisabled();
  }

  function updateDisabled(): void {
    all.disabled = !bind.checked;
    rows.querySelectorAll<HTMLInputElement>('[data-keyword]').forEach(input => { input.disabled = !bind.checked || all.checked; });
  }

  async function read(): Promise<void> {
    const id = ++readId;
    reading = true;
    rows.replaceChildren();
    entries = [];
    currentBook = '';
    bind.disabled = true;
    all.disabled = true;
    setStatus(root, '正在读取世界书…');
    try {
      const name = selector.value;
      const loaded = name ? await controller.worldbookEntries(name) : [];
      if (disposed || id !== readId) return;
      currentBook = name;
      reading = false;
      entries = loaded;
      bind.disabled = !name;
      render();
      setStatus(root, name ? `已读取 ${loaded.length} 个条目；选择后请保存。` : '当前没有可用世界书。');
    } catch (error) {
      if (!disposed && id === readId) {
        reading = false;
        setStatus(root, errorMessage(error), 'error');
      }
    }
  }

  function refreshNames(): void {
    const selected = selector.value;
    const names = new Set([...controller.worldbookNames(), ...draft.keywordBooks.map(book => book.worldbookName), ...draft.sharedEntries.map(entry => entry.worldbookName)]);
    selector.replaceChildren(...[...names].map(name => {
      const option = root.ownerDocument.createElement('option');
      option.value = name;
      option.textContent = name;
      return option;
    }));
    if (names.has(selected)) selector.value = selected;
  }

  bind.addEventListener('change', updateDisabled);
  all.addEventListener('change', updateDisabled);
  selector.addEventListener('change', () => { remember(); void read(); });
  requiredElement(root, '[data-reload]').addEventListener('click', () => {
    remember();
    refreshNames();
    void read();
  });
  requiredElement(root, '[data-unbind]').addEventListener('click', () => {
    const name = selector.value;
    draft.keywordBooks = draft.keywordBooks.filter(book => book.worldbookName !== name);
    draft.sharedEntries = draft.sharedEntries.filter(entry => entry.worldbookName !== name);
    if (currentBook === name) render();
    setStatus(root, '已取消此书的草稿绑定，请点击保存。');
  });
  root.addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (reading) throw new Error('请等待世界书读取完成后再保存。');
      remember();
      await controller.saveWorldbooks(draft);
      setStatus(root, '世界书选择已保存；下一次预览会重新读取条目。', 'success');
    } catch (error) { setStatus(root, errorMessage(error), 'error'); }
  });
  refreshNames();
  void read();
  return () => { disposed = true; container.replaceChildren(); };
}
