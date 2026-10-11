import type { BaseNodeDefinition } from './types.ts';

/** One read path for old releases and typed author definitions. */
export function prerequisiteIds(node: BaseNodeDefinition): string[] {
  return Array.isArray(node.dependencies) ? node.dependencies.map(dependency => dependency.nodeId) : node.prerequisiteNodeIds ?? [];
}

export function branchParentId(node: BaseNodeDefinition): string | undefined {
  return Array.isArray(node.dependencies) ? node.dependencies.find(dependency => dependency && dependency.kind === 'branch')?.nodeId : undefined;
}

export function nodeTreeId(node: BaseNodeDefinition): string | undefined {
  for (const field of ['storyTreeId', 'personId', 'careerTreeId', 'skillTreeId', 'combatTreeId', 'knowledgeTopicId', 'travelRegionId'] as const) {
    if (field in node) return String((node as unknown as Record<string, unknown>)[field]);
  }
  return undefined;
}
