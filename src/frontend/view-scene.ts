import { rankBadgeKeys, type AchievementPlayerView, type ContentLayouts, type ContentModule, type ContentPackTheme, type ImageReference } from '../domain/index.ts';
import type { JournalScene } from './journal-port.ts';

/** Host returns a URL only after confirming the file exists; undefined keeps a blank. */
export type ImageResolver = (assetRefOrLegacyName: string) => string | undefined;

export function buildJournalScene(view: AchievementPlayerView, layouts: ContentLayouts, module: ContentModule, resolveImage?: ImageResolver, theme?: ContentPackTheme): JournalScene {
  const nodes = view.nodes.filter(n => n.module === module);
  const ids = new Set(nodes.map(n => n.nodeId));
  const groups = view.groups.filter(g => g.module === module);
  const nodeById = new Map(nodes.map(n => [n.nodeId, n]));
  const scene: JournalScene = { positions: {}, edges: view.edges.filter(e => e.module === module && ids.has(e.from) && ids.has(e.to)).map(e => ({from:e.from,to:e.to,
    ...(nodeById.get(e.to)?.module === 'abilities' && 'combatTreeId' in nodeById.get(e.to)! ? {routing: 'orthogonal' as const, completed: Boolean(nodeById.get(e.from)?.unlocked && nodeById.get(e.to)?.unlocked)} : {}),
  })),
    groups: [], treeBounds: {}, images: {}, backgrounds: [], chapters: [] };
  function picture(ref: ImageReference): { url: string; alt: string } | undefined {
    const key = ref.assetRef ?? ref.imageName;
    if (!key || !resolveImage) return undefined;
    const url = resolveImage(key);
    if (!url) return undefined;
    try {
      const protocol = new URL(url, 'https://local.invalid/').protocol;
      if (!['https:', 'http:', 'file:', 'blob:'].includes(protocol) && !(protocol === 'data:' && url.startsWith('data:image/'))) return undefined;
    }
    catch { return undefined; }
    return { url, alt: ref.imageAlt ?? '' };
  }
  for (const node of nodes) {
    const p = picture(node.card?.assetRef || node.card?.imageName ? node.card : node);
    if (p) scene.images![node.nodeId] = p;
  }
  const ownerGroups = groups.filter(g => g.kind === 'skillOwner');
  scene.abilityOwners = ownerGroups.map(owner => ({
    id: owner.groupId, title: owner.groupName, nodeIds: owner.nodeIds,
    trees: groups.filter(g=>g.kind==='skillTree'&&g.parentGroupId===owner.groupId).map(g=>({id:g.groupId,title:g.groupName,nodeIds:g.nodeIds})),
    ...(picture(owner) ? { image: picture(owner)! } : {}),
  }));
  if (module === 'abilities' && theme?.assets?.bestiaryBookCover) {
    const cover = picture({ assetRef: theme.assets.bestiaryBookCover, imageAlt: '怪物图鉴封面' });
    if (cover) scene.bestiaryBookCover = cover;
  }
  let width = 0, height = 0;
  if (module === 'abilities' && theme?.rankBadges) {
    scene.rankBadges = {};
    for (const key of rankBadgeKeys) {
      const assetRef = theme.rankBadges[key];
      if (!assetRef) continue;
      const badge = picture({ assetRef });
      if (badge) scene.rankBadges[key] = badge;
    }
  }
  const chapterOffsets = new Map<string, number>();
  if (module === 'adventure') for (const chapter of view.chapters) {
    const layout = layouts.chapters[chapter.chapterId];
    if (!layout) continue;
    chapterOffsets.set(chapter.chapterId,width);
    scene.chapters!.push({ ...chapter, x:width, width:layout.width });
    width += layout.width; height = Math.max(height,layout.height);
  }
  for (const group of groups) {
    if (['skillOwner','knowledgeDomain','travelRegion'].includes(group.kind)) continue;
    const section = group.kind==='storyTree' ? layouts.storyTrees : group.kind==='person' ? layouts.bondTrees :
      group.kind==='careerTree' ? layouts.careerTrees : group.kind==='skillTree' ? layouts.skillTrees :
      group.kind==='combatTree' ? layouts.combatTrees : group.kind==='knowledgeTopic' ? layouts.knowledgeTrees : layouts.maps;
    const layout = section[group.groupId];
    if (layout) {
      scene.edges = scene.edges.filter(edge => !(group.nodeIds.includes(edge.to) && layout.hiddenBranchNodeIds?.includes(edge.to)));
    }
    const parent = groups.find(g=>g.groupId===group.parentGroupId);
    const title = group.kind==='knowledgeTopic' && parent ? `${parent.groupName} · ${group.groupName}` : group.groupName;
    const groupImage = picture(group) ?? (group.kind === 'knowledgeTopic' && parent ? picture(parent) : undefined);
    scene.groups!.push({id:group.groupId,title,nodeIds:group.nodeIds,kind:group.kind,...(group.unlocked !== undefined ? {unlocked:group.unlocked} : {}),...(groupImage ? {image:groupImage} : {}),
      ...(group.rootNodeId ? {rootNodeId:group.rootNodeId} : {}), ...(group.aliases ? {aliases:[...group.aliases]} : {}), ...(group.tags ? {tags:[...group.tags]} : {}),
      ...(group.recommendedRank ? {recommendedRank:group.recommendedRank} : {}),
      ...(group.kind === 'combatTree' && layouts.combatTrees[group.groupId]?.startNewRow ? {startNewRow:true} : {}),
    });
    if (!layout) continue; // Missing positions are shown as a list by the canvas, never guessed.
    const independent = module==='careers'||module==='abilities'||module==='knowledge';
    let x=0,y=0;
    if (group.kind==='storyTree') {
      const story = layouts.storyTrees[group.groupId]!;
      const offset = chapterOffsets.get(story.chapterId);
      if (offset===undefined) continue;
      x=offset+story.x;y=story.y;
    } else if (!independent) {
      x=width; width+=layout.width; height=Math.max(height,layout.height);
    }
    scene.treeBounds![group.groupId]={width:layout.width,height:layout.height};
    for (const nodeId of group.nodeIds) {
      const point=layout.positions[nodeId];
      if(point&&ids.has(nodeId)) scene.positions[nodeId]={x:x+point.x,y:y+point.y};
    }
    scene.edges.push(...(layout.visualEdges ?? []).filter(edge => ids.has(edge.from) && ids.has(edge.to)).map(edge => ({ from: edge.from, to: edge.to,
      ...(edge.routing === 'orthogonal' ? { routing: 'orthogonal' as const } : {}), ...(edge.points ? { points: edge.points.map(point => ({ x: x + point.x, y: y + point.y })) } : {}) })));
    if (group.kind==='map') {
      const image=picture(layouts.maps[group.groupId]!);
      if(image) scene.backgrounds!.push({...image,x,y,width:layout.width,height:layout.height});
    }
  }
  if (module==='adventure'&&view.chapters.length<Object.keys(layouts.chapters).length&&width) {
    scene.fogBoundary={x:Math.max(0,width-120),width:Math.min(120,width),height};
    // Decoration inside the opened width; never adds future scroll space.
  }
  if (width&&height) scene.bounds={width,height};
  return scene;
}
