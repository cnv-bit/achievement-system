import type { RuntimeSettings } from './model.ts';

export interface SecretState { hasTextApiKey: boolean; hasImageApiKey: boolean }
export type BackendRequest = (route: string, body?: unknown) => Promise<unknown>;

export const requestBackend: BackendRequest = async (route, body = {}) => {
  const response = await fetch(`/api/plugins/goblin-achievements/${route}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...SillyTavern.getRequestHeaders() },
    body: JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(125_000),
  });
  if (response.status === 404) throw new Error('成就系统后端尚未加载，请重启酒馆服务后刷新页面。');
  if (!response.ok) {
    // 只接受本插件的简短错误，不显示代理返回的 HTML 或请求内容。
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : `后端请求失败（HTTP ${response.status}）。`);
  }
  return response.json();
};

export class BackendSecrets {
  private readonly request: BackendRequest;
  private readonly legacy: Pick<Storage, 'getItem' | 'removeItem'>;

  constructor(request: BackendRequest, legacy: Pick<Storage, 'getItem' | 'removeItem'>) {
    this.request = request;
    this.legacy = legacy;
  }

  private async call(route: string, body?: unknown): Promise<SecretState> {
    const result = await this.request(route, body) as Partial<SecretState> | null;
    if (!result || typeof result.hasTextApiKey !== 'boolean' || typeof result.hasImageApiKey !== 'boolean') {
      throw new Error('后端密钥状态无效，未清除浏览器旧密钥。');
    }
    return { hasTextApiKey: result.hasTextApiKey, hasImageApiKey: result.hasImageApiKey };
  }

  async initialize(settings: RuntimeSettings): Promise<SecretState> {
    const name = 'goblin-achievements.secrets.v1';
    const raw = this.legacy.getItem(name);
    if (raw === null) return this.call('state');
    let old;
    try { old = JSON.parse(raw); } catch { throw new Error('旧密钥记录损坏，未删除；请手动核对。'); }
    if (!old || typeof old !== 'object' ||
        typeof old.textApiKey !== 'string' || typeof old.imageApiKey !== 'string') {
      throw new Error('旧密钥记录格式无效，未删除。');
    }
    const result = await this.call('save', {
      migrate: true,
      text: { apiUrl: settings.textApi.apiUrl, key: old.textApiKey },
      image: { apiUrl: settings.imageApi.apiUrl, key: old.imageApiKey },
    });
    if ((old.textApiKey && !result.hasTextApiKey) || (old.imageApiKey && !result.hasImageApiKey)) {
      throw new Error('后端未确认密钥保存，浏览器旧记录已保留。');
    }
    // 其他页签更新过旧记录时不删除新值；下次初始化再核对。
    if (this.legacy.getItem(name) !== raw) throw new Error('旧密钥记录已变化，请刷新后重试迁移。');
    this.legacy.removeItem(name);
    return result;
  }

  save(settings: RuntimeSettings, key: string): Promise<SecretState> {
    return this.call('save', { text: { apiUrl: settings.textApi.apiUrl, key } });
  }
}
