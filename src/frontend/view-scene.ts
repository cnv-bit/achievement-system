import type { AchievementPlayerView, ContentLayouts, ContentModule, ImageReference } from '../domain/index.ts';
import type { JournalScene } from './journal-port.ts';

/** Host returns a URL only after confirming the file exists; undefined keeps a blank. */
export type ImageResolver = (imageName: string) => string | undefined;

export function buildJournalScene(view: AchievementPlayerView, layouts: ContentLayouts, module: ContentModule, resolveImage?: ImageResolver): JournalScene {
  const nodes = view.nodes.filter(n => n.module === module);
  const ids = new Set(nodes.map(n => n.nodeId));
  const groups = view.groups.filter(g => g.module === module);
  const scene: JournalScene = { positions: {}, edges: view.edges.filter(e => e.module === module && ids.has(e.from) && ids.has(e.to)).map(e => ({from:e.from,to:e.to})),
    groups: [], treeBounds: {}, images: {}, backgrounds: [], chapters: [] };
  function picture(ref: ImageReference): { url: string; alt: string } | undefined {
    if (!ref.imageName || !resolveImage) return undefined;
    const url = resolveImage(ref.imageName);
    if (!url) return undefined;
    try {
      const protocol = new URL(url, 'https://local.invalid/').protocol;
      if (!['https:', 'http:', 'file:', 'blob:'].includes(protocol) && !(protocol === 'data:' && url.startsWith('data:image/'))) return undefined;
    }
    catch { return undefined; }
    return { url, alt: ref.imageAlt ?? '' };
  }
  for (const node of nodes) {
    const p = picture(node.card?.imageName ? node.card : node);
    if (p) scene.images![node.nodeId] = p;
  }
  const ownerGroups = groups.filter(g => g.kind === 'skillOwner');
  scene.abilityOwners = ownerGroups.map(owner => ({
    id: owner.groupId, title: owner.groupName, nodeIds: owner.nodeIds,
    trees: groups.filter(g=>g.kind==='skillTree'&&g.parentGroupId===owner.groupId).map(g=>({id:g.groupId,title:g.groupName,nodeIds:g.nodeIds})),
    ...(picture(owner) ? { image: picture(owner)! } : {}),
  }));
  let width = 0, height = 0;
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
    const parent = groups.find(g=>g.groupId===group.parentGroupId);
    const title = group.kind==='knowledgeTopic' && parent ? `${parent.groupName} · ${group.groupName}` : group.groupName;
    const groupImage = picture(group);
    scene.groups!.push({id:group.groupId,title,nodeIds:group.nodeIds,kind:group.kind,...(groupImage ? {image:groupImage} : {})});
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
    if (group.kind==='map') {
      const image=picture(layouts.maps[group.groupId]!);
      if(image) scene.backgrounds!.push({...image,x,y,width:layout.width,height:layout.height});
    }
  }
  if (module==='adventure'&&view.chapters.length<5&&width) {
    scene.fogBoundary={x:Math.max(0,width-120),width:Math.min(120,width),height};
    // Decoration inside the opened width; never adds future scroll space.
  }
  if (width&&height) scene.bounds={width,height};
  return scene;
}
