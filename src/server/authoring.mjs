import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthorDocument, upgradeAuthorDocument, validateAuthorDocument, authorDiagnostics, authorEntities, authorKinds, authorNodes, entityAssetPath } from '../domain/authoring.ts';
import { validateContentPack, validatePackBinding, validatePackManifest, isAssetRef, isPackKey } from '../domain/content-pack.ts';
import { containedFile, readReleaseDirectory, sha256 } from './content-packs.mjs';
import { publishContentPack } from './publish-content-pack.mjs';

const names = ['manifest', 'catalog', 'layouts', 'theme'];
const busy = new Set();
const readers = new Map();
async function exclusive(key, action) {
  if (busy.has(key) || readers.has(key)) throw new Error('草稿正在读写，请稍后重试。');
  busy.add(key);
  try { return await action(); } finally { busy.delete(key); }
}
async function sharedRead(key, action) {
  if (busy.has(key)) throw new Error('草稿正在保存，请稍后重试。');
  readers.set(key, (readers.get(key) ?? 0) + 1);
  try { return await action(); }
  finally { const remaining = readers.get(key) - 1; remaining ? readers.set(key, remaining) : readers.delete(key); }
}
async function exists(file) {
  try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function accountPacks(account) {
  let current = await fs.realpath(account);
  for (const segment of ['goblin-achievements', 'packs']) {
    await fs.mkdir(path.join(current, segment), { recursive: true });
    current = await containedFile(current, segment);
  }
  return current;
}
async function packRoot(account, packId, create = false) {
  if (!isPackKey(packId)) throw new Error('内容包 ID 无效。');
  const packs = await accountPacks(account);
  if (create) await fs.mkdir(path.join(packs, packId), { recursive: true });
  return containedFile(packs, packId);
}
async function removeOwnDirectory(root, name) {
  // The resolved deletion target is verified within this account's pack directory.
  await fs.rm(await containedFile(root, name), { recursive: true, force: true });
}
async function readJSON(root, name) {
  const file = await containedFile(root, `${name}.json`);
  if ((await fs.stat(file)).size > 8_000_000) throw new Error('草稿文件过大。');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
async function readDraftDirectory(root) {
  const content = Object.fromEntries(await Promise.all(names.map(async name => [name, await readJSON(root, name)])));
  const meta = await readJSON(root, 'author');
  if (meta.schemaVersion !== 1 || typeof meta.nonce !== 'string') throw new Error('草稿修订文件无效。');
  const doc = { ...content, pendingBranchNodeIds: meta.pendingBranchNodeIds };
  validateDocument(doc);
  const revision = sha256(JSON.stringify([content, meta]));
  return { ...doc, revision, ...(meta.source ? { source: validatePackBinding(meta.source) } : {}) };
}
function validateDocument(doc) {
  if (!doc || Object.keys(doc).some(key => ![...names, 'pendingBranchNodeIds', 'revision', 'source'].includes(key))) throw new Error('草稿含未知字段。');
  validateAuthorDocument(doc);
}
async function recover(root) {
  const draft = path.join(root, 'draft'), previous = path.join(root, '.author-previous');
  if (!await exists(previous)) return;
  await containedFile(root, '.author-previous');
  await readDraftDirectory(previous);
  if (!await exists(draft)) { await fs.rename(previous, draft); return; }
  // A new draft was installed completely; verify it before discarding the previous snapshot.
  await readDraftDirectory(await containedFile(root, 'draft'));
  await removeOwnDirectory(root, '.author-previous');
}
async function load(root) {
  await recover(root);
  const draft = await readDraftDirectory(await containedFile(root, 'draft'));
  if (draft.manifest.packId !== path.basename(root)) throw new Error('草稿包身份不符。');
  return draft;
}
async function copyAssets(from, to) {
  if (!from || !await exists(path.join(from, 'assets'))) return;
  async function copy(relative) {
    const directory = await containedFile(from, relative);
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const ref = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`草稿资源不接受符号链接：${ref}`);
      if (entry.isDirectory()) { await fs.mkdir(path.join(to, ref), { recursive: true }); await copy(ref); }
      else if (entry.isFile()) {
        if (!isAssetRef(ref)) throw new Error(`草稿资源路径无效：${ref}`);
        const source = await containedFile(from, ref);
        if ((await fs.stat(source)).size > 20_000_000) throw new Error(`图片过大：${ref}`);
        await fs.copyFile(source, path.join(to, ref));
      } else throw new Error('草稿资源必须是普通图片文件。');
    }
  }
  await fs.mkdir(path.join(to, 'assets'));
  await copy('assets');
}
async function commit(root, doc, from) {
  validateDocument(doc);
  const stage = await fs.mkdtemp(path.join(root, '.author-stage-'));
  const stageName = path.basename(stage), previous = path.join(root, '.author-previous'), destination = path.join(root, 'draft');
  let movedOld = false, installed = false;
  try {
    await copyAssets(from, stage);
    for (const name of names) await fs.writeFile(path.join(stage, `${name}.json`), JSON.stringify(doc[name], null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(stage, 'author.json'), JSON.stringify({ schemaVersion: 1, nonce: randomUUID(), pendingBranchNodeIds: doc.pendingBranchNodeIds, ...(doc.source ? { source: doc.source } : {}) }), { flag: 'wx' });
    const staged = await readDraftDirectory(stage);
    if (await exists(destination)) { await containedFile(root, 'draft'); await fs.rename(destination, previous); movedOld = true; }
    await fs.rename(stage, destination); installed = true;
    if (movedOld) {
      try { await removeOwnDirectory(root, '.author-previous'); }
      catch (error) { console.error('[achievements] 草稿已保存，旧稿目录清理失败，下次读取会重试', error); }
    }
    return staged;
  } catch (error) {
    if (movedOld && !installed) await fs.rename(previous, destination);
    throw error;
  } finally {
    if (!installed && await exists(stage)) await removeOwnDirectory(root, stageName);
  }
}
async function assetManifest(draft, document) {
  const assets = {};
  if (await exists(path.join(draft, 'assets'))) {
    async function scan(ref) {
      for (const entry of await fs.readdir(await containedFile(draft, ref), { withFileTypes: true })) {
        const next = `${ref}/${entry.name}`;
        if (entry.isSymbolicLink()) throw new Error(`资源不能是符号链接：${next}`);
        if (entry.isDirectory()) await scan(next);
        else if (entry.isFile() && isAssetRef(next)) {
          if (Object.keys(assets).length >= 10_000) throw new Error('资源数量过多。');
          const file = await containedFile(draft, next);
          if ((await fs.stat(file)).size > 20_000_000) throw new Error('资源过大。');
          assets[`asset.${sha256(next).slice(0, 24)}`] = { assetRef: next, sha256: sha256(await fs.readFile(file)) };
        } else throw new Error(`资源必须是安全图片：${next}`);
      }
    }
    await scan('assets');
  }
  // Preserve registered missing references so publication reports them instead of silently unbinding.
  const refs = new Set(Object.values(assets).map(asset => asset.assetRef));
  for (const [id, asset] of Object.entries(document.manifest.assets)) if (!refs.has(asset.assetRef)) assets[id] = asset;
  return assets;
}
function bindSlots(doc) {
  const refs = new Set(Object.values(doc.manifest.assets).map(asset => asset.assetRef));
  const bind = (row, ref) => { if (refs.has(ref)) { row.assetRef = ref; row.imageAlt ||= String(row.nodeName ?? row.personName ?? row.combatTreeName ?? '插图'); delete row.imageName; } };
  for (const kind of Object.keys(authorKinds)) {
    const spec = authorKinds[kind];
    if (kind === 'chapter') continue;
    for (const row of authorEntities(doc, kind)) bind(row, entityAssetPath(kind, row[spec.id]));
  }
  for (const node of authorNodes(doc)) {
    const match = Object.entries(authorKinds).find(([, spec]) => 'layout' in spec && node[spec.id]);
    if (match) bind(node, entityAssetPath(match[0], node[match[1].id]).replace(/\/(card|cover)\.webp$/, `/nodes/${node.nodeId}.webp`));
  }
}
async function fingerprint(root, doc) {
  const parts = [];
  for (const name of names) parts.push(sha256(await fs.readFile(await containedFile(root, `${name}.json`))));
  for (const asset of Object.values(doc.manifest.assets)) parts.push(sha256(await fs.readFile(await containedFile(root, asset.assetRef))));
  return sha256(JSON.stringify(parts));
}

export function createAuthorStorage(account) {
  const locked = (packId, action) => exclusive(`${path.resolve(account)}:${packId}`, async () => action(await packRoot(account, packId)));
  return {
    async list() {
      const packs = await accountPacks(account), result = [];
      for (const entry of await fs.readdir(packs, { withFileTypes: true })) if (entry.isDirectory() && isPackKey(entry.name)) {
        const root = await containedFile(packs, entry.name);
        if (await exists(path.join(root, 'draft')) || await exists(path.join(root, '.author-previous'))) {
          const doc = await locked(entry.name, load); result.push({ packId: entry.name, packName: doc.manifest.packName });
        }
      }
      return result;
    },
    load: packId => locked(packId, load),
    create: (packId, packName) => exclusive(`${path.resolve(account)}:${packId}`, async () => {
      const doc = createAuthorDocument(packId, packName), root = await packRoot(account, packId, true);
      await recover(root);
      if (await exists(path.join(root, 'draft'))) throw new Error('草稿已存在，请打开现有草稿。');
      return commit(root, doc);
    }),
    importRelease: binding => locked(validatePackBinding(binding).packId, async root => {
      await recover(root);
      if (await exists(path.join(root, 'draft'))) throw new Error('已有草稿，不覆盖未发布创作。');
      const source = await containedFile(root, `releases/${binding.packVersion}`);
      const pack = await readReleaseDirectory(source, binding);
      const doc = upgradeAuthorDocument({ manifest: pack.manifest, catalog: pack.catalog, layouts: pack.layouts, theme: pack.theme, pendingBranchNodeIds: [] });
      doc.manifest.migrations = [...(doc.manifest.migrations ?? []).filter(migration => migration.fromVersion !== binding.packVersion), {
        fromVersion: binding.packVersion, fromHash: pack.packHash,
        nodeIds: Object.fromEntries(authorNodes(doc).map(node => [node.nodeId, node.nodeId])),
        chapterIds: Object.fromEntries(doc.catalog.modules.adventure.chapters.map(chapter => [chapter.chapterId, chapter.chapterId])),
      }];
      // The draft needs a fresh release version before this migration becomes publishable.
      doc.manifest.packVersion = binding.packVersion.length <= 75 ? `${binding.packVersion}-next` : `draft-${randomUUID()}`;
      return commit(root, { ...doc, source: binding }, source);
    }),
    save: draft => locked(draft.manifest?.packId, async root => {
      const current = await load(root);
      if (draft.revision !== current.revision) throw new Error('草稿修订冲突，请保留当前页面并重新载入最新稿后核对。');
      return commit(root, { ...draft, ...(current.source ? { source: current.source } : {}) }, await containedFile(root, 'draft'));
    }),
    refreshAssets: (packId, revision) => locked(packId, async root => {
      const doc = await load(root);
      if (doc.revision !== revision) throw new Error('草稿修订冲突。');
      const draft = await containedFile(root, 'draft');
      doc.manifest.assets = await assetManifest(draft, doc); bindSlots(doc);
      return commit(root, doc, draft);
    }),
    preflight: (packId, revision) => locked(packId, async root => {
      const doc = await load(root);
      if (doc.revision !== revision) throw new Error('草稿修订冲突。');
      const issues = authorDiagnostics(doc);
      try { validateContentPack(doc); }
      catch (error) { issues.push({ path: 'pack', code: 'INVALID_VALUE', message: error.message }); }
      let value = '';
      try { value = await fingerprint(await containedFile(root, 'draft'), doc); }
      catch (error) { issues.push({ path: 'assets', code: 'UNKNOWN_REFERENCE', message: `资源检查失败：${error.code ?? error.message}` }); }
      return { revision, fingerprint: value, issues };
    }),
    publish: (packId, preflight) => locked(packId, async root => {
      const doc = await load(root), draft = await containedFile(root, 'draft');
      if (preflight.revision !== doc.revision || preflight.fingerprint !== await fingerprint(draft, doc)) throw new Error('草稿或资源已变化，请重新预检。');
      if (authorDiagnostics(doc).length) throw new Error('草稿有未解决问题，不能发布。');
      await publishContentPack(draft, await accountPacks(account), async () => {
        if (preflight.fingerprint !== await fingerprint(draft, doc)) throw new Error('发布期间草稿或资源已变化，请重新预检。');
      });
      return { packId, packVersion: doc.manifest.packVersion };
    }),
    asset: (packId, ref) => sharedRead(`${path.resolve(account)}:${packId}`, async () => {
      if (!isAssetRef(ref)) throw new Error('资源路径无效。');
      const root = await packRoot(account, packId);
      const draft = await containedFile(root, await exists(path.join(root, 'draft')) ? 'draft' : '.author-previous');
      const manifest = validatePackManifest(await readJSON(draft, 'manifest'));
      if (manifest.packId !== packId || !Object.values(manifest.assets).some(asset => asset.assetRef === ref)) throw new Error('资源未登记或草稿身份不符。');
      const file = await containedFile(draft, ref);
      if ((await fs.stat(file)).size > 20_000_000) throw new Error('资源过大。');
      return fs.readFile(file);
    }),
  };
}

export function registerAuthorRoutes(router) {
  const actions = {
    list: (store) => store.list(), load: (store, body) => store.load(body.packId),
    create: (store, body) => store.create(body.packId, body.packName),
    import: (store, body) => store.importRelease(body), save: (store, body) => store.save(body),
    assets: (store, body) => store.refreshAssets(body.packId, body.revision),
    preflight: (store, body) => store.preflight(body.packId, body.revision), publish: (store, body) => store.publish(body.packId, body.preflight),
  };
  for (const [name, action] of Object.entries(actions)) router.post(`/author/${name}`, async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
    if (!req.user?.directories?.root) return res.status(401).json({ error: '请先登录酒馆。' });
    try { return res.json(await action(createAuthorStorage(req.user.directories.root), req.body ?? {})); }
    catch (error) { console.error(`[achievements] author/${name}`, error); return res.status(400).json({ error: `作者操作失败：${error.code ?? error.message}` }); }
  });
  router.get('/author/asset', async (req, res) => {
    res.set('Cache-Control', 'no-store'); res.set('X-Content-Type-Options', 'nosniff');
    if (!req.user?.directories?.root) return res.status(401).json({ error: '请先登录酒馆。' });
    try {
      const bytes = await createAuthorStorage(req.user.directories.root).asset(req.query?.packId, req.query?.assetRef);
      return res.type({ '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.avif': 'image/avif' }[path.extname(req.query.assetRef).toLowerCase()]).send(bytes);
    } catch (error) { console.error('[achievements] author/asset', error); return res.status(400).json({ error: `草稿图片载入失败：${error.code ?? error.message}` }); }
  });
}
