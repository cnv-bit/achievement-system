import assert from 'node:assert/strict';
import test from 'node:test';
import { applyPlayerCommand, buildPlayerView, emptyAchievementSave, exampleCatalog,
  validateContentCatalog, validateContentLayouts } from '../src/domain/index.ts';
import { bundledLayouts } from '../src/content/index.ts';
import { buildJournalScene } from '../src/frontend/view-scene.ts';
import { buildBondPersonViews, buildCareerTreeViews } from '../src/frontend/journal-layout.ts';
import { applyChildApiResponse } from '../src/runtime/response-application.ts';

test('public demonstration catalog and layouts validate independently', () => {
  assert.equal(validateContentCatalog(exampleCatalog).ok, true);
  assert.equal(validateContentLayouts(bundledLayouts, exampleCatalog).ok, true);
  assert.deepEqual(exampleCatalog.modules.bonds.people.map(person => person.personId), ['person.demo']);
});

test('unmet bond people are hidden and visible careers have collapsed entries', () => {
  const view = buildPlayerView(exampleCatalog, emptyAchievementSave);
  assert.equal(buildBondPersonViews(view.nodes, buildJournalScene(view, bundledLayouts, 'bonds')).length, 0);
  assert.deepEqual(buildCareerTreeViews(view.nodes, buildJournalScene(view, bundledLayouts, 'careers')).map(tree => tree.id), ['career.demo']);
});

test('a confirmed person image reaches the collapsed card without leaking node images', () => {
  const catalog = structuredClone(exampleCatalog);
  Object.assign(catalog.modules.bonds.people[0]!, {imageName:'person.demo.webp',imageAlt:'示例人物插画'});
  const save = structuredClone(emptyAchievementSave);
  save.nodeProgress['bond.demo.met'] = {status:'unlocked',unlockedAt:'2026-10-05T00:00:00.000Z',sourceRefs:[]};
  const view = buildPlayerView(catalog, save);
  const scene = buildJournalScene(view, bundledLayouts, 'bonds', name => name === 'person.demo.webp' ? '/demo.webp' : undefined);
  assert.deepEqual(buildBondPersonViews(view.nodes, scene)[0]?.image, {url:'/demo.webp',alt:'示例人物插画'});
  assert.deepEqual(scene.images, {});
  assert.equal(buildBondPersonViews(view.nodes, buildJournalScene(view, bundledLayouts, 'bonds'))[0]?.image, undefined);
});

test('a growth task must be accepted, judged and claimed before the next task is available', () => {
  const id = 'career.demo.first';
  const accepted = applyPlayerCommand(exampleCatalog, emptyAchievementSave, {type:'acceptNodeTask',nodeId:id,acceptedAt:'2026-10-05T00:00:00.000Z'});
  assert.equal(buildPlayerView(exampleCatalog, accepted).nodes.find(node => node.nodeId === id)?.nodeState, 'active');
  const claimable = applyChildApiResponse({
    catalog:exampleCatalog, save:accepted,
    response:{schemaVersion:1,requestId:'demo-request',chatId:'demo-chat',baseRevision:accepted.revision,
      judgementSummary:'示例任务完成',updates:[{type:'unlockNode',proposalId:'demo-proposal',module:'careers',nodeId:id}]},
    requestContext:{requestId:'demo-request',chatId:'demo-chat',stateRevision:accepted.revision,allowedModules:['careers'],candidateNodeIds:{careers:[id]},activePersonIds:[]},
    processedThrough:{messageId:'message-1',turnIndex:0},now:'2026-10-05T00:01:00.000Z',
  });
  assert.equal(buildPlayerView(exampleCatalog, claimable).nodes.find(node => node.nodeId === id)?.nodeState, 'claimable');
  assert.equal(claimable.nodeProgress[id], undefined);
  const completed = applyPlayerCommand(exampleCatalog, claimable, {type:'claimNodeTask',nodeId:id,claimedAt:'2026-10-05T00:02:00.000Z'});
  assert.equal(buildPlayerView(exampleCatalog, completed).nodes.find(node => node.nodeId === id)?.nodeState, 'completed');
  assert.equal(buildPlayerView(exampleCatalog, completed).nodes.find(node => node.nodeId === 'career.demo.second')?.nodeState, 'available');
});
