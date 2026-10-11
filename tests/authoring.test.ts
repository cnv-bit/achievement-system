import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAuthorCommand, authorNodes, authorDiagnostics, branchDeletion, createAuthorDocument, invalidNodeReferences, treeLayout, upgradeAuthorDocument } from '../src/domain/authoring.ts';
import { validateContentCatalog } from '../src/domain/validation.ts';
import { AuthorEditor } from '../src/runtime/authoring.ts';
import { getTaskNodeState, nodePrerequisitesSatisfied, applyPlayerCommand, buildPlayerView } from '../src/domain/player-state.ts';
import { emptyAchievementSave } from '../src/domain/save.ts';
import { packTestCatalog, packTestLayouts } from './fixtures/pack-catalog.ts';
import { buildChildApiRequest } from '../src/runtime/request-builder.ts';
import { catalogModelContext } from '../src/runtime/model-context.ts';
import { applyChildApiResponseWithOutcome } from '../src/domain/response-application.ts';
import { migratePackSave } from '../src/domain/pack-migration.ts';
const createEmptySave = () => structuredClone(emptyAchievementSave);

function sample() {
  let doc = createAuthorDocument('sample', '通用测试包');
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'person', id: 'person.a', name: '甲' });
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'person', id: 'person.b', name: '乙' });
  for (const [nodeId, treeId, parentNodeId] of [['a', 'person.a', undefined], ['b', 'person.a', 'a'], ['c', 'person.b', undefined]] as const) {
    doc = applyAuthorCommand(doc, { type: 'createNode', kind: 'person', treeId, nodeId, ...(parentNodeId ? { parentNodeId } : {}) });
    doc = applyAuthorCommand(doc, { type: 'editNode', nodeId, patch: { nodeName: nodeId, condition: '正文确认', description: '作者介绍' } });
  }
  return doc;
}
test('typed dependencies: AND, cycle and parent constraints; dangling references survive branch deletion', () => {
  let doc = sample();
  doc = applyAuthorCommand(doc, { type: 'editNode', nodeId: 'c', patch: { dependencies: [{ nodeId: 'b', kind: 'prerequisite' }] } });
  assert.equal(validateContentCatalog(doc.catalog).ok, true);
  assert.throws(() => applyAuthorCommand(doc, { type: 'editNode', nodeId: 'a', patch: { dependencies: [{ nodeId: 'c', kind: 'prerequisite' }] } }), /存在环/);
  assert.throws(() => applyAuthorCommand(doc, { type: 'editNode', nodeId: 'c', patch: { dependencies: [{ nodeId: 'a', kind: 'branch' }] } }), /强父/);
  assert.deepEqual(branchDeletion(doc, 'a'), ['a', 'b']);
  const deleted = applyAuthorCommand(doc, { type: 'deleteBranch', nodeId: 'a' });
  assert.deepEqual(authorNodes(deleted).map(node => node.nodeId), ['c']);
  assert.equal(authorNodes(deleted)[0]!.dependencies![0]!.nodeId, 'b');
  assert.equal(validateContentCatalog(deleted.catalog).ok, false);
  assert.ok(authorDiagnostics(deleted).some(issue => issue.message.includes('b')));
  const layout = treeLayout(doc, 'person', 'person.a');
  doc = applyAuthorCommand(doc, { type: 'layout', kind: 'person', treeId: 'person.a', layout: { ...layout, hiddenBranchNodeIds: ['b'], visualEdges: [{ from: 'b', to: 'a' }] } });
  assert.deepEqual(branchDeletion(doc, 'a'), ['a', 'b']);
});
test('old dependencies are never guessed as branches; undo restores the full document', () => {
  const base = createAuthorDocument('sample', '测试');
  const old = upgradeAuthorDocument({ ...base, catalog: structuredClone(packTestCatalog), layouts: structuredClone(packTestLayouts) });
  assert.ok(old.pendingBranchNodeIds.length);
  assert.ok(authorNodes(old).every(node => !node.dependencies?.some(dep => dep.kind === 'branch')));
  assert.throws(() => branchDeletion(old, 'story.departure'), /确认/);
  const editor = new AuthorEditor({ ...sample(), revision: 'r1' });
  const before = editor.snapshot();
  editor.dispatch({ type: 'deleteBranch', nodeId: 'a' }); editor.undo();
  assert.deepEqual(editor.snapshot(), before);
  editor.redo(); assert.equal(authorNodes(editor.snapshot()).length, 1);
});
test('v3 generic nodes share lifecycle and static author copy without altering v2 behavior', () => {
  const doc = sample();
  let save = createEmptySave();
  assert.equal(getTaskNodeState(doc.catalog, save, 'a'), 'available');
  assert.equal(getTaskNodeState(doc.catalog, save, 'b'), 'blocked');
  assert.equal(nodePrerequisitesSatisfied(authorNodes(doc)[1]!, save), false);
  save = applyPlayerCommand(doc.catalog, save, { type: 'acceptNodeTask', nodeId: 'a', acceptedAt: '2026-10-11T00:00:00.000Z' });
  assert.equal(getTaskNodeState(doc.catalog, save, 'a'), 'active');
  assert.equal(buildPlayerView(doc.catalog, save).nodes[0]!.authorDescription, '作者介绍');
  assert.equal(getTaskNodeState(packTestCatalog, createEmptySave(), 'bond.demo.reunion'), undefined);
});
test('story material includes external prerequisites; monster admission and both submission checks remain enforced', () => {
  let doc = sample();
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'chapter', id: 'stage.1', name: '第一阶段' });
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'story', id: 'story.one', name: '剧情', parentId: 'stage.1', patch: { keywords: ['火焰'] } });
  doc = applyAuthorCommand(doc, { type: 'createNode', kind: 'story', treeId: 'story.one', nodeId: 'story.root' });
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'monster', id: 'monster.one', name: '生灵', initialNodeId: 'monster.root', patch: { keywords: ['生灵'] } });
  for (const nodeId of ['story.root', 'monster.root']) doc = applyAuthorCommand(doc, { type: 'editNode', nodeId, patch: { nodeName: nodeId, condition: '正文确认', description: '客观介绍', dependencies: [{ nodeId: 'a', kind: 'prerequisite' }] } });
  assert.equal(validateContentCatalog(doc.catalog).ok, true);
  const context = { ...catalogModelContext(doc.catalog), currentChapterId: 'stage.1' };
  const input = { requestId: 'r', chatId: 'chat', catalog: doc.catalog, allowedModules: ['adventure', 'abilities'] as const, selectedGroupIds: [], context, worldContext: [] };
  const request = (save = createEmptySave(), text = '火焰生灵') => buildChildApiRequest({ ...input, allowedModules: [...input.allowedModules], save, bodies: [{ turnIndex: 0, assistant: { id: 1, role: 'assistant', text } }] });
  assert.deepEqual(request().candidates.map(node => node.nodeId), ['story.root']);
  assert.deepEqual(request().candidates[0]!.prerequisiteIds, ['a']);
  assert.equal(request().moduleContext[0]!.nodes[0]!.externalPrerequisitesSatisfied, undefined);
  let save = createEmptySave(); save.nodeProgress.a = { status: 'unlocked', unlockedAt: '2026-10-11T00:00:00.000Z', sourceRefs: [] };
  save = applyPlayerCommand(doc.catalog, save, { type: 'acceptNodeTask', nodeId: 'monster.root', acceptedAt: '2026-10-11T00:00:00.000Z' });
  assert.equal(request(save).candidates.length, 2);
  assert.equal(request(save, '无匹配词').candidates.length, 0);
  const sent = request(save); const retracted = applyPlayerCommand(doc.catalog, save, { type: 'lockNode', nodeId: 'a' });
  const result = applyChildApiResponseWithOutcome({ catalog: doc.catalog, save: retracted, now: '2026-10-11T01:00:00.000Z', requestContext: { requestId: 'r', chatId: 'chat', stateRevision: save.revision, allowedModules: sent.allowedModules, activePersonIds: [], candidateNodeIds: { adventure: ['story.root'], abilities: ['monster.root'] } }, response: { schemaVersion: 1, requestId: 'r', chatId: 'chat', baseRevision: save.revision, judgementSummary: '确认', updates: [{ proposalId: 'p', type: 'unlockNode', module: 'abilities', nodeId: 'monster.root' }] } });
  assert.equal(result.acceptedProposalIds.length, 0); assert.equal(result.rejectedProposals.length, 1);
});
test('explicit v2 to v3 upgrade preserves completed nodes, names and private text', () => {
  const base = createAuthorDocument('sample', '测试');
  const source = { manifest: { ...base.manifest, packVersion: '0001' }, catalog: structuredClone(packTestCatalog), packHash: 'a'.repeat(64) };
  const converted = upgradeAuthorDocument({ ...base, catalog: source.catalog, layouts: structuredClone(packTestLayouts) });
  const target = { manifest: { ...base.manifest, packVersion: '0002', migrations: [{ fromVersion: '0001', fromHash: source.packHash, nodeIds: {} }] }, catalog: converted.catalog, packHash: 'b'.repeat(64) };
  const save = { ...createEmptySave(), packId: 'sample', packVersion: '0001', packHash: source.packHash };
  save.nodeProgress['bond.demo.reunion'] = { status: 'unlocked', unlockedAt: '2026-10-11T00:00:00.000Z', sourceRefs: [], cardId: 'private', nodeNameOverride: '私人名字' };
  save.annotationCards.private = { cardId: 'private', nodeId: 'bond.demo.reunion', style: 'friend', text: '原始文案', textOverride: '私人文案', sourceRefs: [] };
  const before = structuredClone(save), migrated = migratePackSave(save, source, target, '2026-10-11T01:00:00.000Z');
  assert.equal(migrated.save.annotationCards.private!.textOverride, '私人文案');
  assert.equal(migrated.save.nodeProgress['bond.demo.reunion']!.nodeNameOverride, '私人名字');
  assert.deepEqual(save, before);
});
test('indirect invalid references stay visible and mandatory mutually exclusive parents are rejected', () => {
  let doc = sample();
  doc = applyAuthorCommand(doc, { type: 'editNode', nodeId: 'c', patch: { dependencies: [{ nodeId: 'b', kind: 'prerequisite' }] } });
  doc = applyAuthorCommand(doc, { type: 'createNode', kind: 'person', treeId: 'person.b', nodeId: 'd', parentNodeId: 'c' });
  const deleted = applyAuthorCommand(doc, { type: 'deleteBranch', nodeId: 'a' });
  assert.deepEqual(invalidNodeReferences(deleted), { c: ['b'], d: ['b'] });
  assert.ok(authorDiagnostics(deleted).some(issue => issue.path === 'nodes.d.dependencies'));
  doc = applyAuthorCommand(sample(), { type: 'createNode', kind: 'person', treeId: 'person.a', nodeId: 'alternative' });
  doc = applyAuthorCommand(doc, { type: 'choiceGroup', kind: 'person', treeId: 'person.a', id: 'choice.a', name: '分歧' });
  for (const nodeId of ['a', 'alternative']) doc = applyAuthorCommand(doc, { type: 'editNode', nodeId, patch: { choiceGroupId: 'choice.a' } });
  assert.throws(() => applyAuthorCommand(doc, { type: 'editNode', nodeId: 'b', patch: { dependencies: [{ nodeId: 'a', kind: 'branch' }, { nodeId: 'alternative', kind: 'prerequisite' }] } }), /互斥/);
});
test('native v3 admission still checks owner reveal nodes locally', () => {
  let doc = sample();
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'owner', id: 'owner.a', name: '所属者', patch: { revealNodeId: 'a' } });
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'skill', id: 'skill.a', name: '技能树', parentId: 'owner.a' });
  doc = applyAuthorCommand(doc, { type: 'createNode', kind: 'skill', treeId: 'skill.a', nodeId: 'skill.first' });
  const save = createEmptySave();
  assert.equal(catalogModelContext(doc.catalog, save).canSend['owner.a'], false);
  assert.equal(getTaskNodeState(doc.catalog, save, 'skill.first'), 'blocked');
  save.nodeProgress.a = { status: 'unlocked', unlockedAt: '2026-10-11T00:00:00.000Z', sourceRefs: [] };
  assert.equal(catalogModelContext(doc.catalog, save).canSend['owner.a'], true);
  assert.equal(getTaskNodeState(doc.catalog, save, 'skill.first'), 'available');
});
