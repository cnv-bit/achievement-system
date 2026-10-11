import type { ContentModule, RankBadgeKey } from '../domain/index.ts';
import type { PlayerUseCases } from '../runtime/player-port.ts';

/** Presentation coordinates only. Relationships must be supplied by the data owner. */
export interface JournalScene {
  bounds?: { width: number; height: number };
  treeBounds?: Record<string, { width: number; height: number }>;
  chapters?: Array<{ chapterId: string; chapterName: string; chapterNumber: number; x: number; width: number }>;
  fogBoundary?: { x: number; width: number; height: number };
  backgrounds?: Array<{ url: string; alt: string; x: number; y: number; width: number; height: number }>;
  positions: Record<string, { x: number; y: number }>;
  edges: Array<{ from: string; to: string; completed?: boolean; routing?: 'orthogonal'; points?: Array<{ x: number; y: number }> }>;
  groups?: Array<{ id: string; title: string; nodeIds: string[]; kind?: string; unlocked?: boolean; rootNodeId?: string; aliases?: string[]; tags?: string[]; recommendedRank?: string; startNewRow?: boolean; image?: { url: string; alt: string } }>;
  abilityOwners?: Array<{
    id: string;
    title: string;
    nodeIds: string[];
    image?: { url: string; alt: string };
    trees: Array<{ id: string; title: string; nodeIds: string[] }>;
  }>;
  bestiaryBookCover?: { url: string; alt: string };
  rankBadges?: Partial<Record<RankBadgeKey, { url: string; alt: string }>>;
  images?: Record<string, { url: string; alt: string }>;
}

export interface JournalPort extends PlayerUseCases {
  getPlayerScene?(module: ContentModule): JournalScene;
  mountSettings?(container: HTMLElement): () => void;
  mountPrompting?(container: HTMLElement): () => void;
  mountVersions?(container: HTMLElement): () => void;
}

export interface JournalOptions {
  scene?(module: ContentModule): JournalScene;
  onClose?(): void;
}

export const sections = [
  ['adventure', '冒险与故事', '⌘', '沿着走过的路，翻阅故事。'],
  ['bonds', '人物与羁绊', '♧', '有些话，留在同行的那一天。'],
  ['careers', '职业与成长', '♜', '每一步，都有来处。'],
  ['abilities', '战斗与技艺', '⚔', '将一路学会的本领，记在这里。'],
  ['knowledge', '知识体系', '▤', '世界渐渐有了可以理解的纹理。'],
  ['travel', '旅行与探索', '◇', '走过的地方，会成为另一种故乡。'],
  ['journal', '随手日记', '✎', '也记下那些，算不上大事的时刻。'],
] as const;

export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text?: string) {
  const result = doc.createElement(tag);
  if (tag === 'img') {
    (result as HTMLImageElement).loading = 'lazy';
    (result as HTMLImageElement).decoding = 'async';
  }
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

export function button(doc: Document, label: string, action: () => void, className = '') {
  const result = element(doc, 'button', className, label);
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}
