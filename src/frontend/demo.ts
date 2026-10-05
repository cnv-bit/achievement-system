import { applyPlayerCommand, buildPlayerView, emptyAchievementSave, exampleCatalog } from '../domain/index.ts';
import { bundledLayouts } from '../content/index.ts';
import { bundledContentImages } from '../content/images.ts';
import { buildJournalScene } from './view-scene.ts';
import { mountJournal } from './journal.ts';
import type { JournalPort } from './journal-port.ts';

// Isolated preview only: never accesses host storage, chat, APIs or live progress.
const catalog = exampleCatalog;
let save = structuredClone(emptyAchievementSave);
save.chapterProgress['chapter.2'] = {opened:true,completed:false};
const styles = {adventure:'story',bonds:'friend',careers:'career',abilities:'skill',knowledge:'knowledge',travel:'place'} as const;
for (const module of ['adventure','bonds','careers','abilities','knowledge','travel'] as const) {
  const nodes = module === 'travel' ? catalog.modules.travel.locations : catalog.modules[module].nodes;
  for (const node of nodes) {
    if (node.choiceGroupId || node.prerequisiteNodeIds?.length) continue;
    const cardId = `card.node.${node.nodeId}`;
    save.nodeProgress[node.nodeId] = {status:'unlocked',unlockedAt:'2026-10-01T00:00:00.000Z',sourceRefs:[],cardId};
    save.annotationCards[cardId] = {cardId,nodeId:node.nodeId,style:'nodeKind' in node && node.nodeKind==='combat' ? 'combat' : styles[module],text:'技术样例，正文与图片由内容侧填入。',sourceRefs:[]};
  }
}
save.journalEntries.push({journalId:'journal.preview',origin:'player',playerText:'这是独立预览，不修改聊天存档。',createdAt:'2026-10-01T00:00:00.000Z',sourceRefs:[]});
const port: JournalPort = {
  getPlayerView: () => buildPlayerView(catalog,save),
  getPlayerScene: module => buildJournalScene(buildPlayerView(catalog,save),bundledLayouts,module,name => bundledContentImages[name]),
  async dispatchPlayerCommand(command) {save=applyPlayerCommand(catalog,save,command);return buildPlayerView(catalog,save);},
};
const root=document.querySelector<HTMLElement>('#journal-root')!;
const reopen=document.querySelector<HTMLButtonElement>('#reopen')!;
let journal:ReturnType<typeof mountJournal>;
function open() {
  reopen.hidden=true;
  journal=mountJournal(root,port,{onClose:()=>{journal.destroy();reopen.hidden=false;reopen.focus();}});
}
reopen.addEventListener('click',open);
open();
