import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Real UI and application session with isolated memory storage; never user accounts or models.
const [playwrightModule, tavernCssPath] = process.argv.slice(2);
if (!playwrightModule || !tavernCssPath) throw new Error('Usage: node scripts/check-author-editor.mjs <playwright-module> <SillyTavern-style.css>');
const { chromium } = (await import(pathToFileURL(playwrightModule).href)).default;
const root = path.resolve(import.meta.dirname, '..'), output = path.join(root, 'experiments', 'author-editor-20261011');
await fs.mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, contents: `
  import { mountAuthorPage } from './src/frontend/author-page.ts';
  import { AuthorEditor } from './src/runtime/authoring.ts';
  import { authorDiagnostics, createAuthorDocument } from './src/domain/authoring.ts';
  let saved, active, counter=0;
  const revision=()=> (++counter).toString(16).padStart(64,'0');
  const storage={
    list:async()=>saved?[{packId:saved.manifest.packId,packName:saved.manifest.packName}]:[],
    create:async(id,name)=>{saved={...createAuthorDocument(id,name),revision:revision()};return structuredClone(saved)},
    load:async()=>structuredClone(saved),
    save:async(doc)=>{if(doc.revision!==saved.revision)throw Error('修订冲突');saved={...structuredClone(doc),revision:revision()};return structuredClone(saved)},
    importRelease:async()=>{throw Error('隔离预览无发布包')},
    refreshAssets:async()=>structuredClone(saved),
    preflight:async()=>({revision:saved.revision,fingerprint:'f'.repeat(64),issues:authorDiagnostics(saved)}),
    publish:async()=>({packId:saved.manifest.packId,packVersion:saved.manifest.packVersion}),
  };
  window.authorTest={snapshot:()=>active.snapshot(),saved:()=>structuredClone(saved),large:()=>{
    const doc=createAuthorDocument('large-isolated','300 节点隔离验收');
    doc.catalog.modules.bonds.people.push({personId:'person.large',personName:'大树',keywords:[]});
    doc.layouts.bondTrees['person.large']={width:7000,height:1600,positions:{}};
    for(let i=0;i<300;i++){
      const nodeId='node.'+i;
      doc.catalog.modules.bonds.nodes.push({nodeId,nodeName:'节点 '+i,condition:'正文确认',personId:'person.large',dependencies:i?[{nodeId:'node.'+(i-1),kind:'branch'}]:[]});
      doc.layouts.bondTrees['person.large'].positions[nodeId]={x:30+(i%30)*220,y:30+Math.floor(i/30)*120};
    }
    saved={...doc,revision:revision()};
  }};
  mountAuthorPage(document.querySelector('#host'),storage,{createSession:doc=>{active=new AuthorEditor(doc);return active},assetUrl:()=>'',onClose:()=>{}});
` }, bundle: true, format: 'iife', platform: 'browser', write: false });
const css = await fs.readFile(tavernCssPath, 'utf8');
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<style>${css}</style><div id="host"></div><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.accept());
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:') ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForLoadState('networkidle');
  const dialog = () => page.locator('.achievement-author dialog').last();
  const submit = () => dialog().getByRole('button', { name: '确认修改', exact: true }).click();
  const node = name => page.locator('.author-node').filter({ hasText: name });
  const snapshot = () => page.evaluate(() => window.authorTest.snapshot());
  async function fillNode(name) {
    await dialog().getByLabel('名称', { exact: true }).fill(name);
    await dialog().getByLabel('给用户的话').fill('客观介绍');
    await dialog().getByLabel('完成判定条件（供 AI 判断）').fill('正文明确确认'); await submit();
  }
  async function person(name) {
    await page.locator('nav').getByRole('button', { name: '人物与羁绊', exact: true }).click();
    await page.getByRole('button', { name: '＋人物', exact: true }).click();
    await dialog().getByLabel('名称', { exact: true }).fill(name); await submit();
    await page.getByRole('button', { name: '创建首个节点', exact: true }).click();
  }
  await page.getByRole('button', { name: '新建卡带', exact: true }).click();
  await dialog().getByLabel('包 ID（英文字母、数字、点和连字符）').fill('browser-isolated');
  await dialog().getByLabel('名称', { exact: true }).fill('隔离作者验收'); await submit();
  await page.getByRole('button', { name: '＋剧情阶段', exact: true }).waitFor();
  await person('人物甲'); await fillNode('根节点甲');
  await node('根节点甲').click(); assert.equal(await dialog().getByLabel('名称', { exact: true }).getAttribute('readonly'), '');
  await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await node('根节点甲').click({ button: 'right' }); await page.getByRole('menuitem', { name: '新建子节点', exact: true }).click(); await fillNode('子节点乙');
  let draft = await snapshot(); const personA = draft.catalog.modules.bonds.people[0].personId, rootId = draft.catalog.modules.bonds.nodes[0].nodeId, childId = draft.catalog.modules.bonds.nodes[1].nodeId;
  const before = draft.layouts.bondTrees[personA].positions[childId], box = await node('子节点乙').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 70, { steps: 5 }); await page.mouse.up();
  draft = await snapshot(); assert.equal(draft.layouts.bondTrees[personA].positions[childId].x, before.x + 60);
  assert.equal(await page.locator('.achievement-author dialog[open]').count(), 0, 'drag must not open the viewer');
  await node('子节点乙').click({ button: 'right' }); await page.getByRole('menuitem', { name: '线条外观', exact: true }).click();
  await dialog().getByLabel('强父连接线').selectOption('hide'); await submit();
  assert.equal(await page.locator('.author-canvas svg path').count(), 0);
  assert.equal((await snapshot()).catalog.modules.bonds.nodes[1].dependencies[0].nodeId, rootId);
  await node('根节点甲').click({ button: 'right' }); await page.getByRole('menuitem', { name: '线条外观', exact: true }).click();
  await dialog().getByLabel('增加视觉连线到').selectOption(childId); await submit();
  assert.equal(await page.locator('.author-canvas svg path.decorative').count(), 1);
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const bounds = await page.locator('.achievement-author').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(bounds.scroll <= bounds.width + 1, `outer overflow at ${width}`);
    await page.screenshot({ path: path.join(output, `author-${width}.png`) });
  }
  await person('人物丙'); await fillNode('引用节点丙');
  await node('引用节点丙').click({ button: 'right' }); await page.getByRole('menuitem', { name: '编辑数据', exact: true }).click();
  await dialog().locator('.author-options label').filter({ hasText: '子节点乙' }).locator('input').check(); await submit();
  await page.locator('nav').getByRole('button', { name: '人物与羁绊', exact: true }).click();
  await page.getByRole('button', { name: '人物甲', exact: true }).click();
  await node('根节点甲').click({ button: 'right' }); await page.getByRole('menuitem', { name: '删除分支', exact: true }).click();
  assert.equal((await snapshot()).catalog.modules.bonds.nodes.length, 1);
  await page.locator('nav').getByRole('button', { name: '人物与羁绊', exact: true }).click();
  await page.getByRole('button', { name: '人物丙', exact: true }).click(); assert.equal(await page.locator('.author-node.is-invalid').count(), 1);
  await page.getByRole('button', { name: '撤销', exact: true }).click(); assert.equal((await snapshot()).catalog.modules.bonds.nodes.length, 3);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await node('引用节点丙').click({ button: 'right' }); await page.getByRole('menuitem', { name: '编辑数据', exact: true }).click();
  await dialog().locator('.author-options input:checked').uncheck(); await submit(); assert.equal(await page.locator('.author-node.is-invalid').count(), 0);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await page.getByRole('status').filter({ hasText: '草稿已完整保存' }).waitFor();
  const saved = await page.evaluate(() => window.authorTest.saved());
  await page.getByRole('button', { name: '打开草稿', exact: true }).click(); await page.getByRole('button', { name: '隔离作者验收 · browser-isolated', exact: true }).click();
  assert.deepEqual(await snapshot(), saved);
  await page.getByRole('button', { name: '发布预检', exact: true }).click(); await page.getByRole('button', { name: '发布新版本', exact: true }).waitFor();
  async function entity(label, name, nodeName) {
    const modules = { '＋剧情阶段': '冒险与故事', '＋职业': '职业与成长', '＋技能所属者': '战斗与技艺', '＋知识领域': '知识体系', '＋怪物': '战斗与技艺' };
    if (modules[label]) await page.locator('nav').getByRole('button', { name: modules[label], exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click(); await dialog().getByLabel('名称', { exact: true }).fill(name); await submit();
    if (nodeName) {
      if (label === '＋剧情树') {
        assert.equal(await page.locator('[data-author-entry]').count(), 1);
        assert.equal(await page.locator('.author-issues').getByRole('button').count(), 0, 'empty story must not report root errors');
        await page.locator('[data-author-entry]').click({ button: 'right' });
        await page.getByRole('menuitem', { name: '新建子节点', exact: true }).click();
        assert.equal(await dialog().getByText('整树触发关键词（每行一个）', { exact: true }).count(), 0);
      } else await page.getByRole('button', { name: '创建首个节点', exact: true }).click();
      await fillNode(nodeName);
    }
  }
  await entity('＋剧情阶段', '阶段一'); await entity('＋剧情树', '故事树', '剧情入口');
  const storyBefore = await snapshot();
  await page.locator('[data-author-entry]').click({ button: 'right' }); await page.getByRole('menuitem', { name: '编辑整树资料与关键词', exact: true }).click();
  await dialog().getByLabel('整树触发关键词（每行一个）').fill('碧湖港\n湖畔'); await submit();
  await node('剧情入口').click({ button: 'right' }); await page.getByRole('menuitem', { name: '新建子节点', exact: true }).click(); await fillNode('办理证明');
  await page.screenshot({ path: path.join(output, 'story-entry.png') });
  await page.getByRole('button', { name: '返回阶段一', exact: true }).click();
  assert.equal(await page.locator('.author-card').count(), 1);
  await page.screenshot({ path: path.join(output, 'story-cards.png') });
  await page.getByRole('button', { name: '故事树', exact: true }).click();
  await page.getByRole('button', { name: '删除剧情树', exact: true }).click();
  assert.equal((await snapshot()).catalog.modules.adventure.storyTrees.length, 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal((await snapshot()).catalog.modules.adventure.storyTrees[0].storyTreeId, storyBefore.catalog.modules.adventure.storyTrees[0].storyTreeId);
  await page.getByRole('button', { name: '删除剧情阶段', exact: true }).click();
  assert.equal((await snapshot()).catalog.modules.adventure.chapters.length, 0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.getByRole('button', { name: '阶段一', exact: true }).click(); await page.getByRole('button', { name: '故事树', exact: true }).click();
  assert.equal(await page.locator('[data-author-entry]').count(), 1);
  assert.equal(await node('办理证明').count(), 1);
  await entity('＋职业', '职业树', '职业起点'); await entity('＋技能所属者', '技能所属者甲'); await entity('＋技能树', '技能树甲', '技能起点');
  await entity('＋知识领域', '知识领域甲'); await entity('＋知识主题', '知识主题甲', '知识起点');
  await entity('＋怪物', '怪物甲'); await fillNode('初见怪物');
  assert.equal(await page.locator('.author-node').count(), 1);
  const monsterBox = await node('初见怪物').boundingBox(), monsterBefore = (await snapshot()).layouts.combatTrees;
  await page.mouse.move(monsterBox.x+20,monsterBox.y+20); await page.mouse.down(); await page.mouse.move(monsterBox.x+90,monsterBox.y+60); await page.mouse.up();
  assert.deepEqual((await snapshot()).layouts.combatTrees, monsterBefore, 'monster nodes must not freely drag');
  // A click after the immobile monster gesture may open its viewer; close it before saving.
  if (await page.locator('.achievement-author dialog[open]').count()) await dialog().getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await page.getByRole('status').filter({ hasText: '草稿已完整保存' }).waitFor();
  await page.getByRole('button', { name: '发布预检', exact: true }).click(); await page.getByRole('button', { name: '发布新版本', exact: true }).waitFor();
  await page.evaluate(() => window.authorTest.large());
  await page.getByRole('button', { name: '打开草稿', exact: true }).click(); await page.getByRole('button', { name: '300 节点隔离验收 · large-isolated', exact: true }).click();
  await page.locator('nav').getByRole('button', { name: '人物与羁绊', exact: true }).click();
  const started = performance.now(); await page.getByRole('button', { name: '大树', exact: true }).click();
  assert.equal(await page.locator('.author-node').count(), 300);
  const timing = { nodeCount: 300, openTreeMs: Math.round(performance.now()-started), includesBrowserAutomation: true };
  await fs.writeFile(path.join(output,'measurement.json'),JSON.stringify(timing,null,2)+'\n');
  assert.deepEqual(errors, []);
  console.log('作者浏览器验收通过：逐层卡片/自动剧情入口/整树关键词/首节点与子节点/阶段与树删除撤销/查看/拖动/线条显隐/跨树前置/删除红标/保存重开/预检；四种宽度。');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
