export const SETTINGS_BUTTON_NAME = '成就系统设置';
export const SETTINGS_DRAWER_TEMPLATE = `
  <div class="inline-drawer-toggle inline-drawer-header">
    <b>成就系统｜文本 API</b>
    <div class="fa-solid fa-circle-chevron-down inline-drawer-icon down"></div>
  </div>
  <div class="inline-drawer-content" data-settings-host></div>`;

interface SettingsButtonHost {
  replaceButtons(buttons: Array<{ name: string; visible: boolean }>): void;
  buttonEvent(name: string): string;
  subscribe(event: string, listener: () => void): { stop(): void };
}

export function installSettingsButton(host: SettingsButtonHost, openSettings: () => void): () => void {
  host.replaceButtons([{ name: SETTINGS_BUTTON_NAME, visible: true }]);
  const subscription = host.subscribe(host.buttonEvent(SETTINGS_BUTTON_NAME), openSettings);
  return () => subscription.stop();
}
