import assert from 'node:assert/strict';
import test from 'node:test';

import { getCanvasWheelIntent, isCanvasPanButton } from '../src/frontend/canvas.ts';
import { buildAbilityOwnerViews, buildBondPersonViews, buildCareerTreeViews, buildKnowledgeTreeViews } from '../src/frontend/journal-layout.ts';
import type { PlayerNodeView } from '../src/domain/index.ts';
import type { JournalScene } from '../src/frontend/journal-port.ts';

const abilityNodes: PlayerNodeView[] = [
  { nodeId: 'ability.sword.guard', nodeName: '守势', unlocked: true, module: 'abilities', nodeKind: 'skill', skillTreeId: 'sword', skillOwnerId: 'actor.nameless' },
  { nodeId: 'ability.broom.solar-charge', nodeName: '日光充能', unlocked: true, module: 'abilities', nodeKind: 'skill', skillTreeId: 'mobility', skillOwnerId: 'actor.broom' },
];

test('builds one ability entry per visible owner and hides empty configured trees', () => {
  const scene: JournalScene = {
    positions: {},
    edges: [],
    abilityOwners: [
      {
        id: 'actor.nameless',
        title: '无名',
        nodeIds: ['ability.sword.guard'],
        trees: [
          { id: 'sword', title: '剑术', nodeIds: ['ability.sword.guard'] },
          { id: 'prayer', title: '祷告', nodeIds: [] },
        ],
      },
      {
        id: 'actor.broom',
        title: '飞行扫帚',
        nodeIds: ['ability.broom.solar-charge'],
        trees: [{ id: 'mobility', title: '飞行与魔力', nodeIds: ['ability.broom.solar-charge'] }],
      },
      {
        id: 'actor.hidden',
        title: '尚未相识的人',
        nodeIds: ['ability.hidden'],
        trees: [{ id: 'unknown', title: '未知', nodeIds: ['ability.hidden'] }],
      },
    ],
  };

  const owners = buildAbilityOwnerViews(abilityNodes, scene);

  assert.deepEqual(owners.map(owner => owner.title), ['无名', '飞行扫帚']);
  assert.deepEqual(owners[0]!.trees.map(tree => [tree.title, tree.nodes.map(node => node.nodeId)]), [
    ['剑术', ['ability.sword.guard']],
  ]);
});

test('groups visible knowledge nodes into independent domain trees without inventing groups for unassigned nodes', () => {
  const nodes: PlayerNodeView[] = [
    { nodeId: 'knowledge.demo-region.funeral', nodeName: '示例地区葬俗', unlocked: true, module: 'knowledge', knowledgeDomainId: 'folklore', knowledgeTopicId: 'funeral' },
    { nodeId: 'knowledge.loose-note', nodeName: '无归属见闻', unlocked: true, module: 'knowledge', knowledgeDomainId: 'other', knowledgeTopicId: 'loose' },
  ];
  const scene: JournalScene = {
    positions: {},
    edges: [],
    groups: [{ id: 'folklore', title: '民俗与信仰', nodeIds: ['knowledge.demo-region.funeral'] }],
  };

  const trees = buildKnowledgeTreeViews(nodes, scene);

  assert.deepEqual(trees.map(tree => [tree.title, tree.nodes.map(node => node.nodeId)]), [
    ['民俗与信仰', ['knowledge.demo-region.funeral']],
  ]);
});

test('plain wheel scrolls the page while Ctrl+wheel zooms the canvas', () => {
  assert.equal(getCanvasWheelIntent({ ctrlKey: false, deltaY: 120 }), 'scroll');
  assert.equal(getCanvasWheelIntent({ ctrlKey: true, deltaY: -120 }), 'zoom-in');
  assert.equal(getCanvasWheelIntent({ ctrlKey: true, deltaY: 120 }), 'zoom-out');
});

test('canvas panning starts only from the middle mouse button', () => {
  assert.equal(isCanvasPanButton(0), false);
  assert.equal(isCanvasPanButton(1), true);
  assert.equal(isCanvasPanButton(2), false);
});

test('builds one collapsed entry per visible career tree', () => {
  const nodes: PlayerNodeView[] = [
    { nodeId: 'career.mage.level-1', nodeName: '一级魔法师', unlocked: true, module: 'careers', careerTreeId: 'career.mage' },
    { nodeId: 'career.alchemist.level-1', nodeName: '一级炼金术士', unlocked: true, module: 'careers', careerTreeId: 'career.alchemist' },
  ];
  const scene: JournalScene = {
    positions: {},
    edges: [],
    groups: [
      { id: 'career.mage', title: '魔法师', kind: 'careerTree', nodeIds: ['career.mage.level-1'] },
      { id: 'career.alchemist', title: '炼金术士', kind: 'careerTree', nodeIds: ['career.alchemist.level-1'] },
      { id: 'story.other', title: '无关分组', kind: 'storyTree', nodeIds: [] },
    ],
  };

  const trees = buildCareerTreeViews(nodes, scene);

  assert.deepEqual(trees.map(tree => [tree.id, tree.title, tree.nodes.map(node => node.nodeId)]), [
    ['career.mage', '魔法师', ['career.mage.level-1']],
    ['career.alchemist', '炼金术士', ['career.alchemist.level-1']],
  ]);
});

test('builds one entry per visible bond person and ignores other group kinds', () => {
  const nodes: PlayerNodeView[] = [
    { nodeId: 'bond.demo.met', nodeName: '钟声初遇', unlocked: true, module: 'bonds', personId: 'person.demo' },
  ];
  const scene: JournalScene = {
    positions: {}, edges: [], groups: [
      {
        id: 'person.demo',
        title: '示例人物',
        kind: 'person',
        nodeIds: ['bond.demo.met'],
        image: { url: 'data:image/webp;base64,demo', alt: '示例人物在钟表工坊前的半身插画' },
      },
      { id: 'career.mage', title: '魔法师', kind: 'careerTree', nodeIds: [] },
    ],
  };

  assert.deepEqual(buildBondPersonViews(nodes, scene).map(person => [person.id, person.title, person.image]), [
    ['person.demo', '示例人物', { url: 'data:image/webp;base64,demo', alt: '示例人物在钟表工坊前的半身插画' }],
  ]);
});
