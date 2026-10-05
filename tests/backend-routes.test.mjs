import assert from 'node:assert/strict';
import test from 'node:test';
import { registerRoutes } from '../src/server/index.mjs';

test('backend keeps secrets per account, binds destinations, migrates safely and never returns keys', async () => {
    const routes = new Map(), records = new Map(), outbound = [];
    registerRoutes({ post: (route, handler) => routes.set(route, handler) }, {
        readSecret: (user, name) => records.get(`${user.root}:${name}`) || '',
        writeSecret: (user, name, value) => records.set(`${user.root}:${name}`, value),
        forwardChatCompletion: (_req, res, path, body) => {
            outbound.push({ path, body });
            return res.json(path === '/status' ? { data: [{ id: 'model-a' }] }
                : { choices: [{ message: { content: 'OK' } }] });
        },
    });
    async function call(route, body = {}, account = 'alice') {
        const response = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
        await routes.get(route)({ body, user: account ? { directories: { root: account } } : undefined }, response);
        assert.ok(!JSON.stringify(response).includes('super-test-key'));
        return response;
    }
    assert.equal((await call('/state', {}, null)).code, 401);
    const text = { apiUrl: 'https://api.example.com/v1', key: 'super-test-key' };
    assert.equal((await call('/save', { text })).data.hasTextApiKey, true);
    assert.equal((await call('/state')).data.hasTextApiKey, true);
    assert.equal((await call('/state', {}, 'bob')).data.hasTextApiKey, false);
    assert.equal((await call('/save', { migrate: true, text: { ...text, key: 'different' } })).code, 409);
    assert.equal((await call('/save', { migrate: true, text })).code, 200);
    const connection = { apiUrl: text.apiUrl, apiKey: '', model: 'model-a', maxTokens: 8, temperature: 0 };
    assert.equal((await call('/models', { connection })).code, 200);
    assert.equal(outbound.at(-1).path, '/status');
    assert.equal(outbound.at(-1).body.reverse_proxy, text.apiUrl);
    assert.equal(outbound.at(-1).body.proxy_password, 'super-test-key');
    assert.equal(outbound.at(-1).body.chat_completion_source, 'openai');
    const before = outbound.length;
    assert.equal((await call('/models', { connection: { ...connection, apiUrl: 'https://other.example/v1' } })).code, 400);
    assert.equal(outbound.length, before);
    assert.equal((await call('/save', { text: { apiUrl: 'https://other.example/v1', key: '' } })).code, 400);
    assert.equal((await call('/models', { connection: { ...connection, apiUrl: 'http://remote.example/v1' } })).code, 400);
    assert.equal((await call('/generate', { connection, prompts: [{ role: 'user', content: 'OK?' }] })).data.choices[0].message.content, 'OK');
    assert.equal(outbound.at(-1).path, '/generate');
    assert.equal(outbound.at(-1).body.model, 'model-a');
    assert.equal(outbound.at(-1).body.messages[0].content, 'OK?');
    assert.equal((await call('/models', { connection }, 'bob')).code, 200);
    assert.equal(outbound.at(-1).body.proxy_password, '');
});
