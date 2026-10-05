export const CONTENT_MODULES = [
    'adventure',
    'bonds',
    'careers',
    'abilities',
    'knowledge',
    'travel',
    'journal',
] as const;

export type ContentModule = (typeof CONTENT_MODULES)[number];
export type NodeModule = Exclude<ContentModule, 'journal'>;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ImageReference {
    imageName?: string;
    imageAlt?: string;
}

export interface BaseNodeDefinition extends ImageReference {
    nodeId: string;
    nodeName: string;
    condition: string;
    prerequisiteNodeIds?: string[];
    choiceGroupId?: string;
}
export interface AdventureNodeDefinition extends BaseNodeDefinition { storyTreeId: string; chapterId?: string }
export interface BondNodeDefinition extends BaseNodeDefinition { personId: string; allowsMemento?: boolean }
export interface CareerNodeDefinition extends BaseNodeDefinition { careerTreeId: string }
export type AbilityNodeDefinition = BaseNodeDefinition & (
    | { nodeKind: 'skill'; skillTreeId: string }
    | { nodeKind: 'combat'; combatTreeId: string }
);
export interface KnowledgeNodeDefinition extends BaseNodeDefinition { knowledgeTopicId: string }
export interface TravelLocationDefinition extends BaseNodeDefinition { travelRegionId: string; inputKeywords: string[] }

export interface ChapterDefinition {
    chapterId: string;
    chapterName: string;
    chapterNumber: number;
}
export interface AdventureDefinition {
    module: 'adventure';
    moduleName: string;
    chapters: ChapterDefinition[];
    storyTrees: Array<{ storyTreeId: string; storyTreeName: string; chapterId: string; rootNodeId: string; keywords?: string[] }>;
    storyLines: Array<{ storyLineId: string; storyLineName: string; storyTreeId: string; endingNodeIds: string[] }>;
    nodes: AdventureNodeDefinition[];
}
export interface BondsDefinition {
    module: 'bonds';
    moduleName: string;
    people: Array<ImageReference & {
        personId: string;
        personName: string;
        keywords: string[];
        lorebookEntry?: { bookName: string; entryUid: number };
    }>;
    nodes: BondNodeDefinition[];
}
export interface CareersDefinition {
    module: 'careers';
    moduleName: string;
    trees: Array<{ careerTreeId: string; careerTreeName: string; keywords?: string[] }>;
    nodes: CareerNodeDefinition[];
}
export interface AbilitiesDefinition {
    module: 'abilities';
    moduleName: string;
    owners: Array<ImageReference & { skillOwnerId: string; skillOwnerName: string; revealNodeId?: string }>;
    skillTrees: Array<{ skillTreeId: string; skillTreeName: string; skillOwnerId: string; keywords?: string[] }>;
    combatTrees: Array<{ combatTreeId: string; combatTreeName: string; keywords?: string[] }>;
    nodes: AbilityNodeDefinition[];
}
export interface KnowledgeDefinition {
    module: 'knowledge';
    moduleName: string;
    domains: Array<{ knowledgeDomainId: string; knowledgeDomainName: string }>;
    topics: Array<{ knowledgeTopicId: string; knowledgeTopicName: string; knowledgeDomainId: string; keywords?: string[] }>;
    nodes: KnowledgeNodeDefinition[];
}
export interface TravelDefinition {
    module: 'travel';
    moduleName: string;
    maps: Array<{ mapId: string; mapName: string }>;
    regions: Array<{ travelRegionId: string; travelRegionName: string; mapId: string }>;
    locations: TravelLocationDefinition[];
}
export interface JournalDefinition { module: 'journal'; moduleName: string; maxEntryLength: number }

export type ChoiceGroupDefinition = {
    choiceGroupId: string;
    choiceGroupName: string;
} & (
    | { module: 'adventure'; storyTreeId: string }
    | { module: 'bonds'; personId: string }
);

export interface ContentCatalog {
    schemaVersion: 2;
    choiceGroups: ChoiceGroupDefinition[];
    modules: {
        adventure: AdventureDefinition;
        bonds: BondsDefinition;
        careers: CareersDefinition;
        abilities: AbilitiesDefinition;
        knowledge: KnowledgeDefinition;
        travel: TravelDefinition;
        journal: JournalDefinition;
    };
}

export interface TreeLayout {
    width: number;
    height: number;
    positions: Record<string, { x: number; y: number }>;
}
export interface ContentLayouts {
    schemaVersion: 1;
    chapters: Record<string, { width: number; height: number }>;
    storyTrees: Record<string, TreeLayout & { chapterId: string; x: number; y: number }>;
    bondTrees: Record<string, TreeLayout>;
    careerTrees: Record<string, TreeLayout>;
    skillTrees: Record<string, TreeLayout>;
    combatTrees: Record<string, TreeLayout>;
    knowledgeTrees: Record<string, TreeLayout>;
    maps: Record<string, TreeLayout & ImageReference>;
}
export interface GeneratedNodeCopy { description?: string; memento?: string }
export interface MessageEvidenceRef { messageId: string; contentVersion: string }
export interface ManualCorrection { rejectedSourceRefs: MessageEvidenceRef[] }
export const ANNOTATION_CARD_STYLES = ['story', 'friend', 'career', 'skill', 'combat', 'knowledge', 'place'] as const;
export type AnnotationCardStyle = (typeof ANNOTATION_CARD_STYLES)[number];
export interface AnnotationCard extends ImageReference {
    cardId: string;
    nodeId: string;
    style: AnnotationCardStyle;
    text: string;
    textOverride?: string;
    sourceRefs: MessageEvidenceRef[];
}
export interface NodeProgress {
    status: 'unlocked';
    unlockedAt: string;
    sourceRefs: MessageEvidenceRef[];
    cardId?: string;
    nodeNameOverride?: string;
    generatedCopy?: GeneratedNodeCopy;
}
export type TaskNodeState = 'blocked' | 'available' | 'active' | 'claimable' | 'completed';
export interface NodeTaskProgress {
    acceptedAt?: string;
    availabilityNotified?: true;
    claimableAt?: string;
    claimabilityNotified?: true;
    completionCopy?: GeneratedNodeCopy;
}
interface JournalEntryBase { journalId: string; createdAt: string; sourceRefs: MessageEvidenceRef[] }
export interface GeneratedJournalEntry extends JournalEntryBase {
    origin: 'generated';
    generatedText: string;
    playerText?: string;
}
export interface PlayerJournalEntry extends JournalEntryBase {
    origin: 'player';
    playerText: string;
}
export type JournalEntry = GeneratedJournalEntry | PlayerJournalEntry;
export interface MessageCursor { messageId: string; turnIndex: number }
export interface AchievementSave {
    schemaVersion: 6;
    revision: number;
    /** Explicit current stage; never inferred from the highest opened chapter. */
    currentChapterId?: string;
    nodeProgress: Record<string, NodeProgress>;
    /** Only task lifecycle facts and pending completion copy are stored; state is derived. */
    nodeTasks: Record<string, NodeTaskProgress>;
    /** Retracted progress retains player edits but grants no unlock or evidence. */
    retractedNodeProgress: Record<string, NodeProgress>;
    annotationCards: Record<string, AnnotationCard>;
    journalEntries: JournalEntry[];
    manualCorrections: Record<string, ManualCorrection>;
    chapterProgress: Record<string, { opened: boolean; completed: boolean }>;
    processedThrough: Partial<Record<ContentModule, MessageCursor>>;
    appliedRequestIds: string[];
    /** Original metadata retained for rollback; never included in player/model queries. */
    migrationBackup?: JsonValue;
}

export interface FilteredStoryMessage {
    id: string;
    role: 'user' | 'assistant';
    turnIndex: number;
    text: string;
}

export interface CandidateNode {
    module: NodeModule;
    nodeId: string;
    condition: string;
    prerequisiteIds: string[];
    personId?: string;
}

export interface ChildApiRequest {
    schemaVersion: 1;
    requestId: string;
    chatId: string;
    baseRevision: number;
    allowedModules: ContentModule[];
    storyMessages: FilteredStoryMessage[];
    worldContext: string[];
    variables: Record<string, JsonValue>;
    candidates: CandidateNode[];
    unlockedNodeIds: string[];
}

interface ProposalBase {
    proposalId: string;
}

interface UnlockNodeProposalBase extends ProposalBase {
    type: 'unlockNode';
    nodeId: string;
}

export type UnlockNodeProposal =
    | (UnlockNodeProposalBase & {
        module: 'bonds';
        personId: string;
        copy?: GeneratedNodeCopy;
    })
    | (UnlockNodeProposalBase & {
        module: Exclude<NodeModule, 'bonds'>;
        personId?: never;
        copy?: { description?: string; memento?: never };
    });

export type AppendJournalEntryProposal = ProposalBase & {
    type: 'appendJournalEntry';
    module: 'journal';
    text: string;
};

export type ChildApiProposal = UnlockNodeProposal | AppendJournalEntryProposal;

export interface ChildApiResponse {
    schemaVersion: 1;
    requestId: string;
    chatId: string;
    baseRevision: number;
    judgementSummary: string;
    updates: ChildApiProposal[];
}

export interface ResponseValidationContext {
    requestId: string;
    chatId: string;
    stateRevision: number;
    allowedModules: ContentModule[];
    candidateNodeIds: Partial<Record<NodeModule, string[]>>;
    activePersonIds: string[];
}

export type NodeInteractionIntent =
    | { type: 'peekNode'; nodeId: string }
    | { type: 'stopPeekingNode'; nodeId: string }
    | { type: 'pinNode'; nodeId: string }
    | { type: 'closeNode'; nodeId: string }
    | { type: 'openNodeEditor'; nodeId: string };

export interface ValidationIssue {
    path: string;
    code:
        | 'INVALID_TYPE'
        | 'INVALID_VALUE'
        | 'MISSING_FIELD'
        | 'UNKNOWN_FIELD'
        | 'DUPLICATE_ID'
        | 'UNKNOWN_REFERENCE'
        | 'REQUEST_MISMATCH'
        | 'STALE_RESPONSE'
        | 'MODULE_NOT_ALLOWED'
        | 'NODE_NOT_CANDIDATE'
        | 'PERSON_NOT_ACTIVE';
    message: string;
}

export type ValidationResult<T> =
    | { ok: true; value: T }
    | { ok: false; issues: ValidationIssue[] };
