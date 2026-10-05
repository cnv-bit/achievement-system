import { notifications, type NotificationLevel } from '../notifications.ts';

export function requiredElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`设置页缺少元素：${selector}`);
  return element;
}

export function setStatus(root: ParentNode, message: string, notification?: NotificationLevel): void {
  const status = requiredElement<HTMLElement>(root, '[data-status]');
  status.textContent = message;
  status.dataset.state = notification === 'error' ? 'error' : 'ready';
  if (notification) notifications.show(notification, message);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function option(value: string, label = value): HTMLOptionElement {
  const element = document.createElement('option');
  element.value = value;
  element.textContent = label;
  return element;
}
