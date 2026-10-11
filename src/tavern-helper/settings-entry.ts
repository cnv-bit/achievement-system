export const SETTINGS_BUTTON_NAME = '成就系统设置';
export const AUTHOR_BUTTON_NAME = '成就卡带编辑器';
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

export function installSettingsButton(host: SettingsButtonHost, openSettings: () => void, openAuthor?: () => void): () => void {
  host.replaceButtons([{ name: SETTINGS_BUTTON_NAME, visible: true }, ...(openAuthor ? [{ name: AUTHOR_BUTTON_NAME, visible: true }] : [])]);
  const subscription = host.subscribe(host.buttonEvent(SETTINGS_BUTTON_NAME), openSettings);
  const authorSubscription = openAuthor ? host.subscribe(host.buttonEvent(AUTHOR_BUTTON_NAME), openAuthor) : undefined;
  return () => { subscription.stop(); authorSubscription?.stop(); };
}
