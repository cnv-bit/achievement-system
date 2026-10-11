import type { AchievementSave } from './types.ts';

export const emptyAchievementSave: AchievementSave = {
    schemaVersion: 7, revision: 0, nodeProgress: {}, nodeTasks: {}, retractedNodeProgress: {}, annotationCards: {},
    journalEntries: [], manualCorrections: {}, chapterProgress: {}, processedThrough: {}, appliedRequestIds: [],
};
