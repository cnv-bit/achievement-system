import assert from 'node:assert/strict';
import test from 'node:test';
import { AchievementNotifications, type NotificationLevel, type TavernToastr } from '../src/notifications.ts';
import { setStatus } from '../src/settings/dom.ts';

test('notifications route all three levels to host toastr with escaped text and no global option changes', () => {
  const calls: unknown[][] = [];
  const host = { options: { positionClass: 'toast-top-center' } } as TavernToastr & { options: object };
  for (const level of ['success', 'error', 'info'] as const) {
    host[level] = function (...args) {
      assert.equal(this, host);
      calls.push([level, ...args]);
    };
  }
  const messages = new AchievementNotifications(() => host);
  for (const level of ['success', 'error', 'info'] as const) messages[level]('<b>反馈</b>');
  assert.deepEqual(calls, ['success', 'error', 'info'].map(level => [
    level, '<b>反馈</b>', '成就系统', { escapeHtml: true },
  ]));
  assert.deepEqual(host.options, { positionClass: 'toast-top-center' });
});

test('settings feedback reaches parent toastr once; progress remains inline', () => {
  const levels: NotificationLevel[] = [];
  const toastr: TavernToastr = {
    success: () => levels.push('success'),
    error: () => levels.push('error'),
    info: () => levels.push('info'),
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { parent: { toastr } } });
  const status = { textContent: '', dataset: { state: '' } };
  const root = { querySelector: () => status } as unknown as ParentNode;
  try {
    setStatus(root, '处理中…');
    assert.deepEqual(levels, []);
    setStatus(root, '文本 API 连接正常。', 'success');
    setStatus(root, '连接失败', 'error');
    assert.equal(status.textContent, '连接失败');
    assert.equal(status.dataset.state, 'error');
    assert.deepEqual(levels, ['success', 'error']);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
