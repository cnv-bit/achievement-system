import type { PlayerNodeView, RankBadgeKey } from '../domain/index.ts';
import { element, type JournalScene } from './journal-port.ts';

type MonsterEntry = NonNullable<JournalScene['groups']>[number];

// Compound names precede 金 so 白金 never takes the gold style.
const rankStyles = [['白金','platinum'],['白瓷','porcelain'],['黑曜','obsidian'],['钢铁','steel'],['翠玉','jade'],['红玉','ruby'],['青铜','bronze'],['白银','silver'],['金','gold']] as const;

function monsterRankKey(rank: string): RankBadgeKey | 'unknown' {
  return rankStyles.find(([name]) => rank.includes(name))?.[1] ?? 'unknown';
}

export function getMonsterRankClass(rank: string): string {
  return `is-rank-${monsterRankKey(rank)}`;
}

function monsterPortrait(doc: Document, entry: MonsterEntry) {
  const portrait = element(doc, 'div', 'journal-dossier-portrait');
  const placeholder = element(doc, 'span', 'journal-dossier-no-image', '立绘尚未收录');
  portrait.append(placeholder);
  if (entry.image) {
    const image = element(doc, 'img');
    image.src = entry.image.url;
    image.alt = entry.image.alt || entry.title;
    image.draggable = false;
    image.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; placeholder.textContent = '立绘载入失败'; });
    image.addEventListener('load', () => { placeholder.hidden = true; });
    portrait.append(image);
  }
  return portrait;
}

function rankArtwork(doc: Document, badge: HTMLElement, url: string) {
  const image = element(doc, 'img', 'journal-monster-rank-art');
  image.alt = ''; image.setAttribute('aria-hidden', 'true'); image.draggable = false;
  badge.classList.add('with-art');
  image.addEventListener('load', () => { image.hidden = false; badge.classList.add('has-art'); });
  image.addEventListener('error', () => {
    image.hidden = true; badge.classList.remove('has-art');
    console.warn('[goblin-achievements] 评级贴图载入失败，保留文字徽记：', url);
  });
  image.src = url;
  badge.prepend(image);
}

function monsterRankBadge(doc: Document, rankName: string, rankBadges: JournalScene['rankBadges']) {
  const key = monsterRankKey(rankName);
  const badge = element(doc, 'span', `journal-monster-rank is-rank-${key}`);
  badge.setAttribute('aria-label', `建议讨伐等级：${rankName}`);
  badge.title = '建议讨伐等级';
  badge.append(element(doc, 'span', 'journal-monster-rank-label', `✦ ${rankName}`));
  const artwork = key === 'unknown' ? undefined : rankBadges?.[key];
  if (artwork) rankArtwork(doc, badge, artwork.url);
  return badge;
}

function monsterIdentity(doc: Document, entry: MonsterEntry, rankBadges: JournalScene['rankBadges']) {
  const identity = element(doc, 'header', 'journal-dossier-identity');
  const heading = element(doc, 'div', 'journal-monster-header');
  heading.append(element(doc, 'h3', 'journal-dossier-name', entry.title));
  if (entry.recommendedRank) heading.append(monsterRankBadge(doc, entry.recommendedRank, rankBadges));
  identity.append(heading);
  if (entry.aliases?.length) identity.append(element(doc, 'p', 'journal-dossier-aliases', `又称 · ${entry.aliases.join('、')}`));
  if (entry.tags?.length) {
    const tags = element(doc, 'ul', 'journal-dossier-tags');
    tags.setAttribute('aria-label', '分类标签');
    entry.tags.forEach(tag => tags.append(element(doc, 'li', '', tag)));
    identity.append(tags);
  }
  return identity;
}

/** No duplicated state: artwork/prose come from the pack, progress from the player view. */
export function buildMonsterDossier(doc: Document, entry: MonsterEntry, nodes: PlayerNodeView[], rankBadges?: JournalScene['rankBadges']) {
  const archive = element(doc, 'aside', 'journal-monster-dossier');
  archive.setAttribute('aria-label', `${entry.title}的怪物档案`);
  archive.append(element(doc, 'p', 'journal-dossier-eyebrow', '旅途志异 · 生灵档案'), monsterPortrait(doc, entry), monsterIdentity(doc, entry, rankBadges));
  const root = nodes.find(node => node.nodeId === entry.rootNodeId);
  archive.append(element(doc, 'p', 'journal-dossier-note journal-handwritten', root?.description ?? '这页见闻尚未写下。'));
  const completed = nodes.filter(node => node.unlocked).length;
  const full = nodes.length > 0 && completed === nodes.length;
  const badge = element(doc, 'p', 'journal-dossier-progress', full ? `✦ 全部记录已达成 · ${completed} / ${nodes.length}` : `✦ 达成进度 · ${completed} / ${nodes.length}`);
  badge.dataset.complete = String(full);
  badge.setAttribute('role', 'status');
  archive.append(badge);
  return archive;
}
