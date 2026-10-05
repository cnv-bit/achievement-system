import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installSettingsButton,
  SETTINGS_BUTTON_NAME,
  SETTINGS_DRAWER_TEMPLATE,
} from '../src/tavern-helper/settings-entry.ts';

test('settings entry installs a visible script button that opens the settings panel', () => {
  let installedButtons: Array<{ name: string; visible: boolean }> = [];
  let subscribedEvent = '';
  let listener: (() => void) | undefined;
  let stopped = false;
  let opened = false;

  const uninstall = installSettingsButton({
    replaceButtons: buttons => { installedButtons = [...buttons]; },
    buttonEvent: name => `button:${name}`,
    subscribe: (event, nextListener) => {
      subscribedEvent = event;
      listener = nextListener;
      return { stop: () => { stopped = true; } };
    },
  }, () => { opened = true; });

  assert.deepEqual(installedButtons, [{ name: SETTINGS_BUTTON_NAME, visible: true }]);
  assert.equal(subscribedEvent, `button:${SETTINGS_BUTTON_NAME}`);
  listener?.();
  assert.equal(opened, true);
  uninstall();
  assert.equal(stopped, true);
});

test('settings drawer uses the SillyTavern inline drawer toggle structure', () => {
  assert.match(SETTINGS_DRAWER_TEMPLATE, /inline-drawer-toggle inline-drawer-header/);
  assert.match(SETTINGS_DRAWER_TEMPLATE, /inline-drawer-icon down/);
  assert.match(SETTINGS_DRAWER_TEMPLATE, /inline-drawer-content/);
  assert.doesNotMatch(SETTINGS_DRAWER_TEMPLATE, /<summary/);
});
