import type { AbilityNodeDefinition, BaseNodeDefinition } from './types.ts';

export const RESPONSE_UPDATE_RULE = '每次请求每个模块最多一条更新；怪物图鉴 combat 例外，可返回多个不同候选节点，不占用 abilities 技能的一条名额。怪物只返回 unlockNode、proposalId、module、nodeId，禁止 copy 和自报 nodeKind。';

export function isCombatNode(node: BaseNodeDefinition): node is Extract<AbilityNodeDefinition, { nodeKind: 'combat' }> {
    return 'nodeKind' in node && node.nodeKind === 'combat';
}
