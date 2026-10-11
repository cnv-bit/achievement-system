import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const [targetArgument, tavernArgument] = process.argv.slice(2);
if (!targetArgument || !tavernArgument) throw new Error('Usage: node scripts/deploy-model-side.mjs <character.png> <SillyTavern-root>');
const projectRoot = path.resolve(import.meta.dirname, '..');
const target = path.resolve(targetArgument);
const bundle = path.join(projectRoot, 'dist', 'goblin-achievements.js');
const backupDir = path.join(projectRoot, 'backups');
const parserPath = path.join(path.resolve(tavernArgument), 'src', 'character-card-parser.js');
if (path.extname(target).toLowerCase() !== '.png') throw new Error('角色卡目标必须是 PNG 文件。');
const scriptId = '7a264b34-199d-4cff-8f9b-109dbac46732';
const scriptName = '成就系统｜模型侧';
const args = process.argv.slice(4);
const replaceDefault = args[2] === '--replace-default-pack';
if (args.length && (args[0] !== '--content-pack-release' || (args.length !== 2 && !(args.length === 3 && replaceDefault)))) {
  throw new Error('Usage: node scripts/deploy-model-side.mjs <character.png> <SillyTavern-root> [--content-pack-release <release-dir> [--replace-default-pack]]');
}

for (const requiredPath of [target, bundle, parserPath]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`缺少部署文件：${requiredPath}`);
}

const parser = await import(pathToFileURL(parserPath).href);
const originalImage = fs.readFileSync(target);
const card = JSON.parse(parser.read(originalImage));
const extensions = card.data.extensions ??= {};
let packBinding;
if (args.length) {
  const { validatePackBinding } = await import('../src/domain/content-pack.ts');
  const { readReleaseDirectory } = await import('../src/server/content-packs.mjs');
  const manifest = JSON.parse(fs.readFileSync(path.join(args[1], 'manifest.json'), 'utf8'));
  packBinding = validatePackBinding({ packId: manifest.packId, packVersion: manifest.packVersion });
  await readReleaseDirectory(args[1], packBinding);
  const configuration = extensions.goblin_achievements ??= {};
  if (!replaceDefault && configuration.contentPack !== undefined) assert.deepEqual(configuration.contentPack, packBinding, 'Refusing an implicit change to the existing pack binding.');
  configuration.contentPack = packBinding;
  configuration.legacyContentPack ??= packBinding;
}
const tavernHelper = extensions.tavern_helper ??= { scripts: [], variables: {} };
let scripts;
if (Array.isArray(tavernHelper)) {
  let scriptsEntry = tavernHelper.find(entry => Array.isArray(entry) && entry[0] === 'scripts');
  if (!scriptsEntry) {
    scriptsEntry = ['scripts', []];
    tavernHelper.push(scriptsEntry);
  }
  scripts = Array.isArray(scriptsEntry[1]) ? scriptsEntry[1] : (scriptsEntry[1] = []);
} else {
  scripts = Array.isArray(tavernHelper.scripts) ? tavernHelper.scripts : (tavernHelper.scripts = []);
}
const content = fs.readFileSync(bundle, 'utf8');
const entry = {
  type: 'script',
  enabled: true,
  name: scriptName,
  id: scriptId,
  content,
  info: '成就系统手账入口、文本子 API 配置、提示词预览与手动／自动判定。',
  button: { enabled: true, buttons: [{ name: '成就系统设置', visible: true }] },
  data: {},
};
const existingIndex = scripts.findIndex(script => script?.id === scriptId || script?.name === scriptName);
// Existing button/settings metadata belongs to the user; upgrades replace code only.
if (existingIndex >= 0) scripts[existingIndex] = { ...scripts[existingIndex], content };
else scripts.push(entry);

const nextImage = parser.write(originalImage, JSON.stringify(card));
const verified = JSON.parse(parser.read(nextImage));
assert.deepEqual(verified, card, '角色卡写入器不得改变其他元数据。');
const verifiedHelper = verified?.data?.extensions?.tavern_helper;
const verifiedScripts = Array.isArray(verifiedHelper)
  ? verifiedHelper.find(entry => Array.isArray(entry) && entry[0] === 'scripts')?.[1]
  : verifiedHelper?.scripts;
if (!Array.isArray(verifiedScripts)) throw new Error('生成后的角色卡缺少酒馆助手脚本数组。');
const installed = verifiedScripts.find(script => script?.id === scriptId);
if (!installed || installed.content !== content || installed.name !== scriptName) {
  throw new Error('生成后的角色卡回读校验失败。');
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `${path.basename(target, '.png')}-before-model-side-${stamp}.png`);
fs.copyFileSync(target, backup);
fs.writeFileSync(target, nextImage);

const deployed = JSON.parse(parser.read(fs.readFileSync(target)));
assert.deepEqual(deployed, card, 'Deployed card metadata must match the verified result.');
const deployedHelper = deployed.data.extensions.tavern_helper;
const deployedScripts = Array.isArray(deployedHelper)
  ? deployedHelper.find(entry => Array.isArray(entry) && entry[0] === 'scripts')?.[1]
  : deployedHelper.scripts;
const deployedEntry = deployedScripts.find(script => script?.id === scriptId);
if (!deployedEntry || deployedEntry.content !== content) {
  throw new Error('目标角色卡写入后的回读校验失败；可从备份恢复。');
}

console.log(JSON.stringify({
  target,
  backup,
  cardName: deployed.data.name,
  scriptId,
  scriptName,
  bundleBytes: Buffer.byteLength(content),
  bundleSha256: crypto.createHash('sha256').update(content).digest('hex'),
  scriptCount: deployedScripts.length,
  packBinding,
  changedFields: [existingIndex >= 0 ? '模型侧脚本.content' : '新增模型侧脚本', ...(packBinding ? ['默认内容包绑定（旧存档映射保留）'] : [])],
}, null, 2));
