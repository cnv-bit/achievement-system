import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAuthorCommand, authorNodes, authorDiagnostics, createAuthorDocument, upgradeAuthorDocument } from '../src/domain/authoring.ts';
import { validateContentCatalog, validateContentLayouts } from '../src/domain/validation.ts';
import { AuthorEditor } from '../src/runtime/authoring.ts';
import { emptyAchievementSave } from '../src/domain/save.ts';
import { buildChildApiRequest } from '../src/runtime/request-builder.ts';
import { catalogModelContext } from '../src/runtime/model-context.ts';
import { applyChildApiResponseWithOutcome } from '../src/domain/response-application.ts';
import { getTaskNodeState, buildPlayerView } from '../src/domain/player-state.ts';
import { migratePackSave } from '../src/domain/pack-migration.ts';

function sample() {
  let doc = createAuthorDocument('harbor', '碧湖港');
  for (const id of ['stage.one', 'stage.two']) doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'chapter', id, name: id });
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'story', id: 'story.harbor', name: '碧湖港', parentId: 'stage.one', patch: { keywords: ['碧湖港'] } });
  for (const [nodeId, parentNodeId] of [['arrival', undefined], ['permit', 'arrival']] as const) {
    doc = applyAuthorCommand(doc, { type: 'createNode', kind: 'story', treeId: 'story.harbor', nodeId, ...(parentNodeId ? { parentNodeId } : {}) });
    doc = applyAuthorCommand(doc, { type: 'editNode', nodeId, patch: { nodeName: nodeId, condition: `正文确认 ${nodeId}`, description: '给用户的话' } });
  }
  return doc;
}

test('story entry exists before achievements, is layout-only, and old author data is preserved', () => {
  let doc = createAuthorDocument('empty', '空树');
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'chapter', id: 'stage.one', name: '阶段一' });
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'story', id: 'story.empty', name: '碧湖港', parentId: 'stage.one' });
  const tree = doc.catalog.modules.adventure.storyTrees[0]!;
  assert.equal(tree.entryNodeId, 'story.empty.entry');
  assert.equal(tree.rootNodeId, undefined);
  assert.equal(authorNodes(doc).length, 0);
  assert.ok(doc.layouts.storyTrees[tree.storyTreeId]!.positions[tree.entryNodeId!]);
  assert.equal(validateContentCatalog(doc.catalog).ok, true);
  assert.equal(validateContentLayouts(doc.layouts, doc.catalog).ok, true);
  assert.deepEqual(authorDiagnostics(doc), []);
  const old = sample(), first = old.catalog.modules.adventure.storyTrees[0]!;
  delete old.layouts.storyTrees[first.storyTreeId]!.positions[first.entryNodeId!];
  old.layouts.storyTrees[first.storyTreeId]!.positions.arrival = { x: 60, y: 40 };
  delete first.entryNodeId; first.rootNodeId = 'arrival';
  const savedNodes = structuredClone(old.catalog.modules.adventure.nodes), converted = upgradeAuthorDocument(old);
  assert.deepEqual(converted.catalog.modules.adventure.nodes, savedNodes);
  const positions = old.layouts.storyTrees[first.storyTreeId]!.positions;
  assert.deepEqual(Object.fromEntries(Object.keys(positions).map(id => [id, converted.layouts.storyTrees[first.storyTreeId]!.positions[id]])), positions);
  const entryPoint = converted.layouts.storyTrees[first.storyTreeId]!.positions[converted.catalog.modules.adventure.storyTrees[0]!.entryNodeId!]!;
  assert.ok(entryPoint.x + 170 <= 60 || entryPoint.x >= 230 || entryPoint.y + 80 <= 40 || entryPoint.y >= 120, 'entry must not overlap the existing first achievement');
  assert.equal(converted.catalog.modules.adventure.storyTrees[0]!.rootNodeId, undefined);
  assert.equal(first.rootNodeId, 'arrival', 'conversion must not modify the source');
  const editor = new AuthorEditor({ ...old, revision: 'old-revision' });
  assert.equal(editor.dirty, true);
  assert.equal(editor.snapshot().revision, 'old-revision');
});

test('deleting a stage removes its trees and definitions, retains external references, and is fully undoable', () => {
  let doc = sample();
  doc = applyAuthorCommand(doc, { type: 'createEntity', kind: 'person', id: 'person.a', name: '人物' });
  doc = applyAuthorCommand(doc, { type: 'createNode', kind: 'person', treeId: 'person.a', nodeId: 'external' });
  doc = applyAuthorCommand(doc, { type: 'editNode', nodeId: 'external', patch: { nodeName: '外部节点', condition: '完成', dependencies: [{ nodeId: 'permit', kind: 'prerequisite' }] } });
  doc = applyAuthorCommand(doc, { type: 'choiceGroup', kind: 'story', treeId: 'story.harbor', id: 'choice.harbor', name: '路线' });
  doc = applyAuthorCommand(doc, { type: 'storyLine', treeId: 'story.harbor', id: 'line.harbor', name: '证明', endingNodeIds: ['permit'] });
  doc.manifest.migrations = [{ fromVersion: '0000', fromHash: 'a'.repeat(64), nodeIds: { arrival: 'arrival', permit: 'permit' }, chapterIds: { 'stage.one': 'stage.one' } }];
  const editor = new AuthorEditor({ ...doc, revision: 'r' }), before = editor.snapshot();
  editor.dispatch({ type: 'deleteEntity', kind: 'chapter', id: 'stage.one' });
  const deleted = editor.snapshot();
  assert.deepEqual(deleted.catalog.modules.adventure.chapters, [{ chapterId: 'stage.two', chapterName: 'stage.two', chapterNumber: 1 }]);
  assert.equal(deleted.catalog.modules.adventure.storyTrees.length, 0);
  assert.equal(deleted.catalog.modules.adventure.storyLines.length, 0);
  assert.equal(deleted.catalog.choiceGroups.length, 0);
  assert.deepEqual(authorNodes(deleted).map(node => node.nodeId), ['external']);
  assert.equal(authorNodes(deleted)[0]!.dependencies![0]!.nodeId, 'permit');
  assert.equal(deleted.layouts.storyTrees['story.harbor'], undefined);
  assert.equal(deleted.manifest.migrations![0]!.chapterIds!['stage.one'], null);
  assert.equal(deleted.manifest.migrations![0]!.nodeIds.permit, null);
  assert.ok(authorDiagnostics(deleted).some(issue => issue.code === 'UNKNOWN_REFERENCE'));
  editor.undo(); assert.deepEqual(editor.snapshot(), before);
  editor.redo(); assert.deepEqual(editor.snapshot(), deleted);
  const treeDeleted = applyAuthorCommand(doc, { type: 'deleteEntity', kind: 'story', id: 'story.harbor' });
  assert.equal(treeDeleted.catalog.modules.adventure.chapters.length, 2);
  assert.deepEqual(authorNodes(treeDeleted).map(node => node.nodeId), ['external']);
});

test('matching a v3 story sends the whole tree; result application still rejects missing prerequisites', () => {
  const doc = sample(), save = structuredClone(emptyAchievementSave);
  save.currentChapterId = 'stage.one';
  const context = { ...catalogModelContext(doc.catalog), currentChapterId: 'stage.one' };
  const input = { requestId: 'r', chatId: 'c', catalog: doc.catalog, save, allowedModules: ['adventure'] as const, selectedGroupIds: [], context, worldContext: [] };
  const request = (text = '抵达碧湖港') => buildChildApiRequest({ ...input, allowedModules: [...input.allowedModules], bodies: [{ turnIndex: 0, assistant: { id: 1, role: 'assistant', text } }] });
  assert.equal(getTaskNodeState(doc.catalog, save, 'arrival'), undefined);
  const sent = request();
  assert.deepEqual(sent.moduleContext[0]!.nodes.map(node => node.nodeId), ['arrival', 'permit']);
  assert.deepEqual(sent.moduleContext[0]!.nodes[1]!.prerequisiteNodeIds, ['arrival']);
  assert.equal(sent.moduleContext[0]!.nodes[1]!.externalPrerequisitesSatisfied, undefined);
  assert.deepEqual(sent.candidates.map(node => node.nodeId), ['arrival', 'permit']);
  assert.deepEqual(request('其他地点').moduleContext, []);
  const entryId = doc.catalog.modules.adventure.storyTrees[0]!.entryNodeId!;
  assert.ok(!buildPlayerView(doc.catalog, save).nodes.some(node => node.nodeId === entryId));
  assert.ok(buildPlayerView(doc.catalog, save).nodes.some(node => node.nodeId === 'arrival'));
  const apply = (nodeId: string) => applyChildApiResponseWithOutcome({ catalog: doc.catalog, save, now: '2026-10-11T00:00:00.000Z', requestContext: { requestId: 'r', chatId: 'c', stateRevision: save.revision, allowedModules: sent.allowedModules, activePersonIds: [], candidateNodeIds: { adventure: sent.candidates.map(node => node.nodeId) } }, response: { schemaVersion: 1, requestId: 'r', chatId: 'c', baseRevision: save.revision, judgementSummary: '达成', updates: [{ proposalId: 'p', type: 'unlockNode', module: 'adventure', nodeId }] } });
  assert.equal(apply('permit').acceptedProposalIds.length, 0);
  const accepted = apply('arrival');
  assert.deepEqual(accepted.acceptedProposalIds, ['p']);
  assert.ok(accepted.save.nodeProgress.arrival);
  assert.equal(accepted.save.nodeTasks.arrival, undefined);
  save.nodeProgress.arrival = accepted.save.nodeProgress.arrival!;
  assert.equal(request().moduleContext[0]!.nodes[0]!.status, 'unlocked');
  assert.equal(request().moduleContext[0]!.nodes.length, 2);
  context.currentChapterId = 'stage.two'; assert.deepEqual(request().moduleContext, []);
  context.currentChapterId = 'stage.one'; context.canSend.permit = false; assert.deepEqual(request().moduleContext, []);
});

test('explicit upgrade preserves completed story copy and archives former task records', () => {
  const doc = sample(), source = { manifest: doc.manifest, catalog: doc.catalog, packHash: 'a'.repeat(64) };
  const target = { manifest: { ...doc.manifest, packVersion: '0002', migrations: [{ fromVersion: '0001', fromHash: source.packHash, nodeIds: {} }] }, catalog: upgradeAuthorDocument(doc).catalog, packHash: 'b'.repeat(64) };
  const save = { ...structuredClone(emptyAchievementSave), packId: 'harbor', packVersion: '0001', packHash: source.packHash };
  save.nodeProgress.arrival = { status: 'unlocked', unlockedAt: '2026-10-11T00:00:00.000Z', sourceRefs: [], nodeNameOverride: '我起的名字', generatedCopy: { description: '私人记录' } };
  save.nodeTasks.permit = { acceptedAt: '2026-10-11T00:00:00.000Z', claimableAt: '2026-10-11T00:01:00.000Z', completionCopy: { description: '旧待领取文案' } };
  const before = structuredClone(save), migrated = migratePackSave(save, source, target, '2026-10-11T01:00:00.000Z');
  assert.deepEqual(migrated.save.nodeProgress.arrival, save.nodeProgress.arrival);
  assert.equal(migrated.save.nodeTasks.permit, undefined);
  assert.ok(migrated.save.orphanedProgress?.some(row => row.nodeId === 'permit' && row.task?.completionCopy?.description === '旧待领取文案'));
  assert.deepEqual(save, before);
});
