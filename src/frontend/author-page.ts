import { authorEntities, authorKinds, authorNodes, branchDeletion, entityDeletion, entityAssetPath, invalidNodeReferences, treeLayout, type AuthorCommand, type AuthorKind } from '../domain/authoring.ts';
import { branchParentId, nodeTreeId } from '../domain/dependencies.ts';
import type { BaseNodeDefinition, ContentModule, TreeLayout } from '../domain/types.ts';
import type { AuthorDraft, AuthorPreflight, AuthorSession, AuthorStoragePort } from '../runtime/authoring.ts';
import { authorStyle } from './author-style.ts';

interface AuthorPageOptions {
  createSession(draft: AuthorDraft): AuthorSession;
  assetUrl(packId: string, ref: string, revision: string): string;
  onClose(): void;
}
export function mountAuthorPage(container: HTMLElement, storage: AuthorStoragePort, options: AuthorPageOptions): () => void {
  const doc = container.ownerDocument;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
    const item = doc.createElement(tag); item.textContent = text; return item;
  }
  function button(text: string, action: () => void): HTMLButtonElement {
    const item = el('button', text); item.type = 'button'; item.onclick = action; return item;
  }
  const root = el('section'); root.className = 'achievement-author';
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', '角色卡成就作者编辑器');
  const style = el('style'); style.textContent = authorStyle;
  const header = el('header'), title = el('h1', '成就系统 · 作者编辑器');
  const toolbar = el('div'); toolbar.className = 'author-toolbar';
  const body = el('div'); body.className = 'author-body';
  const navigation = el('nav'), content = el('main'), issues = el('div'), status = el('p');
  navigation.setAttribute('aria-label', '模块与实体'); issues.className = 'author-issues';
  status.className = 'author-status'; status.setAttribute('role', 'status');
  header.append(title, button('关闭', () => { if (discard()) options.onClose(); })); body.append(navigation, content);
  root.append(style, header, toolbar, status, body, issues); container.append(root);
  let session: AuthorSession | undefined, selected: { kind: AuthorKind; id: string } | undefined;
  let currentModule: ContentModule = 'adventure';
  let busy = false, alive = true, menu: HTMLElement | undefined, preflight: AuthorPreflight | undefined;
  function discard(): boolean { return !session?.dirty || (doc.defaultView?.confirm('有未保存的创作，仍要离开？') ?? false); }
  function message(text: string): void { status.textContent = text; }
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true; root.setAttribute('aria-busy', 'true');
    body.inert = true;
    toolbar.querySelectorAll('button').forEach(item => { item.disabled = true; });
    try { await action(); }
    catch (error) { if (alive) message(error instanceof Error ? error.message : String(error)); }
    finally { busy = false; body.inert = false; root.removeAttribute('aria-busy'); if (alive) toolbar.querySelectorAll('button').forEach(item => { item.disabled = false; }); }
  }
  function apply(command: AuthorCommand): void {
    if (!session || busy) return;
    session.dispatch(command); preflight = undefined; render(); message('有未保存的修改。');
  }
  function safe(action: () => void): void {
    try { action(); } catch (error) { message(error instanceof Error ? error.message : String(error)); }
  }
  function closeMenu(): void { menu?.remove(); menu = undefined; }
  function contextMenu(event: MouseEvent | KeyboardEvent, entries: Array<[string, () => void]>): void {
    event.preventDefault(); closeMenu();
    menu = el('div'); menu.className = 'author-menu'; menu.setAttribute('role', 'menu');
    const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : (event.target as HTMLElement).getBoundingClientRect();
    Object.assign(menu.style, { left: `${Math.max(0, Math.min(point.x, (doc.defaultView?.innerWidth ?? 800) - 200))}px`, top: `${Math.max(0, Math.min(point.y, (doc.defaultView?.innerHeight ?? 600) - entries.length * 40))}px` });
    for (const [name, action] of entries) { const item = button(name, () => { closeMenu(); safe(action); }); item.setAttribute('role', 'menuitem'); menu.append(item); }
    menu.onkeydown = key => {
      const buttons = [...menu!.querySelectorAll('button')], index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      if (key.key === 'ArrowDown' || key.key === 'ArrowUp') { key.preventDefault(); buttons[(index + (key.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus(); }
      if (key.key === 'Home' || key.key === 'End') { key.preventDefault(); (key.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus(); }
    };
    root.append(menu); menu.querySelector('button')?.focus();
  }
  function form(heading: string, build: (dialog: HTMLDialogElement) => () => void, readOnly = false): void {
    const dialog = el('dialog'), form = el('form'), error = el('p'); error.className = 'author-form-error';
    dialog.append(el('h2', heading), form); root.append(dialog);
    const previousFocus = doc.activeElement as HTMLElement | null;
    const save = build(dialog); const actions = el('div'); actions.className = 'author-form-actions';
    const close = () => { dialog.close(); dialog.remove(); previousFocus?.isConnected && previousFocus.focus(); };
    if (!readOnly) { const submit = el('button', '确认修改'); submit.type = 'submit'; actions.append(submit); }
    actions.append(button(readOnly ? '关闭' : '取消', close)); form.append(error, actions);
    form.onsubmit = event => { event.preventDefault(); try { if (busy) return; save(); close(); } catch (reason) { error.textContent = reason instanceof Error ? reason.message : String(reason); } };
    dialog.oncancel = event => { event.preventDefault(); close(); }; dialog.showModal();
  }
  function field(dialog: HTMLElement, name: string, value = '', multiline = false, readonly = false): HTMLInputElement | HTMLTextAreaElement {
    const label = el('label', name), input = multiline ? el('textarea') : el('input'); input.value = value; input.readOnly = readonly;
    label.append(input); dialog.querySelector('form')!.append(label); return input;
  }
  function select(dialog: HTMLElement, name: string, rows: Array<{ id: string; label: string }>, value = ''): HTMLSelectElement {
    const label = el('label', name), input = el('select');
    for (const row of rows) { const option = el('option', row.label); option.value = row.id; input.append(option); }
    input.value = rows.some(row => row.id === value) ? value : rows[0]?.id ?? ''; label.append(input); dialog.querySelector('form')!.append(label); return input;
  }
  function assetInfo(dialog: HTMLElement, path: string): void {
    field(dialog, '将图片按这个路径放入当前账号的草稿目录，再刷新资产', path, false, true);
    dialog.querySelector('form')!.append(button('复制图片路径', () => {
      const clipboard = doc.defaultView?.navigator.clipboard;
      if (!clipboard) { message('当前浏览器不提供剪贴板，请复制上方路径。'); return; }
      void clipboard.writeText(path).catch(error => message(`复制失败：${error.message}`));
    }));
  }
  function chooseDraft(draft: AuthorDraft): void {
    if (!alive) return; session = options.createSession(draft); selected = undefined; currentModule = 'adventure'; preflight = undefined; render();
    message(`已打开 ${draft.manifest.packName}；来源 ${draft.source?.packVersion ?? '新建'}。${session.dirty ? '已补充剧情树隐藏入口，请保存转换后的草稿。' : ''}`);
  }
  async function draftList(): Promise<void> {
    const list = await storage.list(); if (!alive) return;
    content.replaceChildren(el('h2', '账号中的创作草稿'));
    for (const item of list) content.append(button(`${item.packName} · ${item.packId}`, () => { if (discard()) void run(async () => chooseDraft(await storage.load(item.packId))); }));
    if (!list.length) content.append(el('p', '尚无草稿。新建卡带，或从本账号的发布版本复制。'));
  }
  function newPack(): void {
    if (!discard()) return;
    form('新建通用角色卡卡带', dialog => {
      const id = field(dialog, '包 ID（英文字母、数字、点和连字符）'), name = field(dialog, '名称');
      return () => { void run(async () => chooseDraft(await storage.create(id.value.trim(), name.value.trim()))); };
    });
  }
  function importPack(): void {
    if (!discard()) return;
    form('复制已发布内容为草稿', dialog => {
      const id = field(dialog, '本账号中的包 ID'), version = field(dialog, '来源版本（保留前导零）');
      dialog.querySelector('form')!.append(el('p', '已有草稿时会拒绝覆盖。旧版本的强父节点需逐个确认。'));
      return () => { void run(async () => chooseDraft(await storage.importRelease({ packId: id.value.trim(), packVersion: version.value.trim() }))); };
    });
  }
  function entityForm(kind: AuthorKind, id?: string): void {
    if (!session) return;
    const draft = session.snapshot(), spec = authorKinds[kind];
    const row = id ? authorEntities(draft, kind).find(row => row[spec.id] === id) : undefined;
    form(`${row ? '编辑' : '新建'}${spec.label}`, dialog => {
      const name = field(dialog, '名称', String(row?.[spec.name] ?? ''));
      const stable = id ?? `${kind}.${crypto.randomUUID()}`; field(dialog, '稳定 ID', stable, false, true);
      let parent: HTMLSelectElement | undefined;
      if ('parent' in spec) {
        const parentKind = kind === 'story' ? 'chapter' : kind === 'skill' ? 'owner' : 'domain';
        const parentSpec = authorKinds[parentKind];
        parent = select(dialog, `归属${parentSpec.label}`, authorEntities(draft, parentKind).map(item => ({ id: String(item[parentSpec.id]), label: String(item[parentSpec.name]) })), String(row?.[spec.parent] ?? (selected?.kind === parentKind ? selected.id : '')));
        if (row) parent.disabled = true;
      }
      const keywords = ['person', 'story', 'monster'].includes(kind) ? field(dialog, '整树触发关键词（每行一个）', ((row?.keywords as string[] | undefined) ?? []).join('\n'), true) : undefined;
      if (keywords) dialog.querySelector('form')!.append(el('p', kind === 'story' ? '命中任一关键词后，发送当前阶段的整棵剧情树；各成就没有独立触发词。可填写普通词或 /正则/flags。' : '命中任一关键词后筛选相关内容，可填写普通词或 /正则/flags。'));
      const aliases = kind === 'monster' ? field(dialog, '别名（每行一个）', ((row?.aliases as string[] | undefined) ?? []).join('\n'), true) : undefined;
      const tags = kind === 'monster' ? field(dialog, '标签（每行一个）', ((row?.tags as string[] | undefined) ?? []).join('\n'), true) : undefined;
      const rank = kind === 'monster' ? field(dialog, '建议评级（可空）', String(row?.recommendedRank ?? '')) : undefined;
      const rootNode = row && kind === 'monster' ? select(dialog, '初见成就', [{ id: '', label: '尚未创建首节点' }, ...authorNodes(draft).filter(node => nodeTreeId(node) === id).map(node => ({ id: node.nodeId, label: node.nodeName || node.nodeId }))], String(row.rootNodeId ?? '')) : undefined;
      const reveal = kind === 'owner' ? select(dialog, '入口解锁节点（可空）', [{ id: '', label: '始终开放' }, ...authorNodes(draft).map(node => ({ id: node.nodeId, label: `${node.nodeName} · ${node.nodeId}` }))], String(row?.revealNodeId ?? '')) : undefined;
      const book = kind === 'person' ? field(dialog, '可选世界书名称', String((row?.lorebookEntry as { bookName?: string } | undefined)?.bookName ?? '')) : undefined;
      const entry = kind === 'person' ? field(dialog, '可选世界书条目 UID', String((row?.lorebookEntry as { entryUid?: number } | undefined)?.entryUid ?? '')) : undefined;
      const alt = kind !== 'chapter' ? field(dialog, '图片说明（可留空）', String(row?.imageAlt ?? '')) : undefined;
      if (kind !== 'chapter') assetInfo(dialog, entityAssetPath(kind, stable));
      return () => {
        const patch: Record<string, unknown> = { [spec.name]: name.value.trim() };
        const lines = (input: HTMLInputElement | HTMLTextAreaElement) => [...new Set(input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
        if (keywords) patch.keywords = lines(keywords);
        if (aliases) patch.aliases = lines(aliases); if (tags) patch.tags = lines(tags);
        if (rank) patch.recommendedRank = rank.value.trim() || undefined;
        if (rootNode) patch.rootNodeId = rootNode.value;
        if (reveal) patch.revealNodeId = reveal.value || undefined;
        if (book) patch.lorebookEntry = book.value.trim() ? { bookName: book.value.trim(), entryUid: Number(entry?.value) } : undefined;
        if (alt && (alt.value.trim() || row?.assetRef || row?.imageName)) patch.imageAlt = alt.value.trim() || name.value.trim();
        const initialNodeId = kind === 'monster' && !id ? `node.${crypto.randomUUID()}` : undefined;
        session!.dispatch(id ? { type: 'editEntity', kind, id, patch } : { type: 'createEntity', kind, id: stable, name: name.value.trim(), patch, ...(parent ? { parentId: parent.value } : {}), ...(initialNodeId ? { initialNodeId } : {}) });
        selected = { kind, id: stable }; currentModule = spec.module; preflight = undefined; render(); message('内容已加入工作副本，尚未保存。');
        if (initialNodeId) nodeForm(initialNodeId);
      };
    });
  }
  function createNode(kind: AuthorKind, treeId: string, parentNodeId?: string): void {
    const nodeId = `node.${crypto.randomUUID()}`;
    apply({ type: 'createNode', kind, treeId, nodeId, ...(parentNodeId ? { parentNodeId } : {}) }); nodeForm(nodeId);
  }
  function nodeForm(nodeId: string, readOnly = false): void {
    if (!session) return;
    const draft = session.snapshot(), nodes = authorNodes(draft), node = nodes.find(node => node.nodeId === nodeId);
    if (!node) return;
    const kind = (Object.keys(authorKinds) as AuthorKind[]).find(kind => 'layout' in authorKinds[kind] && authorEntities(draft, kind).some(row => row[authorKinds[kind].id] === nodeTreeId(node)));
    form(readOnly ? '查看节点' : kind ? '编辑节点数据' : '修复既有旅行节点前置', dialog => {
      const name = field(dialog, '名称', node.nodeName, false, readOnly || !kind);
      field(dialog, '稳定 ID', node.nodeId, false, true);
      const description = field(dialog, '给用户的话', node.description ?? '', true, readOnly || !kind);
      const condition = field(dialog, '完成判定条件（供 AI 判断）', node.condition, true, readOnly || !kind);
      condition.placeholder = '例如：正文明确写出角色完成登记并拿到通行证明。';
      const parent = branchParentId(node), pending = draft.pendingBranchNodeIds.includes(node.nodeId);
      let branch: HTMLSelectElement | undefined;
      if (pending && !readOnly) branch = select(dialog, '确认旧节点的唯一强父节点', [{ id: '', label: '确认本节点为起点' }, ...nodes.filter(peer => peer.nodeId !== nodeId && nodeTreeId(peer) === nodeTreeId(node)).map(peer => ({ id: peer.nodeId, label: peer.nodeName }))], parent ?? '');
      else field(dialog, '上一级节点', nodes.find(peer => peer.nodeId === parent)?.nodeName ?? parent ?? (kind === 'story' ? '剧情树隐藏入口' : '起点'), false, true);
      const deps = new Set(node.dependencies?.filter(dep => dep.kind === 'prerequisite').map(dep => dep.nodeId));
      const allIds = new Set(nodes.map(peer => peer.nodeId));
      const missing = [...deps].filter(id => !allIds.has(id));
      if (missing.length) dialog.querySelector('form')!.append(el('p', `失效引用：${missing.join('、')}。取消勾选可明确移除。`));
      const search = field(dialog, '筛选额外前置（名称、模块、树或 ID）'); search.placeholder = '所有选择都必须完成';
      const choices = el('div'); choices.className = 'author-options';
      const inputs: Array<{ id: string; input: HTMLInputElement; label: HTMLLabelElement }> = [];
      const treeNames = new Map((Object.keys(authorKinds) as AuthorKind[]).flatMap(kind => authorEntities(draft, kind).map(row => [row[authorKinds[kind].id], row[authorKinds[kind].name]] as const)));
      for (const peer of [...nodes.filter(peer => peer.nodeId !== nodeId && peer.nodeId !== parent), ...missing.map(id => ({ nodeId: id, nodeName: '失效引用' } as BaseNodeDefinition))]) {
        const module = Object.values(draft.catalog.modules).find(module => 'nodes' in module && module.nodes.some(row => row.nodeId === peer.nodeId))?.moduleName ?? '';
        const treeName = treeNames.get(nodeTreeId(peer));
        const label = el('label', `${module} / ${treeName ?? nodeTreeId(peer) ?? ''} / ${peer.nodeName || '未命名'}`), input = el('input'); label.title = peer.nodeId;
        input.type = 'checkbox'; input.checked = deps.has(peer.nodeId); input.disabled = readOnly; label.prepend(input); choices.append(label); inputs.push({ id: peer.nodeId, input, label });
      }
      search.oninput = () => { for (const row of inputs) row.label.hidden = !`${row.label.textContent} ${row.id}`.toLowerCase().includes(search.value.toLowerCase()); };
      dialog.querySelector('form')!.append(choices);
      const alt = field(dialog, '图片说明（可留空）', node.imageAlt ?? '', false, readOnly);
      alt.placeholder = '图片无法显示或读屏时使用，留空沿用成就名称。';
      if (kind) assetInfo(dialog, entityAssetPath(kind, nodeTreeId(node)!).replace(/\/(card|cover)\.webp$/, `/nodes/${nodeId}.webp`));
      const memento = kind === 'person' ? select(dialog, '允许纪念留言', [{ id: 'false', label: '否' }, { id: 'true', label: '是' }], String('allowsMemento' in node && node.allowsMemento === true)) : undefined;
      if (memento) memento.disabled = readOnly;
      const choice = (kind === 'person' || kind === 'story') ? select(dialog, '互斥组', [{ id: '', label: '无' }, ...draft.catalog.choiceGroups.filter(group => ('personId' in group ? group.personId : group.storyTreeId) === nodeTreeId(node)).map(group => ({ id: group.choiceGroupId, label: group.choiceGroupName }))], node.choiceGroupId ?? '') : undefined;
      if (choice) choice.disabled = readOnly;
      const legacyChapterId = kind === 'story' && 'chapterId' in node ? String(node.chapterId ?? '') : '';
      const legacyChapter = legacyChapterId ? el('input') : undefined;
      if (legacyChapter) {
        legacyChapter.type = 'checkbox'; legacyChapter.disabled = readOnly;
        const chapterName = draft.catalog.modules.adventure.chapters.find(chapter => chapter.chapterId === legacyChapterId)?.chapterName ?? legacyChapterId;
        const label = el('label', `移除旧节点阶段覆盖（${chapterName}），沿用剧情树阶段`); label.prepend(legacyChapter); dialog.querySelector('form')!.append(label);
      }
      return () => {
        const strong = branch?.value ?? parent;
        const dependencies: NonNullable<BaseNodeDefinition['dependencies']> = strong ? [{ nodeId: strong, kind: 'branch' }] : [];
        dependencies.push(...inputs.filter(row => row.input.checked && row.id !== strong).map(row => ({ nodeId: row.id, kind: 'prerequisite' as const })));
        const patch: Partial<BaseNodeDefinition> = { dependencies, ...(kind ? { nodeName: name.value.trim(), description: description.value, condition: condition.value } : {}) };
        if (alt.value.trim()) patch.imageAlt = alt.value.trim();
        if (choice?.value) patch.choiceGroupId = choice.value;
        if (memento) (patch as Record<string, unknown>).allowsMemento = memento.value === 'true';
        if (legacyChapter?.checked) (patch as Record<string, unknown>).chapterId = undefined;
        apply({ type: 'editNode', nodeId, patch, ...(pending ? { confirmBranch: true } : {}), ...(choice && !choice.value ? { clearChoiceGroup: true } : {}) });
      };
    }, readOnly);
  }
  function lineForm(nodeId: string): void {
    if (!session || !selected) return;
    const draft = session.snapshot(), scope = selected, layout = treeLayout(draft, scope.kind, scope.id);
    form('线条外观', dialog => {
      const hidden = select(dialog, '强父连接线', [{ id: 'show', label: '显示' }, { id: 'hide', label: '永久隐藏' }], layout.hiddenBranchNodeIds?.includes(nodeId) ? 'hide' : 'show');
      dialog.querySelector('form')!.append(el('p', '这里的修改只改变线条外观。依赖在节点资料中管理。'));
      const targets = authorNodes(draft).filter(node => nodeTreeId(node) === scope.id && node.nodeId !== nodeId);
      const target = select(dialog, '增加视觉连线到', [{ id: '', label: '不增加' }, ...targets.map(node => ({ id: node.nodeId, label: node.nodeName || node.nodeId }))]);
      const routing = select(dialog, '新线样式', [{ id: 'curved', label: '平滑曲线' }, { id: 'orthogonal', label: '直角折线' }], 'curved');
      const edges = (layout.visualEdges ?? []).filter(edge => edge.from === nodeId || edge.to === nodeId);
      const retained = edges.map(edge => {
        const label = el('label', `保留视觉线 ${edge.from} → ${edge.to}`), input = el('input'); input.type = 'checkbox'; input.checked = true; label.prepend(input); dialog.querySelector('form')!.append(label); return { edge, input };
      });
      return () => {
        const hides = new Set(layout.hiddenBranchNodeIds); hidden.value === 'hide' ? hides.add(nodeId) : hides.delete(nodeId);
        const visualEdges = (layout.visualEdges ?? []).filter(edge => !retained.some(row => row.edge === edge && !row.input.checked));
        if (target.value) {
          const start = layout.positions[nodeId]!, end = layout.positions[target.value]!;
          visualEdges.push({ from: nodeId, to: target.value, routing: routing.value as 'curved' | 'orthogonal', points: [{ x: (start.x + end.x) / 2 + 80, y: (start.y + end.y) / 2 + 30 }] });
        }
        apply({ type: 'layout', kind: scope.kind, treeId: scope.id, layout: { ...layout, hiddenBranchNodeIds: [...hides], visualEdges } });
      };
    });
  }
  function nodeMenu(event: MouseEvent | KeyboardEvent, node: BaseNodeDefinition): void {
    contextMenu(event, [ ['编辑数据', () => nodeForm(node.nodeId)], ['新建子节点', () => selected && createNode(selected.kind, selected.id, node.nodeId)], ['线条外观', () => lineForm(node.nodeId)], ['删除分支', () => {
      const ids = branchDeletion(session!.snapshot(), node.nodeId);
      if (doc.defaultView?.confirm(`删除以下 ${ids.length} 个节点？\n${ids.map(id => authorNodes(session!.snapshot()).find(node => node.nodeId === id)?.nodeName || id).join('\n')}\n其他引用节点将保留并标红。`)) apply({ type: 'deleteBranch', nodeId: node.nodeId });
    }] ]);
  }
  function image(ref: string | undefined, alt: string, draft: AuthorDraft): HTMLImageElement | undefined {
    if (!ref) return undefined;
    const img = el('img'); img.src = options.assetUrl(draft.manifest.packId, ref, draft.revision); img.alt = alt; img.loading = 'lazy'; img.decoding = 'async'; img.draggable = false;
    img.onerror = () => { img.hidden = true; message(`图片载入失败：${ref}`); }; return img;
  }
  function drag(item: HTMLElement, start: { x: number; y: number }, layout: TreeLayout, commit: (point: { x: number; y: number }) => void): void {
    let origin: { x: number; y: number; pointer: number } | undefined, point = start, moved = false;
    item.onpointerdown = event => {
      if (event.button !== 0 || busy) return; moved = false; origin = { x: event.clientX, y: event.clientY, pointer: event.pointerId }; item.setPointerCapture(event.pointerId);
    };
    item.onpointermove = event => {
      if (!origin) return;
      const dx = event.clientX - origin.x, dy = event.clientY - origin.y;
      if (Math.abs(dx) + Math.abs(dy) < 5 && !moved) return;
      moved = true; point = { x: Math.max(0, Math.min(layout.width - 170, start.x + dx)), y: Math.max(0, Math.min(layout.height - 80, start.y + dy)) };
      item.style.left = `${point.x}px`; item.style.top = `${point.y}px`;
    };
    item.onpointerup = event => { if (!origin) return; item.releasePointerCapture(origin.pointer); origin = undefined; if (moved) { event.preventDefault(); safe(() => commit(point)); } };
    item.onpointercancel = () => { origin = undefined; render(); };
    item.addEventListener('click', event => { if (moved) { event.preventDefault(); event.stopImmediatePropagation(); moved = false; } }, true);
  }
  function canvas(draft: AuthorDraft, scope: { kind: AuthorKind; id: string }): void {
    const layout = treeLayout(draft, scope.kind, scope.id), nodes = authorNodes(draft).filter(node => nodeTreeId(node) === scope.id);
    const tree = scope.kind === 'story' ? draft.catalog.modules.adventure.storyTrees.find(tree => tree.storyTreeId === scope.id) : undefined;
    const entryId = tree?.entryNodeId;
    if (!nodes.length && !entryId) { content.append(button('创建首个节点', () => safe(() => createNode(scope.kind, scope.id)))); return; }
    const plane = el('div'); plane.className = 'author-canvas'; plane.style.width = `${layout.width}px`; plane.style.height = `${layout.height}px`;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', String(layout.width)); svg.setAttribute('height', String(layout.height)); svg.setAttribute('aria-hidden', 'true'); plane.append(svg);
    const path = (from: string, to: string, decorative = false, routing = 'curved', bend?: { x: number; y: number }) => {
      const a = layout.positions[from], b = layout.positions[to]; if (!a || !b) return;
      const x1 = a.x + 160, y1 = a.y + 32, x2 = b.x, y2 = b.y + 32, middle = bend?.x ?? (x1 + x2) / 2;
      const line = doc.createElementNS(svg.namespaceURI, 'path');
      line.setAttribute('d', routing === 'orthogonal' ? `M${x1},${y1} H${middle} V${bend?.y ?? y2} H${x2} V${y2}` : bend ? `M${x1},${y1} Q${bend.x},${bend.y} ${x2},${y2}` : `M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`);
      if (decorative) line.classList.add('decorative'); svg.append(line);
    };
    nodes.forEach(node => { const parent = branchParentId(node) ?? entryId; if (parent && !layout.hiddenBranchNodeIds?.includes(node.nodeId)) path(parent, node.nodeId); });
    if (entryId && tree) {
      const entry = button('', () => entityForm('story', scope.id)); entry.className = 'author-node author-entry'; entry.dataset.authorEntry = entryId;
      entry.append(el('strong', tree.storyTreeName), el('small', '隐藏入口 · 右键添加成就'));
      const point = layout.positions[entryId]!; entry.style.left = `${point.x}px`; entry.style.top = `${point.y}px`;
      const menu = (event: MouseEvent | KeyboardEvent) => contextMenu(event, [['编辑整树资料与关键词', () => entityForm('story', scope.id)], ['新建子节点', () => createNode('story', scope.id)]]);
      entry.oncontextmenu = menu;
      entry.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) menu(event); if (event.key === 'F2') { event.preventDefault(); entityForm('story', scope.id); } };
      drag(entry, point, layout, value => apply({ type: 'layout', kind: scope.kind, treeId: scope.id, layout: { ...layout, positions: { ...layout.positions, [entryId]: value } } }));
      plane.append(entry);
    }
    (layout.visualEdges ?? []).forEach((edge, index) => {
      path(edge.from, edge.to, true, edge.routing, edge.points?.[0]);
      if (scope.kind !== 'monster' && edge.points?.[0]) {
        const point = edge.points[0], handle = button('○', () => lineForm(edge.from)); handle.title = '拖动视觉线的拐点'; handle.style.position = 'absolute'; handle.style.left = `${point.x}px`; handle.style.top = `${point.y}px`;
        drag(handle, point, layout, value => { const updated = structuredClone(layout); updated.visualEdges![index]!.points = [value]; apply({ type: 'layout', kind: scope.kind, treeId: scope.id, layout: updated }); }); plane.append(handle);
      }
    });
    const invalidReferences = invalidNodeReferences(draft);
    nodes.forEach((node, index) => {
      const item = button('', () => nodeForm(node.nodeId, true)); item.className = 'author-node'; item.dataset.authorNode = node.nodeId;
      const point = layout.positions[node.nodeId] ?? { x: 30, y: 30 + index * 100 }; item.style.left = `${point.x}px`; item.style.top = `${point.y}px`;
      const img = image(node.assetRef, node.imageAlt ?? node.nodeName, draft); if (img) item.append(img);
      item.append(el('span', node.nodeName || '未命名节点'));
      const invalid = invalidReferences[node.nodeId] ?? [];
      if (invalid.length || draft.pendingBranchNodeIds.includes(node.nodeId)) { item.classList.add('is-invalid'); const text = el('span', invalid.length ? `失效前置：${invalid.join('、')}` : '待确认强父节点'); text.className = 'author-invalid'; item.append(text); }
      item.oncontextmenu = event => nodeMenu(event, node);
      item.onkeydown = event => {
        if (event.key === 'F2') { event.preventDefault(); nodeForm(node.nodeId); }
        else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) nodeMenu(event, node);
        else if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && scope.kind !== 'monster') {
          event.preventDefault(); const positions = { ...layout.positions, [node.nodeId]: { x: Math.max(0, Math.min(layout.width - 170, point.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0))), y: Math.max(0, Math.min(layout.height - 80, point.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0))) } };
          apply({ type: 'layout', kind: scope.kind, treeId: scope.id, layout: { ...layout, positions } });
        }
      };
      if (scope.kind !== 'monster') drag(item, point, layout, value => apply({ type: 'layout', kind: scope.kind, treeId: scope.id, layout: { ...layout, positions: { ...layout.positions, [node.nodeId]: value } } }));
      plane.append(item);
    }); content.append(plane);
  }
  function arrange(): void {
    if (!session || !selected) return;
    const draft = session.snapshot(), layout = treeLayout(draft, selected.kind, selected.id), nodes = authorNodes(draft).filter(node => nodeTreeId(node) === selected!.id), byId = new Map(nodes.map(node => [node.nodeId, node]));
    const depth = (node: BaseNodeDefinition): number => { const parent = byId.get(branchParentId(node) ?? ''); return parent ? depth(parent) + 1 : 0; };
    const rows = new Map<number, number>(), positions: TreeLayout['positions'] = {};
    const entryId = selected.kind === 'story' ? draft.catalog.modules.adventure.storyTrees.find(tree => tree.storyTreeId === selected!.id)?.entryNodeId : undefined;
    if (entryId) positions[entryId] = { x: 30, y: 30 };
    for (const node of nodes) { const d = depth(node) + (entryId ? 1 : 0), row = rows.get(d) ?? 0; rows.set(d, row + 1); positions[node.nodeId] = { x: 30 + d * 230, y: 30 + row * 120 }; }
    const width = Math.max(layout.width, ...Object.values(positions).map(point => point.x + 200)), height = Math.max(layout.height, ...Object.values(positions).map(point => point.y + 120));
    // Story tree bounds belong to a chapter; keep this automatic arrangement within its configured canvas.
    if (selected.kind === 'story' && (width > layout.width || height > layout.height)) throw new Error('自动布局超出剧情树画布，请先调整画布尺寸。');
    apply({ type: 'layout', kind: selected.kind, treeId: selected.id, layout: { ...layout, width, height, positions } });
  }
  function layoutForm(): void {
    if (!session || !selected) return;
    const draft = session.snapshot(), scope = selected, spec = authorKinds[scope.kind];
    const layout = scope.kind === 'chapter' ? draft.layouts.chapters[scope.id]! : treeLayout(draft, scope.kind, scope.id);
    form('画布布局', dialog => {
      const width = field(dialog, '画布宽度', String(layout.width)), height = field(dialog, '画布高度', String(layout.height));
      const story = scope.kind === 'story' ? draft.layouts.storyTrees[scope.id]! : undefined;
      const x = story ? field(dialog, '剧情树在阶段内的 X 坐标', String(story.x)) : undefined, y = story ? field(dialog, 'Y 坐标', String(story.y)) : undefined;
      return () => {
        if (scope.kind === 'chapter') apply({ type: 'chapterLayout', chapterId: scope.id, width: Number(width.value), height: Number(height.value) });
        else if ('layout' in spec) apply({ type: 'layout', kind: scope.kind, treeId: scope.id, layout: { ...layout as TreeLayout, width: Number(width.value), height: Number(height.value), ...(story ? { x: Number(x!.value), y: Number(y!.value) } : {}) } });
      };
    });
  }
  function choiceForm(): void {
    if (!selected || (selected.kind !== 'person' && selected.kind !== 'story')) return;
    const scope = selected;
    form('新建互斥组', dialog => { const name = field(dialog, '互斥组名称'); return () => apply({ type: 'choiceGroup', kind: scope.kind as 'person' | 'story', treeId: scope.id, id: `choice.${crypto.randomUUID()}`, name: name.value.trim() }); });
  }
  function storyLineForm(id?: string): void {
    if (!session || !selected || selected.kind !== 'story') return;
    const draft = session.snapshot(), scope = selected, line = draft.catalog.modules.adventure.storyLines.find(line => line.storyLineId === id);
    form('剧情线与结局', dialog => {
      const name = field(dialog, '剧情线名称', line?.storyLineName ?? ''), choices = el('div'); choices.className = 'author-options';
      const endings = draft.catalog.modules.adventure.nodes.filter(node => node.storyTreeId === scope.id).map(node => {
        const label = el('label', node.nodeName || node.nodeId), input = el('input'); input.type = 'checkbox'; input.checked = line?.endingNodeIds.includes(node.nodeId) ?? false; label.prepend(input); choices.append(label); return { node, input };
      }); dialog.querySelector('form')!.append(el('p', '选择该剧情线的具体结局节点。'), choices);
      return () => apply({ type: 'storyLine', treeId: scope.id, id: id ?? `line.${crypto.randomUUID()}`, name: name.value.trim(), endingNodeIds: endings.filter(row => row.input.checked).map(row => row.node.nodeId) });
    });
  }
  function deleteEntity(kind: 'chapter' | 'story', id: string): void {
    if (!session) return;
    const draft = session.snapshot(), removed = entityDeletion(draft, kind, id);
    const name = String(authorEntities(draft, kind).find(row => row[authorKinds[kind].id] === id)?.[authorKinds[kind].name]);
    const names = [...draft.catalog.modules.adventure.storyTrees.filter(tree => removed.treeIds.includes(tree.storyTreeId)).map(tree => tree.storyTreeName), ...authorNodes(draft).filter(node => removed.nodeIds.includes(node.nodeId)).map(node => node.nodeName || node.nodeId)];
    if (!doc.defaultView?.confirm(`删除${authorKinds[kind].label}“${name}”？包含 ${removed.treeIds.length} 棵树、${removed.nodeIds.length} 个成就。\n${names.join('\n')}\n其他引用保留并标红，可撤销恢复。`)) return;
    const chapterId = kind === 'story' ? draft.catalog.modules.adventure.storyTrees.find(tree => tree.storyTreeId === id)?.chapterId : undefined;
    session.dispatch({ type: 'deleteEntity', kind, id }); preflight = undefined;
    selected = chapterId ? { kind: 'chapter', id: chapterId } : undefined; render(); message('已删除，可撤销恢复。尚未保存。');
  }
  function entityCards(draft: AuthorDraft, kinds: AuthorKind[], parentId?: string): void {
    const cards = el('div'); cards.className = 'author-cards';
    for (const kind of kinds) {
      const spec = authorKinds[kind];
      for (const row of authorEntities(draft, kind).filter(row => !('parent' in spec) || row[spec.parent] === parentId)) {
        const id = String(row[spec.id]), name = String(row[spec.name]), card = button('', () => { selected = { kind, id }; currentModule = spec.module; render(); }); card.className = 'author-card';
        card.setAttribute('aria-label', name); card.dataset.authorEntity = id;
        const img = image(row.assetRef as string | undefined, name, draft); if (img) card.append(img);
        card.append(el('strong', name), el('small', spec.label));
        card.oncontextmenu = event => contextMenu(event, [['编辑资料', () => entityForm(kind, id)], ...(kind === 'chapter' || kind === 'story' ? [[`删除${spec.label}`, () => deleteEntity(kind, id)] as [string, () => void]] : [])]);
        cards.append(card);
      }
      content.append(button(`＋${spec.label}`, () => entityForm(kind)));
    }
    content.append(cards);
    if (!cards.childElementCount) content.append(el('p', '这里还没有卡片，请先创建。'));
  }
  function render(): void {
    if (!alive) return; closeMenu(); navigation.replaceChildren(); content.replaceChildren(); issues.replaceChildren(); toolbar.replaceChildren();
    toolbar.append(button('新建卡带', newPack), button('复制发布版本', importPack), button('打开草稿', () => { if (discard()) void run(draftList); }));
    if (!session) { content.append(el('p', '为任意酒馆角色卡创建成就定义。请打开或新建卡带。')); return; }
    const draft = session.snapshot(); title.textContent = `作者编辑器 · ${draft.manifest.packName} / ${draft.manifest.packVersion}`;
    toolbar.append(button('保存草稿', () => void run(async () => { await session!.save(storage); message(session!.dirty ? '提交已保存，当前仍有新修改。' : '草稿已完整保存。'); })), button('撤销', () => { if (!busy) { session!.undo(); preflight = undefined; render(); } }), button('重做', () => { if (!busy) { session!.redo(); preflight = undefined; render(); } }), button('刷新资产', () => void run(async () => {
      if (session!.dirty) await session!.save(storage);
      const current = session!.snapshot(); const next = await storage.refreshAssets(current.manifest.packId, current.revision); if (alive) { session!.replaceSaved(next); render(); message('资产已刷新并保存。'); }
    })), button('设置版本', () => form('下一发布版本', dialog => { const version = field(dialog, '版本字符串', draft.manifest.packVersion); return () => apply({ type: 'version', version: version.value.trim() }); })), button('发布预检', () => void run(async () => {
      if (session!.dirty) await session!.save(storage); const current = session!.snapshot(); preflight = await storage.preflight(current.manifest.packId, current.revision); render(); message(preflight.issues.length ? `预检发现 ${preflight.issues.length} 个问题。` : '预检通过，可发布新版本。');
    })));
    if (preflight && !preflight.issues.length && !session.dirty) toolbar.append(button('发布新版本', () => void run(async () => { const binding = await storage.publish(draft.manifest.packId, preflight!); message(`已发布 ${binding.packId}/${binding.packVersion}。可在现有“内容版本”页面应用到角色卡。`); preflight = undefined; render(); })));
    for (const module of ['adventure', 'bonds', 'careers', 'abilities', 'knowledge'] as const) {
      const item = button(draft.catalog.modules[module].moduleName, () => { selected = undefined; currentModule = module; render(); });
      if (currentModule === module) item.classList.add('is-selected'); navigation.append(item);
    }
    navigation.append(el('p', '旅行、日记作者页面待后续定义。'));
    if (selected && !authorEntities(draft, selected.kind).some(row => row[authorKinds[selected!.kind].id] === selected!.id)) selected = undefined;
    if (selected) {
      const spec = authorKinds[selected.kind], row = authorEntities(draft, selected.kind).find(row => row[spec.id] === selected!.id);
      if (row) {
        content.append(button(`返回${draft.catalog.modules[currentModule].moduleName}`, () => { selected = undefined; render(); }));
        if ('parent' in spec) {
          const parentKind = selected.kind === 'story' ? 'chapter' : selected.kind === 'skill' ? 'owner' : 'domain';
          const parentId = String(row[spec.parent]), parentSpec = authorKinds[parentKind];
          const parentName = authorEntities(draft, parentKind).find(parent => parent[parentSpec.id] === parentId)?.[parentSpec.name];
          content.append(button(`返回${parentName ?? parentSpec.label}`, () => { selected = { kind: parentKind, id: parentId }; render(); }));
        }
        content.append(el('h2', String(row[spec.name])), button('编辑资料', () => entityForm(selected!.kind, selected!.id)));
        if (selected.kind === 'chapter' || selected.kind === 'story') { const scope = selected; content.append(button(`删除${spec.label}`, () => safe(() => deleteEntity(scope.kind as 'chapter' | 'story', scope.id)))); }
        if ('layout' in spec || selected.kind === 'chapter') content.append(button('画布布局', layoutForm));
        if (selected.kind === 'person' || selected.kind === 'story') content.append(button('新建互斥组', choiceForm));
        if (selected.kind === 'story') {
          content.append(button('新建剧情线', () => storyLineForm()));
          for (const line of draft.catalog.modules.adventure.storyLines.filter(line => line.storyTreeId === selected!.id)) content.append(button(`剧情线：${line.storyLineName}`, () => storyLineForm(line.storyLineId)));
        }
        if ('layout' in spec) {
          if (selected.kind !== 'monster') content.append(button('自动整理', () => safe(arrange)));
          content.append(el('p', '左键查看；右键编辑或新建子节点；F2 编辑，Shift+F10 打开菜单；左键拖动节点和视觉线拐点。'));
          canvas(draft, selected);
        } else entityCards(draft, [selected.kind === 'chapter' ? 'story' : selected.kind === 'owner' ? 'skill' : 'topic'], selected.id);
      }
    } else {
      content.append(el('h2', draft.catalog.modules[currentModule].moduleName));
      entityCards(draft, (Object.keys(authorKinds) as AuthorKind[]).filter(kind => authorKinds[kind].module === currentModule && !('parent' in authorKinds[kind])));
    }
    for (const issue of preflight?.issues ?? session.issues()) issues.append(button(`${issue.path}：${issue.message}`, () => {
      const indexed = /^modules\.(adventure|bonds|careers|abilities|knowledge|travel)\.(nodes|locations)\[(\d+)\]/.exec(issue.path);
      const definition = indexed ? draft.catalog.modules[indexed[1] as 'adventure' | 'bonds' | 'careers' | 'abilities' | 'knowledge' | 'travel'] : undefined;
      const rows = definition && ('locations' in definition ? definition.locations : definition.nodes);
      const node = indexed && rows ? rows[Number(indexed[3])] : authorNodes(draft).find(node => issue.path.includes(node.nodeId) || issue.message.includes(node.nodeId));
      if (node) nodeForm(node.nodeId); else message(`${issue.path}：${issue.message}`);
    }));
    if (!issues.childElementCount) issues.append(el('small', '当前定义没有问题。'));
  }
  const onPointer = (event: PointerEvent) => { if (menu && !menu.contains(event.target as Node)) closeMenu(); };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && menu) { event.preventDefault(); closeMenu(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (session) void run(async () => { await session!.save(storage); message('草稿已保存。'); }); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) { event.preventDefault(); if (session && !busy) { event.shiftKey ? session.redo() : session.undo(); preflight = undefined; render(); } }
  };
  const beforeUnload = (event: BeforeUnloadEvent) => { if (session?.dirty) { event.preventDefault(); event.returnValue = ''; } };
  doc.addEventListener('pointerdown', onPointer); root.addEventListener('keydown', onKey); doc.defaultView?.addEventListener('beforeunload', beforeUnload);
  render(); void run(draftList);
  return () => { alive = false; closeMenu(); doc.removeEventListener('pointerdown', onPointer); root.removeEventListener('keydown', onKey); doc.defaultView?.removeEventListener('beforeunload', beforeUnload); root.querySelectorAll('dialog').forEach(dialog => dialog.close()); root.remove(); };
}
