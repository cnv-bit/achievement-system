import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAuthorStorage, registerAuthorRoutes } from '../src/server/authoring.mjs';
import { applyAuthorCommand } from '../src/domain/authoring.ts';

test('account drafts: reopen, conflict, complete rollback, asset slots and immutable publication', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'achievement-author-'));
  try {
    const store = createAuthorStorage(temp);
    let draft = await store.create('generic', '通用卡带');
    draft = { ...draft, ...applyAuthorCommand(draft, { type: 'createEntity', kind: 'person', id: 'person.a', name: '人物甲' }) };
    draft = { ...draft, ...applyAuthorCommand(draft, { type: 'createNode', kind: 'person', treeId: 'person.a', nodeId: 'node.a' }) };
    const savedBlank = await store.save(draft);
    assert.ok((await store.preflight('generic', savedBlank.revision)).issues.length);
    await assert.rejects(store.save(draft), /修订冲突/);
    draft = { ...savedBlank, ...applyAuthorCommand(savedBlank, { type: 'editNode', nodeId: 'node.a', patch: { nodeName: '首次相遇', condition: '正文相遇' } }) };
    const rename = fs.rename;
    let failed = false;
    t.mock.method(fs, 'rename', async (from, to) => {
      if (!failed && path.basename(from).startsWith('.author-stage-')) { failed = true; throw new Error('模拟提交失败'); }
      return rename(from, to);
    });
    await assert.rejects(store.save(draft), /模拟提交失败/);
    assert.deepEqual(await store.load('generic'), savedBlank);
    t.mock.restoreAll();
    draft = await store.save(draft);
    const asset = path.join(temp, 'goblin-achievements', 'packs', 'generic', 'draft', 'assets', 'bonds', 'person.a', 'card.webp');
    await fs.mkdir(path.dirname(asset), { recursive: true }); await fs.writeFile(asset, Buffer.from('test-webp'));
    draft = await store.refreshAssets('generic', draft.revision);
    assert.equal(draft.catalog.modules.bonds.people[0].assetRef, 'assets/bonds/person.a/card.webp');
    const images = await Promise.all([store.asset('generic', 'assets/bonds/person.a/card.webp'), store.asset('generic', 'assets/bonds/person.a/card.webp')]);
    assert.ok(images.every(bytes => bytes.toString() === 'test-webp'));
    const preview = await store.preflight('generic', draft.revision);
    assert.deepEqual(preview.issues, []);
    await fs.appendFile(asset, 'changed');
    await assert.rejects(store.publish('generic', preview), /已变化/);
    const refreshed = await store.preflight('generic', draft.revision);
    assert.deepEqual(await store.publish('generic', refreshed), { packId: 'generic', packVersion: '0001' });
    await assert.rejects(store.publish('generic', refreshed), /不得覆盖/);
    assert.equal((await store.load('generic')).revision, draft.revision);
    const actualDraftRoot = path.join(temp, 'goblin-achievements', 'packs', 'generic', 'draft');
    const catalogBytes = await fs.readFile(path.join(actualDraftRoot, 'catalog.json'));
    draft = { ...draft, ...applyAuthorCommand(draft, { type: 'version', version: '0002' }) };
    draft = await store.save(draft);
    const racePreflight = await store.preflight('generic', draft.revision), copyFile = fs.copyFile;
    t.mock.method(fs, 'copyFile', async (from, to) => {
      await copyFile(from, to);
      if (path.basename(from) === 'theme.json') await fs.appendFile(path.join(actualDraftRoot, 'catalog.json'), '\n');
    });
    await assert.rejects(store.publish('generic', racePreflight), /发布期间.*已变化/);
    t.mock.restoreAll(); await fs.writeFile(path.join(actualDraftRoot, 'catalog.json'), catalogBytes);
    // Recover a crash between the two directory renames; metadata and content stay together.
    await fs.rename(actualDraftRoot, path.join(path.dirname(actualDraftRoot), '.author-previous'));
    assert.deepEqual(await store.load('generic'), draft);
    assert.deepEqual(await store.list(), [{ packId: 'generic', packName: '通用卡带' }]);
    await assert.rejects(store.asset('generic', '../secrets.json'), /路径无效/);
    await assert.rejects(createAuthorStorage(path.join(temp, 'bob')).load('generic'));
    await assert.rejects(store.create('../escape', '不合法'), /ID/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
test('author routes require host login and use no-store', async () => {
  const routes = new Map();
  registerAuthorRoutes({ post: (name, action) => routes.set(name, action), get: (name, action) => routes.set(name, action) });
  const res = { headers: {}, set(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.data = value; return this; } };
  await routes.get('/author/list')({}, res);
  assert.equal(res.code, 401); assert.equal(res.headers['Cache-Control'], 'no-store');
});
