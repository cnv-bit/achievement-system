import type { AchievementSave } from './types.ts';
import { bundledCatalog } from '../content/index.ts';

export const exampleCatalog = bundledCatalog;
export const emptyAchievementSave: AchievementSave = {
  schemaVersion: 6, revision: 0, nodeProgress: {}, nodeTasks: {}, retractedNodeProgress: {}, annotationCards: {},
  journalEntries: [], manualCorrections: {}, chapterProgress: {}, processedThrough: {}, appliedRequestIds: [],
};
