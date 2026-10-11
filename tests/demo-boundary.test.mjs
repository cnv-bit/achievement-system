import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';
import ts from 'typescript';
import { packTestCatalog, packTestLayouts } from './fixtures/pack-catalog.ts';

const root = path.resolve(import.meta.dirname, '..');
const production = await build({
  absWorkingDir: root, entryPoints: ['src/tavern-helper/index.ts'], bundle: true,
  format: 'iife', platform: 'browser', write: false, metafile: true,
  define: { __GOBLIN_JOURNAL_CSS__: '""' },
});

const forbiddenDomainDirectories = [
  'src/content', 'content-packs', 'src/frontend', 'src/tavern-helper', 'src/server',
];
const forbiddenDomainFiles = [
  'src/settings/backend', 'src/settings/dom', 'src/settings/settings-page',
  'src/settings/worldbook-page', 'src/prompting/prompting-page', 'src/notifications',
];

function isForbiddenDomainDependency(specifier, sourceFile) {
  if (!specifier.startsWith('.')) return false;
  const target = path.relative(root, path.resolve(path.dirname(sourceFile), specifier))
    .replaceAll('\\', '/').toLowerCase();
  return forbiddenDomainDirectories.some(directory => target === directory || target.startsWith(directory + '/'))
    || forbiddenDomainFiles.includes(target.replace(/\.ts$/, ''));
}

test('domain boundary permits shared contracts and standard libraries but rejects demo, UI and host adapters', () => {
  const sourceFile = path.join(root, 'src/domain/player-state.ts');
  for (const specifier of ['./types.ts', '../runtime/ports.ts', '../settings/model.ts', 'node:crypto', '../frontend-model.ts']) {
    assert.equal(isForbiddenDomainDependency(specifier, sourceFile), false, specifier);
  }
  for (const specifier of ['../content/examples.ts', '../../content-packs/demo/draft/catalog.json', '../frontend/journal-port.ts', '../tavern-helper/adapters.ts', '../server/index.mjs', '../settings/backend.ts', '../settings/backend', '../settings/settings-page.ts', '../prompting/prompting-page.ts', '../notifications.ts']) {
    assert.equal(isForbiddenDomainDependency(specifier, sourceFile), true, specifier);
  }
});

test('domain imports and type exports do not reference demo, UI or host adapters', () => {
  const directory = path.join(root, 'src/domain');
  for (const file of fs.readdirSync(directory, { recursive: true }).filter(name => name.endsWith('.ts'))) {
    const sourceFile = path.join(directory, file);
    const source = ts.createSourceFile(file, fs.readFileSync(sourceFile, 'utf8'), ts.ScriptTarget.Latest);
    for (const node of source.statements) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
        assert.equal(isForbiddenDomainDependency(node.moduleSpecifier.text, sourceFile), false,
          `${file} depends on forbidden boundary ${node.moduleSpecifier.text}`);
      }
    }
  }
});

test('production bundle does not include demo code or any authored content', () => {
  for (const input of Object.keys(production.metafile.inputs)) {
    assert.doesNotMatch(input.replaceAll('\\', '/'), /(^|\/)(content-packs|src\/content)\/|src\/frontend\/demo\.ts$/);
  }
});

// Keep the real host entry, controllers and storage; replace only page rendering.
const hostBundle = await build({
  absWorkingDir: root, entryPoints: ['src/tavern-helper/index.ts'], bundle: true,
  format: 'iife', platform: 'browser', write: false,
  define: { __GOBLIN_JOURNAL_CSS__: '""' },
  plugins: [{ name: 'settings-page-test-double', setup(builder) {
    builder.onLoad({ filter: /[\\/]settings[\\/]settings-page\.ts$/ }, () => ({
      contents: 'export function mountSettingsPage(container, controller) { globalThis.settingsMounts++; return () => {}; }', loader: 'js',
    }));
  } }],
});

function host({ binding, failLoad = false } = {}) {
  const listeners = new Map(), errors = [], requests = [], writes = [];
  const records = new Map();
  const doc = {
    readyState: 'loading', activeElement: null,
    addEventListener: (event, handler) => listeners.set(event, handler),
    removeEventListener: event => listeners.delete(event),
    querySelector: () => null,
    createElement(tag) {
      return {
        tagName: tag, children: [], style: {}, dataset: {}, attributes: {}, isConnected: true,
        append(...children) { this.children.push(...children); },
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {}, remove() { this.isConnected = false; },
        focus() { doc.activeElement = this; },
        querySelectorAll() { return []; }, getClientRects() { return [{}]; },
      };
    },
  };
  doc.body = doc.createElement('body'); doc.head = doc.createElement('head');
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const tavern = {
    chatMetadata: {}, getCurrentChatId: () => 'test-chat', accountStorage: storage,
    getRequestHeaders: () => ({}),
    updateChatMetadata: values => { Object.assign(tavern.chatMetadata, values); },
    saveMetadata: async () => { writes.push(structuredClone(tavern.chatMetadata)); },
  };
  const context = vm.createContext({
    console, structuredClone, URLSearchParams, AbortSignal, settingsMounts: 0,
    window: { parent: { document: doc, toastr: { success() {}, info() {}, error: message => errors.push(message) } }, localStorage: storage, addEventListener() {} },
    document: doc, SillyTavern: tavern,
    getCharData: () => ({ data: { extensions: binding ? { goblin_achievements: { contentPack: binding } } : {} } }),
    getChatMessages: () => [], replaceScriptButtons() {}, getButtonEvent: name => `button:${name}`,
    eventOn: (event, handler) => { listeners.set(event, handler); return { stop: () => listeners.delete(event) }; },
    tavern_events: { MESSAGE_RECEIVED: 'message_received', CHAT_CHANGED: 'chat_id_changed' },
    async fetch(url, options) {
      requests.push({ url, body: JSON.parse(options.body) });
      if (failLoad) return { ok: false, status: 400, json: async () => ({ error: '内容包文件缺失' }) };
      const catalog = structuredClone(packTestCatalog);
      catalog.modules.careers.nodes = [];
      const hash = 'a'.repeat(64);
      return { ok: true, status: 200, json: async () => ({
        manifest: { schemaVersion: 1, ...binding, packName: '独立测试包', files: { catalog: hash, layouts: hash, theme: hash }, assets: {} },
        catalog, layouts: packTestLayouts, theme: { schemaVersion: 1 }, packHash: hash,
      }) };
    },
  });
  vm.runInContext(hostBundle.outputFiles[0].text, context);
  return { context, listeners, errors, requests, writes, tavern };
}

test('unbound startup never invents progress and its settings button remains usable', async () => {
  const state = host();
  state.listeners.get('DOMContentLoaded')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.errors.length, 1);
  assert.match(state.errors[0], /未绑定内容包/);
  assert.equal(state.requests.length, 0);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.tavern.chatMetadata, {});
  state.listeners.get('button:成就系统设置')();
  assert.equal(state.context.settingsMounts, 1);
  assert.ok(state.listeners.has('keydown'));
  state.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(state.listeners.has('keydown'), false);
});

test('bound startup loads the requested release and stores only empty progress with its binding', async () => {
  const binding = { packId: 'test-pack', packVersion: '0007' };
  const state = host({ binding });
  await state.context.window.GoblinAchievementsPlugin.loadPack();
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].url, '/api/plugins/goblin-achievements/packs/load');
  assert.deepEqual(state.requests[0].body, binding);
  const save = state.tavern.chatMetadata.goblin_achievements;
  assert.equal(save.packId, binding.packId);
  assert.equal(save.packVersion, binding.packVersion);
  assert.deepEqual(save.nodeProgress, {});
  assert.equal(save.journalEntries.length, 0);
  assert.equal(state.errors.length, 0);
});

test('failed release load reports the error without fallback or metadata writes', async () => {
  const state = host({ binding: { packId: 'test-pack', packVersion: '0007' }, failLoad: true });
  await assert.rejects(state.context.window.GoblinAchievementsPlugin.loadPack(), /内容包文件缺失/);
  assert.equal(state.requests.length, 1);
  assert.equal(state.writes.length, 0);
  assert.deepEqual(state.tavern.chatMetadata, {});
  state.context.window.GoblinAchievementsPlugin.openJournal();
  assert.equal(state.context.settingsMounts, 1);
});
