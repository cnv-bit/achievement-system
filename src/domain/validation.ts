import { ANNOTATION_CARD_STYLES, CONTENT_MODULES } from './types.ts';
import type {
    AchievementSave, BaseNodeDefinition, ChildApiResponse, ContentCatalog, ContentLayouts, ContentModule,
    NodeModule, ResponseValidationContext, ValidationIssue, ValidationResult,
} from './types.ts';

type UnknownRecord = Record<string, unknown>;
const NODE_MODULES = CONTENT_MODULES.filter((module): module is NodeModule => module !== 'journal');
const MAX_STORED_TEXT_LENGTH = 10_000;
function isRecord(input: unknown): input is UnknownRecord {
    return typeof input === 'object' && input !== null && !Array.isArray(input);
}
function addIssue(issues: ValidationIssue[], path: string, code: ValidationIssue['code'], message: string): void {
    issues.push({ path, code, message });
}
function requireRecord(input: unknown, path: string, issues: ValidationIssue[]): UnknownRecord | undefined {
    if (isRecord(input)) return input;
    addIssue(issues, path, 'INVALID_TYPE', '必须是对象');
}
function requireArray(input: unknown, path: string, issues: ValidationIssue[]): unknown[] | undefined {
    if (Array.isArray(input)) return input;
    addIssue(issues, path, 'INVALID_TYPE', '必须是数组');
}
function requireString(input: unknown, path: string, issues: ValidationIssue[]): input is string {
    if (typeof input === 'string' && input.trim() && !['__proto__', 'constructor', 'prototype'].includes(input)) return true;
    addIssue(issues, path, 'INVALID_VALUE', '必须是非空字符串，不能使用保留键');
    return false;
}
function requireBoundedString(input: unknown, path: string, max: number, issues: ValidationIssue[]): void {
    if (requireString(input, path, issues) && input.length > max) addIssue(issues, path, 'INVALID_VALUE', '文字超过长度上限');
}
function requireInteger(input: unknown, path: string, issues: ValidationIssue[]): boolean {
    if (Number.isInteger(input) && Number(input) >= 0) return true;
    addIssue(issues, path, 'INVALID_VALUE', '必须是非负整数');
    return false;
}
function requireStringArray(input: unknown, path: string, issues: ValidationIssue[]): input is string[] {
    if (!Array.isArray(input)) { addIssue(issues, path, 'INVALID_TYPE', '必须是数组'); return false; }
    input.forEach((value, i) => requireString(value, `${path}[${i}]`, issues));
    validateUniqueStrings(input.filter((value): value is string => typeof value === 'string'), path, issues);
    return input.every(value => typeof value === 'string');
}
function rejectUnknownFields(record: UnknownRecord, allowed: string[], path: string, issues: ValidationIssue[]): void {
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key)) addIssue(issues, `${path}.${key}`, 'UNKNOWN_FIELD', '字段不在契约中');
    }
}
function validationResult<T>(input: unknown, issues: ValidationIssue[]): ValidationResult<T> {
    return issues.length ? { ok: false, issues } : { ok: true, value: input as T };
}
function validateUniqueStrings(values: string[], path: string, issues: ValidationIssue[]): void {
    const seen = new Set<string>();
    for (const value of values) {
        if (seen.has(value)) addIssue(issues, path, 'DUPLICATE_ID', `重复 ID：${value}`);
        seen.add(value);
    }
}
function records(input: unknown, path: string, issues: ValidationIssue[]): UnknownRecord[] {
    if (!Array.isArray(input)) { addIssue(issues, path, 'INVALID_TYPE', '必须是数组'); return []; }
    return input.flatMap((item, i) => {
        const record = requireRecord(item, `${path}[${i}]`, issues);
        return record ? [record] : [];
    });
}
function entries(input: unknown, path: string, fields: string[], allowed: string[], issues: ValidationIssue[]): UnknownRecord[] {
    const items = records(input, path, issues);
    items.forEach((item, i) => {
        rejectUnknownFields(item, allowed, `${path}[${i}]`, issues);
        fields.forEach(field => requireString(item[field], `${path}[${i}].${field}`, issues));
    });
    validateUniqueStrings(items.flatMap(item => typeof item[fields[0]!] === 'string' ? [item[fields[0]!] as string] : []), path, issues);
    return items;
}
function reference(value: unknown, known: Set<unknown>, path: string, issues: ValidationIssue[]): void {
    if (!known.has(value)) addIssue(issues, path, 'UNKNOWN_REFERENCE', `未知引用：${String(value)}`);
}
function image(record: UnknownRecord, path: string, issues: ValidationIssue[]): void {
    if (record.imageName === undefined && record.imageAlt === undefined) return;
    requireBoundedString(record.imageName, `${path}.imageName`, 200, issues);
    requireBoundedString(record.imageAlt, `${path}.imageAlt`, 500, issues);
    if (typeof record.imageName === 'string' && (
        /[\\/\\\\:\x00-\x1f?#%]/.test(record.imageName) || record.imageName.includes('..') ||
        !/\.(png|jpe?g|webp|gif|avif)$/i.test(record.imageName)
    )) addIssue(issues, `${path}.imageName`, 'INVALID_VALUE', '必须是图片文件名，含扩展名，不含路径或网址');
}
const groups = [
    ['adventure', 'chapters', 'chapterId', 'chapterName', '', '', ['chapterNumber']],
    ['adventure', 'storyTrees', 'storyTreeId', 'storyTreeName', 'chapterId', 'chapterId', ['rootNodeId', 'keywords']],
    ['bonds', 'people', 'personId', 'personName', '', '', ['keywords', 'lorebookEntry', 'imageName', 'imageAlt']],
    ['careers', 'trees', 'careerTreeId', 'careerTreeName', '', '', ['keywords']],
    ['abilities', 'owners', 'skillOwnerId', 'skillOwnerName', '', '', ['imageName', 'imageAlt', 'revealNodeId']],
    ['abilities', 'skillTrees', 'skillTreeId', 'skillTreeName', 'skillOwnerId', 'skillOwnerId', ['keywords']],
    ['abilities', 'combatTrees', 'combatTreeId', 'combatTreeName', '', '', ['keywords']],
    ['knowledge', 'domains', 'knowledgeDomainId', 'knowledgeDomainName', '', '', []],
    ['knowledge', 'topics', 'knowledgeTopicId', 'knowledgeTopicName', 'knowledgeDomainId', 'knowledgeDomainId', ['keywords']],
    ['travel', 'maps', 'mapId', 'mapName', '', '', []],
    ['travel', 'regions', 'travelRegionId', 'travelRegionName', 'mapId', 'mapId', []],
] as const;
const nodeParents: Record<NodeModule, string> = {
    adventure: 'storyTreeId', bonds: 'personId', careers: 'careerTreeId',
    abilities: '', knowledge: 'knowledgeTopicId', travel: 'travelRegionId',
};

export function validateContentCatalog(input: unknown): ValidationResult<ContentCatalog> {
    const issues: ValidationIssue[] = [];
    const catalog = requireRecord(input, '$', issues);
    if (!catalog) return { ok: false, issues };
    rejectUnknownFields(catalog, ['schemaVersion', 'modules', 'choiceGroups'], '$', issues);
    if (catalog.schemaVersion !== 2) addIssue(issues, 'schemaVersion', 'INVALID_VALUE', '内容目录须为版本 2；旧地区层级需要人工指定大章');
    const modules = requireRecord(catalog.modules, 'modules', issues);
    if (!modules) return { ok: false, issues };
    rejectUnknownFields(modules, [...CONTENT_MODULES], 'modules', issues);
    const definitions = new Map<string, UnknownRecord>();
    for (const module of CONTENT_MODULES) {
        const record = requireRecord(modules[module], `modules.${module}`, issues);
        if (!record) continue;
        definitions.set(module, record);
        if (record.module !== module) addIssue(issues, `modules.${module}.module`, 'INVALID_VALUE', '模块标识不匹配');
        requireString(record.moduleName, `modules.${module}.moduleName`, issues);
        const fields: string[] = ['module', 'moduleName', ...groups.filter(g => g[0] === module).map(g => g[1])];
        if (module === 'adventure') fields.push('storyLines');
        fields.push(module === 'journal' ? 'maxEntryLength' : module === 'travel' ? 'locations' : 'nodes');
        rejectUnknownFields(record, fields, `modules.${module}`, issues);
    }
    const indexed = new Map<string, Set<unknown>>();
    const groupRows = new Map<string, UnknownRecord[]>();
    for (const [module, field, id, name, parent, , extras] of groups) {
        const path = `modules.${module}.${field}`;
        const rows = entries(definitions.get(module)?.[field], path, [id, name, ...(parent ? [parent] : [])], [id, name, ...(parent ? [parent] : []), ...extras], issues);
        groupRows.set(id, rows);
        indexed.set(id, new Set(rows.map(row => row[id])));
        if (id !== 'personId') rows.forEach((row, i) => {
            if (row.keywords !== undefined) requireStringArray(row.keywords, `${path}[${i}].keywords`, issues);
        });
        if (id === 'chapterId') {
            rows.forEach((row, i) => {
                if (!Number.isInteger(row.chapterNumber) || Number(row.chapterNumber) < 1 || Number(row.chapterNumber) > 5) addIssue(issues, `${path}[${i}].chapterNumber`, 'INVALID_VALUE', '大章编号为 1—5');
            });
            const numbers = rows.map(row => String(row.chapterNumber));
            validateUniqueStrings(numbers, path, issues);
            if (rows.length !== 5 || ![1,2,3,4,5].every(number => rows.some(row => row.chapterNumber === number))) addIssue(issues, path, 'INVALID_VALUE', '目录须定义完整的五个大章；未填剧情的大章可以只有名称');
        }
        if (id === 'personId') rows.forEach((row, i) => {
            requireStringArray(row.keywords, `${path}[${i}].keywords`, issues);
            image(row, `${path}[${i}]`, issues);
            if (row.lorebookEntry !== undefined) {
                const entry = requireRecord(row.lorebookEntry, `${path}[${i}].lorebookEntry`, issues);
                if (entry) {
                    rejectUnknownFields(entry, ['bookName', 'entryUid'], path, issues);
                    requireString(entry.bookName, path, issues);
                    requireInteger(entry.entryUid, path, issues);
                }
            }
        });
        if (id === 'skillOwnerId') rows.forEach((row, i) => image(row, `${path}[${i}]`, issues));
    }
    for (const [module, field, id, , parent, parentId] of groups) {
        if (parent) groupRows.get(id)?.forEach((row, i) => reference(row[parent], indexed.get(parentId) ?? new Set(), `modules.${module}.${field}[${i}].${parent}`, issues));
    }
    const allNodes: UnknownRecord[] = [];
    const nodeScope = new Map<unknown, string>();
    const nodeMap = new Map<unknown, UnknownRecord>();
    const taskNodeIds = new Set<unknown>();
    for (const module of NODE_MODULES) {
        const path = `modules.${module}.${module === 'travel' ? 'locations' : 'nodes'}`;
        const parent = nodeParents[module];
        const extra = module === 'adventure' ? ['chapterId'] : module === 'bonds' ? ['allowsMemento'] : module === 'travel' ? ['inputKeywords'] : module === 'abilities' ? ['nodeKind', 'skillTreeId', 'combatTreeId'] : [];
        const rows = entries(definitions.get(module)?.[module === 'travel' ? 'locations' : 'nodes'], path,
            ['nodeId', 'nodeName', 'condition', ...(parent ? [parent] : [])],
            ['nodeId', 'nodeName', 'condition', 'prerequisiteNodeIds', 'choiceGroupId', 'imageName', 'imageAlt', ...(parent ? [parent] : []), ...extra], issues);
        rows.forEach((row, i) => {
            const nodePath = `${path}[${i}]`;
            let parentField = parent;
            if (module === 'abilities') {
                parentField = row.nodeKind === 'skill' ? 'skillTreeId' : 'combatTreeId';
                if (row.nodeKind !== 'skill' && row.nodeKind !== 'combat') addIssue(issues, nodePath, 'INVALID_VALUE', '能力节点须明确 skill 或 combat');
                requireString(row[parentField], nodePath, issues);
                if (row[row.nodeKind === 'skill' ? 'combatTreeId' : 'skillTreeId'] !== undefined) addIssue(issues, nodePath, 'INVALID_VALUE', '节点只能归属一种树');
            }
            reference(row[parentField], indexed.get(parentField) ?? new Set(), `${nodePath}.${parentField}`, issues);
            if (module === 'adventure' && row.chapterId !== undefined) reference(row.chapterId, indexed.get('chapterId') ?? new Set(), `${nodePath}.chapterId`, issues);
            nodeScope.set(row.nodeId, `${module}:${String(row[parentField])}`);
            nodeMap.set(row.nodeId, row);
            if (module === 'careers' || module === 'knowledge' || (module === 'abilities' && row.nodeKind === 'skill')) taskNodeIds.add(row.nodeId);
            image(row, nodePath, issues);
            if (row.prerequisiteNodeIds !== undefined) requireStringArray(row.prerequisiteNodeIds, `${nodePath}.prerequisiteNodeIds`, issues);
            if (row.choiceGroupId !== undefined) requireString(row.choiceGroupId, `${nodePath}.choiceGroupId`, issues);
            if (module === 'travel') requireStringArray(row.inputKeywords, `${nodePath}.inputKeywords`, issues);
            if (row.allowsMemento !== undefined && typeof row.allowsMemento !== 'boolean') addIssue(issues, nodePath, 'INVALID_TYPE', 'allowsMemento 必须为布尔值');
        });
        allNodes.push(...rows);
    }
    validateUniqueStrings(allNodes.map(row => String(row.nodeId)), 'nodes', issues);
    for (const node of allNodes) {
        for (const id of Array.isArray(node.prerequisiteNodeIds) ? node.prerequisiteNodeIds : []) {
            reference(id, new Set(nodeMap.keys()), `nodes.${String(node.nodeId)}.prerequisiteNodeIds`, issues);
            if (nodeScope.get(id) !== nodeScope.get(node.nodeId) && !taskNodeIds.has(node.nodeId)) {
                addIssue(issues, 'prerequisiteNodeIds', 'INVALID_VALUE', '仅技能、知识和职业任务允许跨树前置');
            }
        }
    }
    groupRows.get('skillOwnerId')?.forEach((owner, i) => {
        if (owner.revealNodeId !== undefined) reference(owner.revealNodeId, new Set(nodeMap.keys()), `modules.abilities.owners[${i}].revealNodeId`, issues);
    });
    const visiting = new Set<unknown>(), visited = new Set<unknown>();
    const visit = (id: unknown): void => {
        if (visiting.has(id)) { addIssue(issues, 'prerequisiteNodeIds', 'INVALID_VALUE', '前置关系存在环'); return; }
        if (visited.has(id)) return;
        visiting.add(id);
        const deps = nodeMap.get(id)?.prerequisiteNodeIds;
        if (Array.isArray(deps)) deps.forEach(visit);
        visiting.delete(id); visited.add(id);
    };
    nodeMap.forEach((_, id) => visit(id));
    groupRows.get('storyTreeId')?.forEach(tree => {
        requireString(tree.rootNodeId, 'rootNodeId', issues);
        const root = nodeMap.get(tree.rootNodeId);
        if (!root || root.storyTreeId !== tree.storyTreeId) addIssue(issues, 'rootNodeId', 'UNKNOWN_REFERENCE', '树根必须是本剧情树的节点');
        if (Array.isArray(root?.prerequisiteNodeIds) && root.prerequisiteNodeIds.length) addIssue(issues, 'rootNodeId', 'INVALID_VALUE', '树根不能有前置');
        if (root?.choiceGroupId !== undefined) addIssue(issues, 'rootNodeId', 'INVALID_VALUE', '常显树根不能是互斥选择节点');
        const reachable = new Set([tree.rootNodeId]);
        let changed = true;
        while (changed) {
            changed = false;
            for (const node of allNodes.filter(n => n.storyTreeId === tree.storyTreeId)) {
                if (!reachable.has(node.nodeId) && Array.isArray(node.prerequisiteNodeIds) && node.prerequisiteNodeIds.some(id => reachable.has(id))) {
                    reachable.add(node.nodeId); changed = true;
                }
            }
        }
        if (allNodes.some(n => n.storyTreeId === tree.storyTreeId && !reachable.has(n.nodeId))) addIssue(issues, 'rootNodeId', 'INVALID_VALUE', '剧情节点必须沿前置链连接到本树树根');
    });
    const choices = entries(catalog.choiceGroups, 'choiceGroups', ['choiceGroupId', 'choiceGroupName', 'module'], ['choiceGroupId', 'choiceGroupName', 'module', 'storyTreeId', 'personId'], issues);
    choices.forEach(choice => {
        if (choice.module !== 'adventure' && choice.module !== 'bonds') addIssue(issues, 'choiceGroups.module', 'INVALID_VALUE', '互斥组只属于剧情或人物');
        const field = choice.module === 'adventure' ? 'storyTreeId' : 'personId';
        requireString(choice[field], 'choiceGroups', issues);
        reference(choice[field], indexed.get(field) ?? new Set(), 'choiceGroups', issues);
        if (choice[field === 'personId' ? 'storyTreeId' : 'personId'] !== undefined) addIssue(issues, 'choiceGroups', 'INVALID_VALUE', '互斥组只能有一个归属');
    });
    allNodes.filter(node => node.choiceGroupId !== undefined).forEach(node => {
        const choice = choices.find(item => item.choiceGroupId === node.choiceGroupId);
        const field = choice?.module === 'adventure' ? 'storyTreeId' : 'personId';
        if (!choice || node[field] !== choice[field]) addIssue(issues, 'choiceGroupId', 'UNKNOWN_REFERENCE', '选择节点和互斥组的归属不一致');
    });
    const lines = entries(definitions.get('adventure')?.storyLines, 'storyLines', ['storyLineId', 'storyLineName', 'storyTreeId'], ['storyLineId', 'storyLineName', 'storyTreeId', 'endingNodeIds'], issues);
    lines.forEach(line => {
        reference(line.storyTreeId, indexed.get('storyTreeId') ?? new Set(), 'storyLines', issues);
        if (requireStringArray(line.endingNodeIds, 'endingNodeIds', issues)) line.endingNodeIds.forEach(id => {
            if (nodeMap.get(id)?.storyTreeId !== line.storyTreeId) addIssue(issues, 'endingNodeIds', 'UNKNOWN_REFERENCE', '结局必须属于本剧情树');
        });
    });
    const max = definitions.get('journal')?.maxEntryLength;
    validateUniqueStrings([
        ...Array.from(groupRows.entries()).flatMap(([field,rows]) => rows.map(row => String(row[field]))),
        ...allNodes.map(row => String(row.nodeId)),
        ...choices.map(row => String(row.choiceGroupId)), ...lines.map(row => String(row.storyLineId)),
    ], 'catalog.ids', issues);
    if (!Number.isInteger(max) || Number(max) < 20) addIssue(issues, 'maxEntryLength', 'INVALID_VALUE', '日记上限须为至少 20 的整数');
    return validationResult<ContentCatalog>(input, issues);
}

export function validateContentLayouts(input: unknown, catalog: ContentCatalog): ValidationResult<ContentLayouts> {
    const issues: ValidationIssue[] = [];
    const layouts = requireRecord(input, '$', issues);
    if (!layouts) return { ok: false, issues };
    const fields = ['chapters', 'storyTrees', 'bondTrees', 'careerTrees', 'skillTrees', 'combatTrees', 'knowledgeTrees', 'maps'];
    rejectUnknownFields(layouts, ['schemaVersion', ...fields], '$', issues);
    if (layouts.schemaVersion !== 1) addIssue(issues, 'schemaVersion', 'INVALID_VALUE', '仅支持布局版本 1');
    const m = catalog.modules;
    const scopes: Record<string, Record<string, string[]>> = {
        chapters: Object.fromEntries(m.adventure.chapters.map(c => [c.chapterId, []])),
        storyTrees: Object.fromEntries(m.adventure.storyTrees.map(t => [t.storyTreeId, m.adventure.nodes.filter(n => n.storyTreeId === t.storyTreeId).map(n => n.nodeId)])),
        bondTrees: Object.fromEntries(m.bonds.people.map(p => [p.personId, m.bonds.nodes.filter(n => n.personId === p.personId).map(n => n.nodeId)])),
        careerTrees: Object.fromEntries(m.careers.trees.map(t => [t.careerTreeId, m.careers.nodes.filter(n => n.careerTreeId === t.careerTreeId).map(n => n.nodeId)])),
        skillTrees: Object.fromEntries(m.abilities.skillTrees.map(t => [t.skillTreeId, m.abilities.nodes.filter(n => n.nodeKind === 'skill' && n.skillTreeId === t.skillTreeId).map(n => n.nodeId)])),
        combatTrees: Object.fromEntries(m.abilities.combatTrees.map(t => [t.combatTreeId, m.abilities.nodes.filter(n => n.nodeKind === 'combat' && n.combatTreeId === t.combatTreeId).map(n => n.nodeId)])),
        knowledgeTrees: Object.fromEntries(m.knowledge.topics.map(t => [t.knowledgeTopicId, m.knowledge.nodes.filter(n => n.knowledgeTopicId === t.knowledgeTopicId).map(n => n.nodeId)])),
        maps: Object.fromEntries(m.travel.maps.map(t => [t.mapId, m.travel.locations.filter(n => m.travel.regions.find(r => r.travelRegionId === n.travelRegionId)?.mapId === t.mapId).map(n => n.nodeId)])),
    };
    const finite = (value: unknown, path: string, min: number): value is number => {
        if (typeof value === 'number' && Number.isFinite(value) && value >= min) return true;
        addIssue(issues, path, 'INVALID_VALUE', '必须是范围内的有限数值'); return false;
    };
    for (const field of fields) {
        const rows = requireRecord(layouts[field], field, issues);
        for (const [id, value] of Object.entries(rows ?? {})) {
            const path = `${field}.${id}`, row = requireRecord(value, path, issues);
            const allowedNodes = scopes[field]?.[id];
            if (!allowedNodes) addIssue(issues, path, 'UNKNOWN_REFERENCE', '未知布局归属');
            if (!row) continue;
            const extras = field === 'storyTrees' ? ['chapterId', 'x', 'y'] : field === 'maps' ? ['imageName', 'imageAlt'] : [];
            rejectUnknownFields(row, ['width', 'height', ...(field === 'chapters' ? [] : ['positions']), ...extras], path, issues);
            finite(row.width, path + '.width', 1); finite(row.height, path + '.height', 1);
            if (field === 'chapters') continue;
            if (field === 'maps') image(row, path, issues);
            if (field === 'storyTrees') {
                const tree = m.adventure.storyTrees.find(t => t.storyTreeId === id);
                if (row.chapterId !== tree?.chapterId) addIssue(issues, path, 'UNKNOWN_REFERENCE', '剧情树布局的大章归属不一致');
                finite(row.x, path + '.x', 0); finite(row.y, path + '.y', 0);
                const chapter = isRecord(layouts.chapters) ? layouts.chapters[String(row.chapterId)] : undefined;
                if (!isRecord(chapter) || (
                    typeof row.x === 'number' && typeof row.y === 'number' && typeof row.width === 'number' && typeof row.height === 'number' &&
                    typeof chapter.width === 'number' && typeof chapter.height === 'number' &&
                    (row.x + row.width > chapter.width || row.y + row.height > chapter.height)
                )) addIssue(issues, path, 'INVALID_VALUE', '剧情树须位于所属大章画布内');
            }
            const positions = requireRecord(row.positions, path + '.positions', issues);
            for (const [nodeId, pointValue] of Object.entries(positions ?? {})) {
                if (!allowedNodes?.includes(nodeId)) addIssue(issues, path, 'UNKNOWN_REFERENCE', '坐标节点必须属于本树或地图');
                const point = requireRecord(pointValue, path + '.positions.' + nodeId, issues);
                if (!point) continue;
                rejectUnknownFields(point, ['x', 'y'], path, issues);
                finite(point.x, path, 0); finite(point.y, path, 0);
                if (typeof point.x === 'number' && typeof point.y === 'number' && typeof row.width === 'number' && typeof row.height === 'number' &&
                    (point.x > row.width || point.y > row.height)) addIssue(issues, path, 'INVALID_VALUE', '节点坐标超出画布');
            }
        }
    }
    return validationResult<ContentLayouts>(input, issues);
}

function validateSourceRefs(input: unknown, path: string, issues: ValidationIssue[]): void {
    records(input, path, issues).forEach((ref, i) => {
        rejectUnknownFields(ref, ['messageId', 'contentVersion'], path, issues);
        requireString(ref.messageId, `${path}[${i}].messageId`, issues);
        requireString(ref.contentVersion, `${path}[${i}].contentVersion`, issues);
    });
}
function validateTextRecord(input: unknown, path: string, allowed: string[], issues: ValidationIssue[]): void {
    const record = requireRecord(input, path, issues);
    if (!record) return;
    rejectUnknownFields(record, allowed, path, issues);
    Object.entries(record).forEach(([field, text]) => requireBoundedString(text, `${path}.${field}`, MAX_STORED_TEXT_LENGTH, issues));
}
function validateJson(input: unknown): boolean {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return true;
    if (typeof input === 'number') return Number.isFinite(input);
    if (Array.isArray(input)) return input.every(validateJson);
    return isRecord(input) && Object.values(input).every(validateJson);
}
export function validateAchievementSave(input: unknown): ValidationResult<AchievementSave> {
    const issues: ValidationIssue[] = [];
    const save = requireRecord(input, '$', issues);
    if (!save) return { ok: false, issues };
    rejectUnknownFields(save, ['schemaVersion', 'revision', 'currentChapterId', 'nodeProgress', 'nodeTasks', 'annotationCards', 'journalEntries', 'manualCorrections', 'chapterProgress', 'retractedNodeProgress', 'processedThrough', 'appliedRequestIds', 'migrationBackup'], '$', issues);
    if (save.schemaVersion !== 6) addIssue(issues, 'schemaVersion', 'INVALID_VALUE', '仅支持存档版本 6');
    requireInteger(save.revision, 'revision', issues);
    if (save.currentChapterId !== undefined) requireString(save.currentChapterId, 'currentChapterId', issues);
    const active = requireRecord(save.nodeProgress, 'nodeProgress', issues);
    const tasks = requireRecord(save.nodeTasks, 'nodeTasks', issues);
    const archived = requireRecord(save.retractedNodeProgress, 'retractedNodeProgress', issues);
    const progress = { ...archived, ...active };
    for (const id of Object.keys(archived ?? {})) if (active?.[id]) addIssue(issues, id, 'INVALID_VALUE', '节点不能同时达成和暂存');
    for (const [nodeId, value] of Object.entries(tasks ?? {})) {
        const path = `nodeTasks.${nodeId}`, row = requireRecord(value, path, issues);
        requireString(nodeId, path, issues);
        if (!row) continue;
        rejectUnknownFields(row, ['acceptedAt', 'availabilityNotified', 'claimableAt', 'claimabilityNotified', 'completionCopy'], path, issues);
        if (active?.[nodeId]) addIssue(issues, path, 'INVALID_VALUE', '已完成节点不能保留任务接取状态');
        if (row.acceptedAt === undefined && row.availabilityNotified !== true && row.claimableAt === undefined) addIssue(issues, path, 'INVALID_VALUE', '空任务记录不得保存');
        for (const field of ['acceptedAt', 'claimableAt'] as const) {
            if (row[field] === undefined) continue;
            requireString(row[field], `${path}.${field}`, issues);
            if (typeof row[field] === 'string' && (Number.isNaN(Date.parse(row[field])) || new Date(row[field]).toISOString() !== row[field])) {
                addIssue(issues, `${path}.${field}`, 'INVALID_VALUE', '必须是 ISO 时间');
            }
        }
        if (row.availabilityNotified !== undefined && row.availabilityNotified !== true) addIssue(issues, `${path}.availabilityNotified`, 'INVALID_VALUE', '只能保存 true');
        if (row.claimabilityNotified !== undefined && row.claimabilityNotified !== true) addIssue(issues, `${path}.claimabilityNotified`, 'INVALID_VALUE', '只能保存 true');
        if (row.claimableAt !== undefined && row.acceptedAt === undefined) addIssue(issues, path, 'INVALID_VALUE', '待领取任务必须保留接取时间');
        if (row.claimabilityNotified !== undefined && row.claimableAt === undefined) addIssue(issues, path, 'INVALID_VALUE', '只有待领取任务可以保存领取提醒');
        if (row.completionCopy !== undefined) {
            validateTextRecord(row.completionCopy, `${path}.completionCopy`, ['description'], issues);
            if (row.claimableAt === undefined) addIssue(issues, path, 'INVALID_VALUE', '只有待领取任务可以保存完成文案');
        }
    }
    const cards = requireRecord(save.annotationCards, 'annotationCards', issues);
    for (const [nodeId, value] of Object.entries(progress ?? {})) {
        const path = `nodeProgress.${nodeId}`, row = requireRecord(value, path, issues);
        requireString(nodeId, path, issues);
        if (!row) continue;
        rejectUnknownFields(row, ['status', 'unlockedAt', 'sourceRefs', 'cardId', 'nodeNameOverride', 'generatedCopy'], path, issues);
        if (row.status !== 'unlocked') addIssue(issues, path, 'INVALID_VALUE', '仅保存达成节点');
        requireString(row.unlockedAt, path, issues);
        validateSourceRefs(row.sourceRefs, path, issues);
        if (row.nodeNameOverride !== undefined) requireBoundedString(row.nodeNameOverride, path, 200, issues);
        if (row.generatedCopy !== undefined) validateTextRecord(row.generatedCopy, path, ['description', 'memento'], issues);
        if (row.cardId !== undefined) {
            requireString(row.cardId, path, issues);
            const card = cards?.[String(row.cardId)];
            if (!isRecord(card) || card.nodeId !== nodeId) addIssue(issues, path, 'UNKNOWN_REFERENCE', '卡片必须存在并属于本节点');
        }
    }
    for (const [cardId, value] of Object.entries(cards ?? {})) {
        const path = `annotationCards.${cardId}`, card = requireRecord(value, path, issues);
        if (!card) continue;
        rejectUnknownFields(card, ['cardId', 'nodeId', 'style', 'text', 'textOverride', 'imageName', 'imageAlt', 'sourceRefs'], path, issues);
        requireString(card.cardId, path, issues); requireString(card.nodeId, path, issues);
        if (cardId !== card.cardId) addIssue(issues, path, 'INVALID_VALUE', '卡片键和 cardId 不一致');
        if (!(ANNOTATION_CARD_STYLES as readonly unknown[]).includes(card.style)) addIssue(issues, path, 'INVALID_VALUE', '未知卡片样式');
        requireBoundedString(card.text, path, 4000, issues);
        if (card.textOverride !== undefined) requireBoundedString(card.textOverride, path, 4000, issues);
        image(card, path, issues); validateSourceRefs(card.sourceRefs, path, issues);
    }
    entries(save.journalEntries, 'journalEntries', ['journalId', 'origin', 'createdAt'], ['journalId', 'origin', 'createdAt', 'sourceRefs', 'generatedText', 'playerText'], issues).forEach(entry => {
        if (entry.origin !== 'generated' && entry.origin !== 'player') addIssue(issues, 'journalEntries.origin', 'INVALID_VALUE', '未知日记来源');
        if (entry.origin === 'generated') requireString(entry.generatedText, 'generatedText', issues);
        if (entry.origin === 'player') {
            requireString(entry.playerText, 'playerText', issues);
            if (entry.generatedText !== undefined) addIssue(issues, 'generatedText', 'UNKNOWN_FIELD', '玩家日记不能有生成原文');
        }
        if (entry.playerText !== undefined) requireString(entry.playerText, 'playerText', issues);
        validateSourceRefs(entry.sourceRefs, 'sourceRefs', issues);
    });
    const corrections = requireRecord(save.manualCorrections, 'manualCorrections', issues);
    for (const [id, value] of Object.entries(corrections ?? {})) {
        requireString(id, 'manualCorrections', issues);
        const row = requireRecord(value, 'manualCorrections', issues);
        if (row) { rejectUnknownFields(row, ['rejectedSourceRefs'], 'manualCorrections', issues); validateSourceRefs(row.rejectedSourceRefs, 'rejectedSourceRefs', issues); }
    }
    const chapters = requireRecord(save.chapterProgress, 'chapterProgress', issues);
    Object.entries(chapters ?? {}).forEach(([id, value]) => {
        requireString(id, 'chapterProgress', issues);
        const row = requireRecord(value, 'chapterProgress', issues);
        if (row) {
            rejectUnknownFields(row, ['opened', 'completed'], 'chapterProgress', issues);
            if (typeof row.opened !== 'boolean' || typeof row.completed !== 'boolean' || (row.completed && !row.opened)) addIssue(issues, 'chapterProgress', 'INVALID_VALUE', '章节状态须为布尔值且完成章必须开放');
        }
    });
    const cursors = requireRecord(save.processedThrough, 'processedThrough', issues);
    Object.entries(cursors ?? {}).forEach(([module, value]) => {
        if (!(CONTENT_MODULES as readonly string[]).includes(module)) addIssue(issues, 'processedThrough', 'UNKNOWN_FIELD', '未知模块');
        const cursor = requireRecord(value, 'processedThrough', issues);
        if (cursor) { rejectUnknownFields(cursor, ['messageId', 'turnIndex'], 'processedThrough', issues); requireString(cursor.messageId, 'messageId', issues); requireInteger(cursor.turnIndex, 'turnIndex', issues); }
    });
    requireStringArray(save.appliedRequestIds, 'appliedRequestIds', issues);
    if (save.migrationBackup !== undefined && !validateJson(save.migrationBackup)) addIssue(issues, 'migrationBackup', 'INVALID_TYPE', '备份必须是 JSON 数据');
    return validationResult<AchievementSave>(input, issues);
}

export function loadAchievementSave(input: unknown, catalog?: ContentCatalog): ValidationResult<AchievementSave> {
    if (!isRecord(input) || input.schemaVersion === 6) return validateAchievementSave(input);
    if (input.schemaVersion === 5) {
        const migrated = structuredClone(input);
        migrated.schemaVersion = 6;
        return validateAchievementSave(migrated);
    }
    if (input.schemaVersion === 4) {
        const migrated = structuredClone(input);
        migrated.schemaVersion = 6;
        migrated.nodeTasks = {};
        return validateAchievementSave(migrated);
    }
    if (typeof input.schemaVersion !== 'number' || ![1, 2, 3].includes(input.schemaVersion)) return validateAchievementSave(input);
    if (!validateJson(input)) return { ok: false, issues: [{ path: '$', code: 'INVALID_TYPE', message: '旧存档必须是 JSON 数据' }] };
    const migrated = structuredClone(input);
    const issues: ValidationIssue[] = [];
    rejectUnknownFields(input, ['schemaVersion', 'revision', 'nodeProgress', 'annotationCards', 'journalEntries', 'manualCorrections', 'processedThrough', 'appliedRequestIds'], '$', issues);
    migrated.schemaVersion = 6;
    migrated.migrationBackup = structuredClone(input);
    migrated.chapterProgress = {};
    migrated.nodeTasks = {};
    migrated.retractedNodeProgress = {};
    migrated.manualCorrections = input.schemaVersion === 3 ? migrated.manualCorrections : {};
    if (input.schemaVersion === 1) migrated.annotationCards = {};
    const cards = requireRecord(migrated.annotationCards, 'annotationCards', issues);
    const progress = requireRecord(migrated.nodeProgress, 'nodeProgress', issues);
    const definitions = catalog ? CONTENT_MODULES.flatMap<BaseNodeDefinition>(module => module === 'journal' ? [] : module === 'travel' ? catalog.modules.travel.locations : catalog.modules[module].nodes) : [];
    const migrateSources = (row: UnknownRecord): void => {
        if (input.schemaVersion !== 1) return;
        if (requireStringArray(row.sourceMessageIds, 'sourceMessageIds', issues)) row.sourceRefs = row.sourceMessageIds.map(messageId => ({ messageId, contentVersion: 'legacy:unknown' }));
        delete row.sourceMessageIds;
    };
    for (const [nodeId, value] of Object.entries(progress ?? {})) {
        const row = requireRecord(value, `nodeProgress.${nodeId}`, issues);
        if (!row) continue;
        migrateSources(row);
        const oldCard = cards?.[String(row.annotationCardId)];
        if (row.presentation !== undefined) validateTextRecord(row.presentation, 'presentation', ['displayName', 'description', 'memento', 'comment'], issues);
        const presentation = isRecord(row.presentation) ? row.presentation : undefined;
        const overrides = isRecord(oldCard) && isRecord(oldCard.playerOverrides) ? oldCard.playerOverrides : undefined;
        const explicitNames = [overrides?.title, presentation?.displayName].filter((name): name is string => typeof name === 'string');
        if (new Set(explicitNames).size > 1) addIssue(issues, `nodeProgress.${nodeId}`, 'INVALID_VALUE', '旧玩家改名冲突，原存档未修改；请先核对');
        const definition = definitions.find(node => node.nodeId === nodeId);
        const cardName = isRecord(oldCard) && typeof oldCard.title === 'string' ? oldCard.title : undefined;
        if (cardName && !definition && !explicitNames.length) addIssue(issues, nodeId, 'UNKNOWN_REFERENCE', '旧卡片标题需要对应节点目录才能迁移');
        const distinctCardName = cardName && cardName !== definition?.nodeName ? cardName : undefined;
        row.nodeNameOverride = explicitNames[0] ?? distinctCardName;
        if (row.nodeNameOverride === undefined) delete row.nodeNameOverride;
        if (row.annotationCardId !== undefined) row.cardId = row.annotationCardId;
        if (isRecord(oldCard) && presentation) {
            const text = overrides?.text ?? presentation.memento ?? presentation.comment ?? presentation.description;
            if (text !== undefined) oldCard.migratedTextOverride = text;
        }
        if (row.annotationCardId === undefined && definition && cards) {
            const module = NODE_MODULES.find(id => (id === 'travel' ? catalog!.modules.travel.locations : catalog!.modules[id].nodes).some(node => node.nodeId === nodeId))!;
            const styles = {adventure:'story',bonds:'friend',careers:'career',abilities:'skill',knowledge:'knowledge',travel:'place'} as const;
            const cardId = `card.node.${nodeId}`;
            if (cards[cardId] !== undefined) {
                addIssue(issues, cardId, 'INVALID_VALUE', '旧卡片存在但未关联，需先核对；不覆盖玩家改写');
                continue;
            }
            const copy = isRecord(row.generatedCopy) ? row.generatedCopy : undefined;
            const textOverride = presentation?.memento ?? presentation?.comment ?? presentation?.description;
            cards[cardId] = {id:cardId,ownerRef:{type:'node',id:nodeId},title:definition.nodeName,
                style:module === 'abilities' && catalog!.modules.abilities.nodes.find(node=>node.nodeId===nodeId)?.nodeKind === 'combat' ? 'combat' : styles[module],
                text:copy?.memento ?? copy?.description ?? definition.condition,sourceRefs:row.sourceRefs,
                ...(textOverride !== undefined ? {migratedTextOverride:textOverride} : {})};
            row.cardId = cardId;
        }
        delete row.annotationCardId; delete row.presentation;
    }
    for (const [cardId, value] of Object.entries(cards ?? {})) {
        const card = requireRecord(value, `annotationCards.${cardId}`, issues);
        if (!card) continue;
        rejectUnknownFields(card, ['id','ownerRef','style','title','text','mediaRef','sourceRefs','playerOverrides','migratedTextOverride'], 'annotationCards', issues);
        if (card.id !== cardId) addIssue(issues, cardId, 'INVALID_VALUE', '旧卡片键和 ID 不一致');
        requireBoundedString(card.title, 'card.title', 200, issues);
        if (card.playerOverrides !== undefined) validateTextRecord(card.playerOverrides, 'playerOverrides', ['title','text'], issues);
        if (card.mediaRef !== undefined) {
            const media = requireRecord(card.mediaRef, 'mediaRef', issues);
            if (media) {
                rejectUnknownFields(media, ['id','alt'], 'mediaRef', issues);
                requireString(media.id, 'mediaRef.id', issues); requireString(media.alt, 'mediaRef.alt', issues);
            }
        }
        const owner = requireRecord(card.ownerRef, 'ownerRef', issues);
        if (owner?.type !== 'node') addIssue(issues, 'ownerRef', 'INVALID_VALUE', '旧卡片归属无效');
        const overrides = isRecord(card.playerOverrides) ? card.playerOverrides : undefined;
        const ownerId = String(owner?.id);
        if (!progress?.[ownerId] && typeof owner?.id === 'string') {
            const definition = definitions.find(node => node.nodeId === owner.id);
            const name = overrides?.title ?? (card.title !== definition?.nodeName ? card.title : undefined);
            const archive = migrated.retractedNodeProgress as UnknownRecord;
            if (archive[ownerId] !== undefined) addIssue(issues, ownerId, 'INVALID_VALUE', '旧节点存在多张暂存卡，需先核对');
            archive[ownerId] = {status:'unlocked',unlockedAt:'legacy:unknown',sourceRefs:card.sourceRefs,cardId,
                ...(name !== undefined ? {nodeNameOverride:name} : {})};
        }
        cards![cardId] = {
            cardId: card.id, nodeId: owner?.id, style: card.style, text: card.text, sourceRefs: card.sourceRefs,
            ...((card.migratedTextOverride ?? overrides?.text) !== undefined ? { textOverride: card.migratedTextOverride ?? overrides?.text } : {}),
        };
        // Legacy media IDs stay in migrationBackup until a host confirms their filenames.
    }
    for (const entry of records(migrated.journalEntries, 'journalEntries', issues)) {
        migrateSources(entry);
        if (input.schemaVersion === 1) entry.origin = 'generated';
        entry.journalId = entry.id; delete entry.id;
    }
    if (catalog) {
        for (const node of definitions.filter(node => progress?.[node.nodeId])) {
            if (node.prerequisiteNodeIds?.some(id => !progress?.[id])) addIssue(issues, node.nodeId, 'INVALID_VALUE', '旧达成记录缺少新目录要求的前置，需人工核对；不自动补亮或删除旧成就');
        }
        const reachedChapters = catalog.modules.adventure.nodes
            .filter(node => progress?.[node.nodeId])
            .map(node => catalog.modules.adventure.storyTrees.find(tree => tree.storyTreeId === node.storyTreeId)!.chapterId);
        const last = Math.max(1, ...catalog.modules.adventure.chapters.filter(c => reachedChapters.includes(c.chapterId)).map(c => c.chapterNumber));
        migrated.chapterProgress = Object.fromEntries(catalog.modules.adventure.chapters.filter(c => c.chapterNumber <= last).map(c => [c.chapterId, {opened:true,completed:false}]));
    }
    if (issues.length) return { ok: false, issues };
    return validateAchievementSave(migrated);
}

function validateResponseIdentity(response: UnknownRecord, context: ResponseValidationContext, issues: ValidationIssue[]): void {
    if (response.schemaVersion !== 1) addIssue(issues, 'schemaVersion', 'INVALID_VALUE', '仅支持版本 1');
    if (response.requestId !== context.requestId) addIssue(issues, 'requestId', 'REQUEST_MISMATCH', '响应不属于当前请求');
    if (response.chatId !== context.chatId) addIssue(issues, 'chatId', 'REQUEST_MISMATCH', '响应不属于当前聊天');
    if (response.baseRevision !== context.stateRevision) addIssue(issues, 'baseRevision', 'STALE_RESPONSE', '存档版本已变化');
    requireString(response.judgementSummary, 'judgementSummary', issues);
}

function validateProposalScope(update: UnknownRecord, index: number, context: ResponseValidationContext, issues: ValidationIssue[]): void {
    const path = `updates[${index}]`;
    if (!context.allowedModules.includes(update.module as ContentModule)) {
        addIssue(issues, `${path}.module`, 'MODULE_NOT_ALLOWED', '本次请求未授权更新该模块');
    }
    if (update.type !== 'unlockNode') return;
    const candidates = context.candidateNodeIds[update.module as NodeModule] ?? [];
    if (!candidates.includes(String(update.nodeId))) addIssue(issues, `${path}.nodeId`, 'NODE_NOT_CANDIDATE', '节点未随本次请求发送');
    if (update.module === 'bonds' && !context.activePersonIds.includes(String(update.personId))) {
        addIssue(issues, `${path}.personId`, 'PERSON_NOT_ACTIVE', '人物未在本次剧情范围双侧激活');
    }
}

function validateUnlockProposal(update: UnknownRecord, path: string, issues: ValidationIssue[]): void {
    const allowedFields = update.module === 'bonds'
        ? ['type', 'proposalId', 'module', 'nodeId', 'personId', 'copy']
        : ['type', 'proposalId', 'module', 'nodeId', 'copy'];
    rejectUnknownFields(update, allowedFields, path, issues);
    if (!NODE_MODULES.includes(update.module as NodeModule)) addIssue(issues, `${path}.module`, 'INVALID_VALUE', '解锁操作只适用于节点模块');
    requireString(update.nodeId, `${path}.nodeId`, issues);
    if (update.module === 'bonds') requireString(update.personId, `${path}.personId`, issues);
    const copyFields = update.module === 'bonds' ? ['description', 'memento'] : ['description'];
    if (update.copy !== undefined) validateTextRecord(update.copy, `${path}.copy`, copyFields, issues);
}

function validateJournalProposal(update: UnknownRecord, path: string, issues: ValidationIssue[]): void {
    rejectUnknownFields(update, ['type', 'proposalId', 'module', 'text'], path, issues);
    if (update.module !== 'journal') addIssue(issues, `${path}.module`, 'INVALID_VALUE', '日记追加操作必须属于 journal');
    requireString(update.text, `${path}.text`, issues);
}

function validateProposal(input: unknown, index: number, context: ResponseValidationContext, issues: ValidationIssue[]): UnknownRecord | undefined {
    const path = `updates[${index}]`;
    const update = requireRecord(input, path, issues);
    if (!update) return undefined;
    requireString(update.proposalId, `${path}.proposalId`, issues);
    if (update.type === 'unlockNode') validateUnlockProposal(update, path, issues);
    else if (update.type === 'appendJournalEntry') validateJournalProposal(update, path, issues);
    else addIssue(issues, `${path}.type`, 'INVALID_VALUE', '未知更新类型');
    validateProposalScope(update, index, context, issues);
    return update;
}

export function validateChildApiResponse(input: unknown, context: ResponseValidationContext): ValidationResult<ChildApiResponse> {
    const issues: ValidationIssue[] = [];
    const response = requireRecord(input, '$', issues);
    if (!response) return { ok: false, issues };
    rejectUnknownFields(response, ['schemaVersion', 'requestId', 'chatId', 'baseRevision', 'judgementSummary', 'updates'], '$', issues);
    validateResponseIdentity(response, context, issues);
    const updates = requireArray(response.updates, 'updates', issues) ?? [];
    const proposals = updates.flatMap((update, index): UnknownRecord[] => {
        const proposal = validateProposal(update, index, context, issues);
        return proposal ? [proposal] : [];
    });
    validateUniqueStrings(proposals.flatMap((proposal) => typeof proposal.proposalId === 'string' ? [proposal.proposalId] : []), 'updates.proposalId', issues);
    return validationResult<ChildApiResponse>(input, issues);
}
