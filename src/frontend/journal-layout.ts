import type { PlayerNodeView } from '../domain/index.ts';
import type { JournalScene } from './journal-port.ts';

export interface JournalTreeView {
  id: string;
  title: string;
  nodes: PlayerNodeView[];
  image?: {url:string;alt:string};
}

export interface AbilityOwnerView {
  id: string;
  title: string;
  trees: JournalTreeView[];
  image?: {url:string;alt:string};
}

function visibleNodes(nodes: PlayerNodeView[], nodeIds: string[]): PlayerNodeView[] {
  const allowed = new Set(nodeIds);
  return nodes.filter(node => allowed.has(node.nodeId));
}

export function buildAbilityOwnerViews(nodes: PlayerNodeView[], scene: JournalScene): AbilityOwnerView[] {
  return (scene.abilityOwners ?? []).flatMap(owner => {
    const ownerNodes = visibleNodes(nodes, owner.nodeIds);
    if (!ownerNodes.length) return [];

    const trees: JournalTreeView[] = owner.trees.map(tree => ({
      id: tree.id,
      title: tree.title,
      nodes: visibleNodes(ownerNodes, tree.nodeIds),
    })).filter(tree => tree.nodes.length);

    return [{ id: owner.id, title: owner.title, trees, ...(owner.image ? {image:owner.image} : {}) }];
  });
}

export function buildKnowledgeTreeViews(nodes: PlayerNodeView[], scene: JournalScene): JournalTreeView[] {
  const trees = (scene.groups ?? []).flatMap(group => {
    const groupNodes = visibleNodes(nodes, group.nodeIds);
    return groupNodes.length ? [{ id: group.id, title: group.title, nodes: groupNodes }] : [];
  });
  return trees;
}

function buildGroupedTreeViews(nodes: PlayerNodeView[], scene: JournalScene, kind: string): JournalTreeView[] {
  return (scene.groups ?? [])
    .filter(group => group.kind === kind)
    .flatMap(group => {
      const groupNodes = visibleNodes(nodes, group.nodeIds);
      return groupNodes.length ? [{ id: group.id, title: group.title, nodes: groupNodes, ...(group.image ? {image:group.image} : {}) }] : [];
    });
}

export function buildBondPersonViews(nodes: PlayerNodeView[], scene: JournalScene): JournalTreeView[] {
  return buildGroupedTreeViews(nodes, scene, 'person');
}

export function buildCareerTreeViews(nodes: PlayerNodeView[], scene: JournalScene): JournalTreeView[] {
  return buildGroupedTreeViews(nodes, scene, 'careerTree');
}
