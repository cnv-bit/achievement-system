import { registerContentPackRoutes } from './content-packs.mjs';
import { registerAuthorRoutes } from './authoring.mjs';
export const info = { id: 'goblin-achievements', name: '成就系统内容与请求', description: '按酒馆账号管理卡带草稿与不可变发布版本；仅后端使用已保存密钥。' };
const SECRET = 'goblin_achievements_connections_v1';

function baseUrl(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('API 地址不能为空。');
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash) {
        throw new Error('API 地址须使用 HTTPS（仅本机回环地址允许 HTTP），且不能含凭证、查询或片段。');
    }
    return url.href.replace(/\/+$/, '');
}

function keyValue(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > 8192 || /[\r\n]/.test(value)) throw new Error('密钥格式无效。');
    return value.trim();
}

/** 依赖注入只用于本地无真实密钥的接口测试。 */
export function registerRoutes(router, { readSecret, writeSecret, forwardChatCompletion }) {
    function load(req) {
        const raw = readSecret(req.user.directories, SECRET);
        return raw ? JSON.parse(raw) : {};
    }
    const state = record => ({ hasTextApiKey: Boolean(record.text?.key), hasImageApiKey: Boolean(record.image?.key) });

    function route(name, action) {
        router.post(name, async (req, res) => {
            if (!req.user?.directories) return res.status(401).json({ error: '请先登录酒馆。' });
            res.set('Cache-Control', 'no-store');
            try { return await action(req, res); }
            catch { return res.status(400).json({ error: '操作失败：请检查 API 地址、密钥、模型与网络；更换地址时须重新填写密钥。' }); }
        });
    }

    route('/state', (req, res) => res.json(state(load(req))));
    route('/save', (req, res) => {
        const record = load(req);
        for (const slot of ['text', 'image']) {
            const input = req.body?.[slot];
            if (!input) continue;
            const key = keyValue(input.key);
            // 无配置的预留生图槽不需要地址，也不创建空秘密。
            if (!input.apiUrl && !key && !record[slot]) continue;
            const apiUrl = baseUrl(input.apiUrl);
            const previous = record[slot];
            if (req.body.migrate && previous?.key && (key !== previous.key || apiUrl !== previous.apiUrl)) {
                return res.status(409).json({ error: '浏览器旧密钥与后端已有配置不同，未覆盖也未删除；请核对后再迁移。' });
            }
            if (!key && previous?.key && apiUrl !== previous.apiUrl) throw new Error('地址绑定不匹配');
            record[slot] = { apiUrl, key: key || previous?.key || '' };
        }
        const serialized = JSON.stringify(record);
        if (serialized !== readSecret(req.user.directories, SECRET)) writeSecret(req.user.directories, SECRET, serialized);
        if (serialized !== readSecret(req.user.directories, SECRET)) throw new Error('密钥保存回读不一致');
        // 只返回存在状态；不回传密钥，不经 /secrets/find 解密取回。
        res.json(state(load(req)));
    });

    function upstream(req, res, models) {
        const input = req.body?.connection;
        if (!input) throw new Error('缺少连接配置');
        const apiUrl = baseUrl(input.apiUrl);
        const transientKey = keyValue(input.apiKey);
        const saved = load(req)[models && req.body.slot === 'image' ? 'image' : 'text'];
        if (!transientKey && saved?.key && saved.apiUrl !== apiUrl) throw new Error('地址绑定不匹配');
        const key = transientKey || saved?.key || '';
        if (models) {
            return forwardChatCompletion(req, res, '/status', {
                reverse_proxy: apiUrl,
                proxy_password: key,
                chat_completion_source: 'openai',
            });
        }
        {
            if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 256 ||
                !Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 131072 ||
                !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2 ||
                !Array.isArray(req.body.prompts) || !req.body.prompts.length ||
                req.body.prompts.some(p => !['system', 'user', 'assistant'].includes(p.role) || typeof p.content !== 'string')) {
                throw new Error('请求参数无效');
            }
            if (JSON.stringify(req.body.prompts).length > 2_000_000) throw new Error('请求过大');
        }
        return forwardChatCompletion(req, res, '/generate', {
            reverse_proxy: apiUrl,
            proxy_password: key,
            chat_completion_source: 'openai',
            model: input.model,
            messages: req.body.prompts,
            max_tokens: input.maxTokens,
            temperature: input.temperature,
            stream: false,
        });
    }
    route('/models', (req, res) => upstream(req, res, true));
    route('/generate', (req, res) => upstream(req, res, false));
}

export async function init(router) {
    const secrets = await import(new URL('../../src/endpoints/secrets.js', import.meta.url).href);
    const chatCompletions = await import(new URL('../../src/endpoints/backends/chat-completions.js', import.meta.url).href);
    const forwardChatCompletion = (req, res, path, body) => {
        const forwarded = Object.create(req);
        forwarded.url = path;
        forwarded.originalUrl = path;
        forwarded.baseUrl = '';
        forwarded.body = body;
        chatCompletions.router.handle(forwarded, res, error => {
            if (res.headersSent) return;
            if (error) return res.status(502).json({ error: '酒馆 API 通道处理失败。' });
            return res.status(404).json({ error: '当前酒馆版本缺少所需 API 通道。' });
        });
    };
    registerRoutes(router, { ...secrets, forwardChatCompletion });
    registerContentPackRoutes(router);
    registerAuthorRoutes(router);
}
