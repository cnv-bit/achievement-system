import type { PackChangePreview, PackVersionsPort, PackVersionState } from '../runtime/pack-versions.ts';
import { notifications } from '../notifications.ts';
import { button, element } from './journal-port.ts';

function renderArchives(host: HTMLElement, state: PackVersionState): void {
  const doc = host.ownerDocument;
  host.append(element(doc, 'h2', '', '遗留记录（只读，不参与当前解锁）'));
  if (!state.orphanedProgress.length && !state.orphanedChapters.length) host.append(element(doc, 'p', '', '没有遗留记录。'));
  for (const entry of [...state.orphanedProgress, ...state.orphanedChapters]) {
    const leaf = element(doc, 'details');
    const name = 'nodeName' in entry ? entry.nodeName : entry.chapterName;
    leaf.append(element(doc, 'summary', '', `${name} · 来源 ${entry.source.packVersion}`));
    const record = element(doc, 'textarea');
    record.readOnly = true; record.rows = 10; record.value = JSON.stringify(entry, null, 2);
    record.setAttribute('aria-label', `${name}的原始记录、文案和玩家修改`);
    leaf.append(record);
    host.append(leaf);
  }
}

/** Reuses the existing admin form and paper styles; no new asset editor or CSS. */
export function mountPackVersionsPage(host: HTMLElement, port: PackVersionsPort): () => void {
  const doc = host.ownerDocument;
  const root = element(doc, 'div', 'journal-admin-form');
  host.append(root);
  let state: PackVersionState;
  try { state = port.getVersionState(); }
  catch (error) {
    root.append(element(doc, 'p', 'journal-error', error instanceof Error ? error.message : '当前没有已绑定内容包。'));
    return () => root.remove();
  }
  root.append(element(doc, 'p', '', `${state.packName} · ${state.packId} / ${state.packVersion}`),
    element(doc, 'p', '', '旧聊天不会自动升级。请先复制聊天，在副本中预览并确认。原版本必须保留；恢复会切回快照，同时备份当前版本的进度。'));
  const label = element(doc, 'label', '', '已发布的目标版本');
  const version = element(doc, 'input');
  version.placeholder = '例如 0002'; version.maxLength = 80;
  label.append(version);
  const status = element(doc, 'p');
  status.setAttribute('role', 'status');
  const previewHost = element(doc, 'div');
  let preview: PackChangePreview | undefined, pending = false, disposed = false;
  function busy(running: boolean): void {
    pending = running;
    root.setAttribute('aria-busy', String(running));
    root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(control => { control.disabled = running; });
    apply.disabled = running || !preview;
  }
  async function run(action: () => Promise<void>): Promise<void> {
    if (pending || disposed) return;
    busy(true); status.textContent = '校验与处理中…';
    try { await action(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '版本操作失败，未切换内容。';
      if (!disposed) status.textContent = message;
      notifications.error(message);
    } finally { if (!disposed) busy(false); }
  }
  function showPreview(next: PackChangePreview): void {
    if (disposed) return;
    preview = next; previewHost.replaceChildren();
    previewHost.append(element(doc, 'h2', '', `${next.mode === 'restore' ? '恢复' : '升级'}：${next.fromVersion} → ${next.toVersion}`),
      element(doc, 'p', '', `改名 ${next.renamed.length} 项，遗留节点／图片 ${next.archived.length} 项，遗留章节 ${next.archivedChapters.length} 项。完成记录 ${next.completedCount} 项，任务记录 ${next.taskCount} 项。`));
    const changes = element(doc, 'ul');
    for (const row of next.renamed) changes.append(element(doc, 'li', '', `${row.from} → ${row.to}`));
    for (const row of next.archived) changes.append(element(doc, 'li', '', `${row.nodeName} (${row.nodeId})：${row.reason}`));
    for (const id of next.archivedChapters) changes.append(element(doc, 'li', '', `章节退出当前版本：${id}`));
    for (const id of next.resetChapterIds) changes.append(element(doc, 'li', '', `本章剧情条件未全部完成，撤回完成标记（不新增或关闭章节）：${id}`));
    previewHost.append(changes); status.textContent = '仅预览，尚未保存；确认后一次性提交。';
  }
  const upgrade = button(doc, '预览升级', () => { void run(async () => showPreview(await port.previewUpgrade(version.value.trim()))); });
  const restore = button(doc, `预览恢复${state.rollbackVersion ? ` ${state.rollbackVersion}` : ''}`, () => { void run(async () => showPreview(await port.previewRestore())); });
  restore.hidden = !state.rollbackVersion;
  const apply = button(doc, '确认并保存版本变更', () => {
    if (!preview || !(doc.defaultView?.confirm(`确认${preview.mode === 'restore' ? '恢复' : '升级'}到 ${preview.toVersion}？请确认正在工作副本中操作。`) ?? false)) return;
    const token = preview.token;
    void run(async () => { await port.applyPreview(token); notifications.success('内容版本变更已保存，请重新打开手账。'); });
  });
  apply.disabled = true;
  version.addEventListener('input', () => { preview = undefined; apply.disabled = true; previewHost.replaceChildren(); });
  root.append(label, upgrade, restore, previewHost, apply, status);
  renderArchives(root, state);
  return () => { disposed = true; root.remove(); };
}
