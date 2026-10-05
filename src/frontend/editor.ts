import { button, element } from './journal-port.ts';
import { notifications } from '../notifications.ts';

export function openEditor(
  host: HTMLElement,
  initial: { nodeName?: string; text: string },
  save: (value: { nodeName: string; text: string }) => Promise<void>,
) {
  const doc = host.ownerDocument;
  const previousFocus = doc.activeElement as HTMLElement | null;
  const dialog = element(doc, 'dialog', 'journal-editor');
  dialog.setAttribute('aria-label', '编辑手账');
  const form = element(doc, 'form');
  const titleLabel = element(doc, 'label', '', '名字');
  const title = element(doc, 'input');
  title.value = initial.nodeName ?? '';
  title.maxLength = 200;
  title.required = initial.nodeName !== undefined;
  titleLabel.append(title);
  const textLabel = element(doc, 'label', '', '附文');
  const text = element(doc, 'textarea');
  text.value = initial.text;
  text.required = true;
  text.rows = 7;
  textLabel.append(text);
  const error = element(doc, 'p', 'journal-error');
  error.setAttribute('role', 'alert');
  const cancel = button(doc, '取消', () => dialog.close());
  const submit = element(doc, 'button', '', '保存');
  submit.type = 'submit';
  let pending = false;
  const actions = element(doc, 'div', 'journal-editor-actions');
  actions.append(cancel, submit);
  form.append(element(doc, 'h2', '', '在这一页，留下你的文字'));
  if (initial.nodeName !== undefined) form.append(titleLabel);
  form.append(textLabel, error, actions);
  dialog.append(form);
  host.append(dialog);
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    submit.disabled = cancel.disabled = true;
    submit.textContent = '保存中…';
    try {
      await save({ nodeName: title.value, text: text.value });
      dialog.close();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : '保存失败，请重试。';
      notifications.error('保存失败，请检查填写内容。');
    } finally {
      pending = false;
      submit.disabled = cancel.disabled = false;
      submit.textContent = '保存';
    }
  });
  dialog.showModal();
}
