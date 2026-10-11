import type { AchievementPlayerView, ContentModule, PlayerNodeView, PlayerCommand } from '../domain/index.ts';
import { notifications } from '../notifications.ts';
import { mountCanvas } from './canvas.ts';
import { buildMonsterDossier } from './bestiary-dossier.ts';
import { openEditor } from './editor.ts';
import { buildAbilityOwnerViews, buildBondPersonViews, buildCareerTreeViews, buildKnowledgeTreeViews, type JournalTreeView } from './journal-layout.ts';
import { button, element, sections, type JournalOptions, type JournalPort, type JournalScene } from './journal-port.ts';

export function mountJournal(host: HTMLElement, port: JournalPort, options: JournalOptions = {}) {
  const doc = host.ownerDocument;
  const book = element(doc, 'section', 'travel-journal');
  book.setAttribute('aria-label', '成就系统');
  const sidebar = element(doc, 'aside', 'journal-sidebar');
  sidebar.append(element(doc, 'p', 'journal-overline', 'THE WAYFARER’S JOURNAL'), element(doc, 'h2', 'journal-book-title', '成就系统'));
  const nav = element(doc, 'nav', 'journal-nav');
  nav.setAttribute('aria-label', '手账栏目');
  sidebar.append(nav);
  const adminNav = element(doc, 'nav', 'journal-admin-nav');
  adminNav.setAttribute('aria-label', '手账管理');
  sidebar.append(adminNav, element(doc, 'p', 'journal-sidebar-note', '山河远阔，\n而我仍在路上。'));
  const page = element(doc, 'main', 'journal-page');
  const header = element(doc, 'header', 'journal-header');
  const heading = element(doc, 'h1');
  const subtitle = element(doc, 'p');
  const titleBlock = element(doc, 'div');
  titleBlock.append(element(doc, 'p', 'journal-overline', '无名的旅途 · 已留下的足迹'), heading, subtitle);
  header.append(titleBlock);
  if (options.onClose) {
    const close = button(doc, '×', options.onClose, 'journal-close');
    close.setAttribute('aria-label', '关闭手账');
    header.append(close);
  }
  const content = element(doc, 'div', 'journal-content');
  const detail = element(doc, 'aside', 'journal-detail');
  detail.setAttribute('aria-label', '节点详情');
  detail.hidden = true;
  const footer = element(doc, 'footer', 'journal-footer');
  const status = element(doc, 'span', '', '悬停翻阅 · 点击固定 · 右键编辑');
  status.setAttribute('role', 'status');
  const pageNumber = element(doc, 'span');
  footer.append(status, pageNumber);
  page.append(header, content, detail, footer);
  book.append(sidebar, page);
  host.append(book);

  let current: ContentModule | 'settings' | 'prompting' | 'versions' = 'adventure';
  let view = port.getPlayerView();
  let pinned: string | undefined;
  let shown: string | undefined;
  let opener: HTMLElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupPage: (() => void) | undefined;
  let destroyed = false;
  let restoringFocus = false;
  const navigation = new Map<string, HTMLButtonElement>();
  const collapsed = new Set<string>();
  const recent = new Set<string>();
  let selectedAbilityOwner: string | undefined;
  let selectedBondPerson: string | undefined;
  let selectedCareerTree: string | undefined;
  let bestiaryOpen = false;
  let selectedCombatTree: string | undefined;

  function isCombat(node: PlayerNodeView): boolean { return node.module === 'abilities' && node.nodeKind === 'combat'; }

  function clearTimer() { clearTimeout(closeTimer); }
  function closeDetail(restoreFocus = false) {
    clearTimer();
    pinned = shown = undefined;
    detail.hidden = true;
    detail.replaceChildren();
    content.querySelectorAll('[data-node]').forEach(node => node.setAttribute('aria-expanded', 'false'));
    if (restoreFocus && opener?.isConnected) {
      restoringFocus = true;
      opener.focus();
      restoringFocus = false;
    }
  }
  function stopPeeking() {
    clearTimer();
    if (!pinned) closeTimer = setTimeout(() => closeDetail(), 220);
  }
  async function dispatch(command: PlayerCommand, successMessage = '手账已保存。') {
    const next = await port.dispatchPlayerCommand(command);
    if (destroyed) return;
    view = next;
    render();
    status.textContent = '已保存';
    notifications.success(successMessage);
  }
  function edit(node: PlayerNodeView) {
    if (isCombat(node)) return;
    if (!node.card) { status.textContent = '这一节点还没有可编辑的附言卡。'; return; }
    pinned = node.nodeId;
    openEditor(book, { nodeName: node.nodeName, text: node.card.text }, value => dispatch({
      type: 'editNodeCard', nodeId: node.nodeId, patch: { nodeName: value.nodeName, text: value.text },
    }));
  }
  function lock(node: PlayerNodeView) {
    const confirmed = doc.defaultView?.confirm(`重新上锁“${node.nodeName}”？依赖它的后续节点也会撤回。`) ?? false;
    if (!confirmed) return;
    void dispatch({ type: 'lockNode', nodeId: node.nodeId }).catch(error => {
      status.textContent = error instanceof Error ? error.message : '重新上锁失败。';
      notifications.error('重新上锁失败，未保存。');
    });
  }
  function showDetail(node: PlayerNodeView, trigger: HTMLElement, pin = false) {
    if (isCombat(node) && !node.unlocked && !node.nodeState) {
      if (pin) notifications.info('这个成就尚未达成。');
      return;
    }
    if (node.nodeState === 'blocked') {
      notifications.info('请先解锁前置条件。');
      return;
    }
    clearTimer();
    if (pinned && !pin && pinned !== node.nodeId) return;
    if (pin) pinned = node.nodeId;
    opener = trigger;
    shown = node.nodeId;
    detail.classList.toggle('is-pinned', !!pinned);
    detail.replaceChildren();
    const close = button(doc, '×', () => closeDetail(true), 'journal-close');
    close.setAttribute('aria-label', '关闭节点详情');
    const legend = element(doc, 'p', 'journal-overline', pinned ? '这一页，暂且停留' : '途中的一页');
    const title = element(doc, 'h2', '', node.nodeName);
    detail.append(close, legend, title);
    const scene = current !== 'settings' && current !== 'prompting' && current !== 'versions' ? options.scene?.(current) ?? port.getPlayerScene?.(current) : undefined;
    const picture = scene?.images?.[node.nodeId];
    if (picture) {
      const url = new URL(picture.url, doc.baseURI);
      if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:' || url.protocol === 'blob:' || (url.protocol === 'data:' && picture.url.startsWith('data:image/'))) {
        const img = element(doc, 'img', 'journal-detail-image');
        img.src = url.href;
        img.alt = picture.alt;
        detail.append(img);
      }
    }
    if (node.authorDescription) detail.append(element(doc, 'p', 'journal-place', node.authorDescription));
    else if (node.description && node.card && node.description !== node.card.text) detail.append(element(doc, 'p', 'journal-place', node.description));
    const fallback = node.nodeState === 'available' ? '前置条件已经满足，可以接取这一任务。'
      : node.nodeState === 'active' ? '任务已经接取，等待正文确认完成。'
      : node.nodeState === 'claimable' ? '正文已经确认完成，点击节点图标即可领取。'
      : node.unlocked ? '这一刻，已记在旅途中。' : '地区入口尚未达成。';
    detail.append(element(doc, 'p', 'journal-handwritten', node.card?.text ?? node.description ?? fallback));
    const actions = element(doc, 'div', 'journal-detail-actions');
    if (!pinned) actions.append(button(doc, '固定这一页', () => showDetail(node, trigger, true)));
    if (node.nodeState === 'available') actions.append(button(doc, '接取任务', () => {
      void dispatch({ type: 'acceptNodeTask', nodeId: node.nodeId, acceptedAt: new Date().toISOString() }).catch(error => {
        status.textContent = error instanceof Error ? error.message : '任务接取失败。';
        notifications.error('任务接取失败，未保存。');
      });
    }, 'journal-accept-task'));
    if (node.card && !isCombat(node)) actions.append(button(doc, '编辑附文', () => edit(node)));
    if (node.unlocked) actions.append(button(doc, '重新上锁', () => lock(node)));
    detail.append(actions, element(doc, 'span', 'journal-detail-flourish', '✧'));
    detail.hidden = false;
    content.querySelectorAll<HTMLElement>('[data-node]').forEach(item => item.setAttribute('aria-expanded', String(item.dataset.node === node.nodeId)));
  }

  function claim(node: PlayerNodeView) {
    closeDetail();
    recent.add(node.nodeId);
    void dispatch({ type: 'claimNodeTask', nodeId: node.nodeId, claimedAt: new Date().toISOString() }, '成就已领取。').catch(error => {
      recent.delete(node.nodeId);
      status.textContent = error instanceof Error ? error.message : '成就领取失败。';
      notifications.error('成就领取失败，未保存。');
    });
  }
  detail.addEventListener('pointerenter', clearTimer);
  detail.addEventListener('pointerleave', stopPeeking);
  detail.addEventListener('focusin', clearTimer);
  detail.addEventListener('focusout', event => { if (!detail.contains(event.relatedTarget as Node)) stopPeeking(); });
  book.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !book.querySelector('dialog[open]')) { closeDetail(true); event.stopPropagation(); }
  });

  function nodeButton(node: PlayerNodeView) {
    const item = button(doc, '', () => node.nodeState === 'claimable' ? claim(node) : showDetail(node, item, true), 'journal-node');
    item.dataset.node = node.nodeId;
    if (node.nodeState) item.dataset.nodeState = node.nodeState;
    item.setAttribute('aria-expanded', 'false');
    item.setAttribute('aria-label', `${node.nodeName}，查看详情`);
    const lockedCombat = isCombat(node) && !node.unlocked && !node.nodeState;
    if (lockedCombat) {
      item.classList.add('is-combat-locked');
      item.setAttribute('aria-label', `${node.nodeName}，尚未达成`);
    }
    if (!node.unlocked && !node.nodeState && !isCombat(node)) {
      item.classList.add('is-root-entry');
      item.setAttribute('aria-label', `${node.nodeName}，尚未达成的地区入口`);
    }
    if (node.nodeState === 'blocked') item.setAttribute('aria-label', `${node.nodeName}，请先解锁前置条件`);
    if (node.nodeState === 'claimable') item.setAttribute('aria-label', `${node.nodeName}，点击领取成就`);
    const glyph = node.nodeState === 'active' ? '◆' : node.nodeState === 'claimable' ? '✦' : node.nodeState === 'completed' || (isCombat(node) && node.unlocked) ? '印' : current === 'travel' ? '◇' : '✧';
    item.append(element(doc, 'span', 'journal-node-ring', glyph), element(doc, 'span', 'journal-node-title', node.nodeName));
    if (node.nodeState) item.append(element(doc, 'span', 'journal-node-state', {
      blocked: '前置不足', available: '可接取', active: '已接取', claimable: '可领取', completed: '已完成',
    }[node.nodeState]));
    if (recent.has(node.nodeId)) item.classList.add('just-unlocked');
    item.addEventListener('animationend', () => { item.classList.remove('just-unlocked'); recent.delete(node.nodeId); });
    if (node.nodeState !== 'blocked' && !lockedCombat) {
      item.addEventListener('pointerenter', () => showDetail(node, item));
      item.addEventListener('pointerleave', stopPeeking);
      item.addEventListener('focus', () => { if (!restoringFocus) showDetail(node, item); });
      item.addEventListener('blur', event => { if (!detail.contains(event.relatedTarget as Node)) stopPeeking(); });
    }
    item.addEventListener('contextmenu', event => {
      event.preventDefault();
      if (isCombat(node)) { if (node.unlocked) showDetail(node, item, true); return; }
      if (!node.unlocked) { if (node.nodeState === 'blocked') notifications.info('请先解锁前置条件。'); return; }
      showDetail(node, item, true); edit(node);
    });
    item.addEventListener('keydown', event => {
      if (node.unlocked && !isCombat(node) && (event.key === 'F2' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); edit(node); }
    });
    return item;
  }

  function sceneForTree(scene: ReturnType<NonNullable<JournalOptions['scene']>>, tree: JournalTreeView) {
    const nodeIds = new Set(tree.nodes.map(node => node.nodeId));
    const positions: typeof scene.positions = {};
    for (const nodeId of nodeIds) {
      const point = scene.positions[nodeId];
      if (point) positions[nodeId] = point;
    }
    return {
      positions,
      ...(scene.treeBounds?.[tree.id] ? { bounds: scene.treeBounds[tree.id] } : {}),
      edges: scene.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
    };
  }

  function mountTree(sheet: HTMLElement, tree: JournalTreeView, scene: ReturnType<NonNullable<JournalOptions['scene']>>, module: 'bonds' | 'careers' | 'abilities' | 'knowledge') {
    if (!tree.nodes.length) {
      sheet.append(element(doc, 'p', 'journal-tree-empty', '尚未记下节点。'));
      return undefined;
    }
    const canvas = element(doc, 'div', `journal-canvas journal-tree-canvas journal-canvas-${module}`);
    sheet.append(canvas);
    return mountCanvas(canvas, tree.nodes, sceneForTree(scene, tree), nodeButton);
  }

  function focusAbilityCard(ownerId: string) {
    const card = Array.from(content.querySelectorAll<HTMLElement>('[data-ability-owner]'))
      .find(item => item.dataset.abilityOwner === ownerId);
    card?.focus();
  }

  function renderAbilities(nodes: PlayerNodeView[], scene: ReturnType<NonNullable<JournalOptions['scene']>>) {
    const owners = buildAbilityOwnerViews(nodes, scene);
    const selected = owners.find(owner => owner.id === selectedAbilityOwner);
    if (!selected) {
      selectedAbilityOwner = undefined;
      const index = element(doc, 'div', 'journal-ability-index');
      for (const owner of owners) {
        const card = button(doc, '', () => {
          selectedAbilityOwner = owner.id;
          render();
          content.querySelector<HTMLElement>('.journal-subpage-title')?.focus();
        }, 'journal-ability-card');
        card.dataset.abilityOwner = owner.id;
        card.setAttribute('aria-label', `打开${owner.title}的技能树`);
        card.append(element(doc, 'span', 'journal-ability-card-title', owner.title));
        if (owner.image) {
          const image = element(doc, 'img', 'journal-detail-image');
          image.src = owner.image.url; image.alt = owner.image.alt;
          card.append(image);
        }
        index.append(card);
      }
      content.append(index);
      const atlas = button(doc, '', () => { bestiaryOpen = true; render(); }, 'journal-bestiary-book');
      atlas.dataset.bestiaryBook = '';
      atlas.setAttribute('aria-label', '打开怪物图鉴');
      if (scene.bestiaryBookCover) {
        atlas.classList.add('has-cover');
        const cover = element(doc, 'img', 'journal-bestiary-book-cover');
        cover.src = scene.bestiaryBookCover.url;
        cover.alt = scene.bestiaryBookCover.alt;
        atlas.append(cover);
      } else {
        const emblem = element(doc, 'span', 'journal-bestiary-book-emblem', '◇');
        emblem.setAttribute('aria-hidden', 'true');
        atlas.append(emblem);
      }
      const label = element(doc, 'span', 'journal-bestiary-book-copy');
      label.append(element(doc, 'span', 'journal-bestiary-book-title', '怪物图鉴'), element(doc, 'small', '', '旅途中遇见的生灵'));
      atlas.append(label);
      content.append(atlas);
      status.textContent = '选择人物技能卡，或打开怪物图鉴';
      if (bestiaryOpen) renderBestiary(nodes, scene);
      return;
    }

    const subpage = element(doc, 'section', 'journal-subpage');
    const bar = element(doc, 'div', 'journal-subpage-bar');
    const back = button(doc, '← 返回人物', () => {
      const ownerId = selected.id;
      selectedAbilityOwner = undefined;
      render();
      focusAbilityCard(ownerId);
    }, 'journal-back');
    const subpageTitle = element(doc, 'h2', 'journal-subpage-title', selected.title);
    subpageTitle.tabIndex = -1;
    bar.append(back, subpageTitle);
    const trees = element(doc, 'div', 'journal-tree-stack journal-ability-trees');
    const cleanups: Array<() => void> = [];
    for (const tree of selected.trees) {
      const sheet = element(doc, 'section', 'journal-tree-sheet journal-skill-tree');
      sheet.append(element(doc, 'h3', '', tree.title));
      const cleanup = mountTree(sheet, tree, scene, 'abilities');
      if (cleanup) cleanups.push(cleanup);
      trees.append(sheet);
    }
    subpage.append(bar, trees);
    content.append(subpage);
    cleanupPage = () => cleanups.forEach(cleanup => cleanup());
    status.textContent = 'Ctrl+滚轮缩放 · 中键拖动画布 · 点击节点查看详情';
  }

  function monsterButton(entry: NonNullable<JournalScene['groups']>[number]) {
    const item = button(doc, '', () => {
      if (!entry.unlocked) {
        item.classList.remove('is-tapped'); void item.offsetWidth; item.classList.add('is-tapped');
        notifications.info('尚未遇见这种怪物。'); return;
      }
      selectedCombatTree = entry.id; render();
    }, 'journal-monster-entry');
    item.dataset.combatEntry = entry.id;
    item.dataset.unlocked = String(entry.unlocked === true);
    item.setAttribute('aria-label', entry.unlocked ? `打开${entry.title}的成就树` : '尚未遇见的怪物');
    const ring = element(doc, 'span', 'journal-monster-ring');
    if (entry.image) {
      const img = element(doc, 'img'); img.width = img.height = 64;
      img.src = entry.image.url; img.alt = entry.unlocked ? entry.image.alt : '尚未遇见的怪物'; ring.append(img);
    } else ring.append(element(doc, 'span', 'journal-monster-placeholder', '?'));
    item.append(ring, element(doc, 'span', 'journal-monster-name', entry.title));
    item.addEventListener('animationend', () => item.classList.remove('is-tapped'));
    return item;
  }

  function renderBestiary(nodes: PlayerNodeView[], scene: JournalScene) {
    const entries = scene.groups?.filter(g => g.kind === 'combatTree') ?? [];
    const selected = entries.find(g => g.id === selectedCombatTree && g.unlocked);
    if (!selected) selectedCombatTree = undefined;
    const panel = element(doc, 'dialog', 'journal-bestiary-panel');
    panel.setAttribute('aria-label', selected ? `${selected.title}的成就树` : '怪物图鉴');
    const backToIndex = () => {
      const id = selectedCombatTree;
      selectedCombatTree = undefined;
      render();
      Array.from(content.querySelectorAll<HTMLButtonElement>('[data-combat-entry]')).find(b => b.dataset.combatEntry === id)?.focus();
    };
    const closeAtlas = () => {
      bestiaryOpen = false; selectedCombatTree = undefined; render();
      content.querySelector<HTMLButtonElement>('[data-bestiary-book]')?.focus();
    };
    const bar = element(doc, 'div', 'journal-subpage-bar');
    if (selected) bar.append(button(doc, '← 返回图鉴', backToIndex, 'journal-back'));
    const title = element(doc, 'h2', '', selected ? `怪物图鉴 · ${selected.title}` : '怪物图鉴');
    const close = button(doc, '×', closeAtlas, 'journal-close');
    close.setAttribute('aria-label', '关闭怪物图鉴');
    bar.append(title, close); panel.append(bar);
    let cleanupTree: (() => void) | undefined;
    if (selected) {
      const treeNodes = nodes.filter(n => selected.nodeIds.includes(n.nodeId));
      const spread = element(doc, 'div', 'journal-bestiary-spread');
      const records = element(doc, 'section', 'journal-monster-records');
      records.setAttribute('aria-label', `${selected.title}的成就记录`);
      records.append(element(doc, 'h3', 'journal-dossier-eyebrow', '冒险见闻 · 成就记录'));
      const sheet = element(doc, 'section', 'journal-tree-sheet');
      records.append(sheet, element(doc, 'p', 'journal-form-note', 'Ctrl＋滚轮缩放 · 中键拖动 · 灰色成就尚未达成'));
      spread.append(buildMonsterDossier(doc, selected, treeNodes, scene.rankBadges), records);
      panel.append(spread);
      cleanupTree = mountTree(sheet, {id:selected.id,title:selected.title,nodes:treeNodes}, scene, 'abilities');
    } else {
      const index = element(doc, 'div', 'journal-bestiary-rows');
      let row: HTMLDivElement | undefined;
      for (const entry of entries) {
        if (!row || entry.startNewRow) {
          row = element(doc, 'div', 'journal-bestiary-index');
          index.append(row);
        }
        row.append(monsterButton(entry));
      }
      if (!entries.length) index.append(element(doc, 'p', 'journal-empty', '尚未预设怪物条目。'));
      panel.append(index);
    }
    // The shared detail panel must be inside the modal to retain pointer and keyboard access.
    panel.append(detail); content.append(panel); panel.showModal();
    panel.addEventListener('cancel', event => {
      event.preventDefault();
      if (!detail.hidden) closeDetail(true);
      else if (selectedCombatTree) backToIndex();
      else closeAtlas();
    });
    cleanupPage = () => { cleanupTree?.(); page.append(detail); panel.close(); panel.remove(); };
  }

  function renderKnowledge(nodes: PlayerNodeView[], scene: ReturnType<NonNullable<JournalOptions['scene']>>) {
    const trees = buildKnowledgeTreeViews(nodes, scene);
    const stack = element(doc, 'div', 'journal-tree-stack journal-knowledge-trees');
    const cleanups: Array<() => void> = [];
    for (const tree of trees) {
      const sheet = element(doc, 'section', 'journal-tree-sheet journal-knowledge-tree');
      sheet.append(element(doc, 'h2', '', tree.title));
      const cleanup = mountTree(sheet, tree, scene, 'knowledge');
      if (cleanup) cleanups.push(cleanup);
      stack.append(sheet);
    }
    content.append(stack);
    cleanupPage = () => cleanups.forEach(cleanup => cleanup());
    status.textContent = 'Ctrl+滚轮缩放 · 中键拖动画布 · 点击节点查看详情';
  }

  function renderSingleTreeIndex(
    trees: JournalTreeView[],
    selectedId: string | undefined,
    select: (id: string | undefined) => void,
    module: 'bonds' | 'careers',
    scene: ReturnType<NonNullable<JournalOptions['scene']>>,
    labels: { open: string; back: string; choose: string },
  ) {
    const selected = trees.find(tree => tree.id === selectedId);
    if (!selected) {
      select(undefined);
      const index = element(doc, 'div', `journal-ability-index journal-${module}-index`);
      for (const tree of trees) {
        const card = button(doc, '', () => {
          select(tree.id);
          render();
          content.querySelector<HTMLElement>('.journal-subpage-title')?.focus();
        }, `journal-ability-card journal-${module}-card`);
        card.dataset.treeCard = tree.id;
        card.setAttribute('aria-label', `${labels.open}${tree.title}`);
        if (tree.image) {
          const image = element(doc, 'img', 'journal-entry-card-image');
          image.src = tree.image.url;
          image.alt = tree.image.alt;
          image.draggable = false;
          card.append(image);
        }
        card.append(element(doc, 'span', 'journal-ability-card-title', tree.title));
        index.append(card);
      }
      content.append(index);
      status.textContent = trees.length ? labels.choose : '这一页还空着。';
      return;
    }

    const subpage = element(doc, 'section', 'journal-subpage');
    const bar = element(doc, 'div', 'journal-subpage-bar');
    const back = button(doc, labels.back, () => {
      const treeId = selected.id;
      select(undefined);
      render();
      Array.from(content.querySelectorAll<HTMLElement>('[data-tree-card]')).find(item => item.dataset.treeCard === treeId)?.focus();
    }, 'journal-back');
    const subpageTitle = element(doc, 'h2', 'journal-subpage-title', selected.title);
    subpageTitle.tabIndex = -1;
    bar.append(back, subpageTitle);
    const stack = element(doc, 'div', `journal-tree-stack journal-${module}-trees`);
    const sheet = element(doc, 'section', `journal-tree-sheet journal-${module}-tree`);
    const cleanup = mountTree(sheet, selected, scene, module);
    stack.append(sheet);
    subpage.append(bar, stack);
    content.append(subpage);
    cleanupPage = cleanup;
    status.textContent = 'Ctrl+滚轮缩放 · 中键拖动画布 · 点击节点查看详情';
  }

  function renderBonds(nodes: PlayerNodeView[], scene: ReturnType<NonNullable<JournalOptions['scene']>>) {
    renderSingleTreeIndex(buildBondPersonViews(nodes, scene), selectedBondPerson, id => { selectedBondPerson = id; }, 'bonds', scene, {
      open: '打开人物羁绊：', back: '← 返回人物', choose: '选择人物，翻阅对应的羁绊树',
    });
  }

  function renderCareers(nodes: PlayerNodeView[], scene: ReturnType<NonNullable<JournalOptions['scene']>>) {
    renderSingleTreeIndex(buildCareerTreeViews(nodes, scene), selectedCareerTree, id => { selectedCareerTree = id; }, 'careers', scene, {
      open: '打开职业树：', back: '← 返回职业', choose: '选择职业，翻阅对应的成长树',
    });
  }

  function renderNodes(module: Exclude<ContentModule, 'journal'>) {
    const nodes = view.nodes.filter(node => node.module === module);
    const scene = options.scene?.(module) ?? port.getPlayerScene?.(module) ?? { positions: {}, edges: [] };
    const groups = scene.groups?.filter(group => nodes.some(node => group.nodeIds.includes(node.nodeId))) ?? [];
    if (module === 'abilities') {
      renderAbilities(nodes, scene);
      return;
    }
    if (!nodes.length) { content.append(element(doc, 'p', 'journal-empty', '这一页还空着。等旅途留下第一笔。')); return; }
    if (module === 'bonds') {
      renderBonds(nodes, scene);
      return;
    }
    if (module === 'knowledge') {
      renderKnowledge(nodes, scene);
      return;
    }
    if (module === 'careers') {
      renderCareers(nodes, scene);
      return;
    }
    const chapters = element(doc, 'div', 'journal-chapters');
    for (const group of groups) {
      const toggle = button(doc, `${collapsed.has(group.id) ? '+' : '−'} ${group.title}`, () => {
        if (collapsed.has(group.id)) collapsed.delete(group.id); else collapsed.add(group.id);
        render();
      });
      toggle.setAttribute('aria-expanded', String(!collapsed.has(group.id)));
      chapters.append(toggle);
    }
    if (groups.length) content.append(chapters);
    const visible = nodes.filter(node => !groups.some(group => collapsed.has(group.id) && group.nodeIds.includes(node.nodeId)));
    const canvas = element(doc, 'div', `journal-canvas journal-canvas-${module}`);
    content.append(canvas);
    cleanupPage = mountCanvas(canvas, visible, scene, nodeButton, module === 'travel');
    status.textContent = 'Ctrl+滚轮缩放 · 中键拖动画布 · 点击节点查看详情';
  }

  function renderJournal() {
    const leaves = element(doc, 'div', 'journal-leaves');
    content.append(button(doc, '＋ 写一则日记', () => openEditor(book, { title: '', text: '' }, value => dispatch({
      type: 'addPlayerJournal', journalId: `journal.${crypto.randomUUID()}`, title: value.title, text: value.text, createdAt: new Date().toISOString(),
    })), 'journal-write'), leaves);
    if (!view.journalEntries.length) leaves.append(element(doc, 'p', 'journal-empty', '今天有什么想留下的吗？'));
    for (const entry of view.journalEntries) {
      const leaf = element(doc, 'article', 'journal-leaf');
      const title = entry.title ?? '无题日记';
      leaf.append(element(doc, 'time', '', new Date(entry.createdAt).toLocaleDateString('zh-CN')), element(doc, 'h2', 'journal-leaf-title', title), element(doc, 'p', 'journal-handwritten', entry.text));
      const open = () => openEditor(book, { title: entry.title ?? '', text: entry.text }, value => dispatch({ type: 'editJournalEntry', journalId: entry.journalId, title: value.title, text: value.text }));
      const remove = button(doc, '删除', () => {
        if (!doc.defaultView?.confirm(`删除“${title}”？此操作会删除这条日记。`)) return;
        remove.disabled = true;
        void dispatch({type:'deleteJournalEntry', journalId:entry.journalId}, '日记已删除。').catch(error => {
          remove.disabled = false;
          status.textContent = error instanceof Error ? error.message : '删除日记失败。';
          notifications.error('删除失败，日记未移除。');
        });
      }, 'journal-delete');
      remove.setAttribute('aria-label', `删除日记：${title}`);
      leaf.append(button(doc, '编辑', open), remove);
      leaf.addEventListener('contextmenu', event => { event.preventDefault(); open(); });
      leaves.append(leaf);
    }
  }

  function render() {
    cleanupPage?.();
    cleanupPage = undefined;
    closeDetail();
    content.replaceChildren();
    content.className = `journal-content journal-content-${current}`;
    navigation.forEach((item, key) => { if (key === current) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
    const section = sections.find(item => item[0] === current);
    heading.textContent = section?.[1] ?? (current === 'settings' ? '设置' : current === 'versions' ? '内容版本与遗留记录' : '提示词与发送');
    subtitle.textContent = section?.[3] ?? '整理行囊，然后继续旅途。';
    pageNumber.textContent = section ? String(sections.indexOf(section) + 1).padStart(2, '0') : '·';
    status.textContent = '悬停翻阅 · 点击固定 · 右键编辑';
    if (current === 'settings' || current === 'prompting' || current === 'versions') {
      const mount = current === 'settings' ? port.mountSettings : current === 'versions' ? port.mountVersions : port.mountPrompting;
      if (mount) cleanupPage = mount.call(port, content);
      else content.append(element(doc, 'p', 'journal-empty', '预览中保留此入口；接入运行框架后显示配置页面。'));
    } else if (current === 'journal') renderJournal();
    else renderNodes(current);
  }
  for (const [id, label, icon] of sections) {
    const link = button(doc, '', () => { bestiaryOpen = false; selectedCombatTree = undefined; selectedAbilityOwner = undefined; selectedBondPerson = undefined; selectedCareerTree = undefined; current = id; render(); }, 'journal-tab');
    const glyph = element(doc, 'span', 'journal-tab-icon', icon);
    glyph.setAttribute('aria-hidden', 'true');
    link.append(glyph, element(doc, 'span', '', label));
    navigation.set(id, link);
    nav.append(link);
  }
  for (const [id, label] of [['prompting', '提示词与发送'], ['settings', '设置'], ...(port.mountVersions ? [['versions', '内容版本与遗留记录'] as const] : [])] as const) {
    const link = button(doc, label, () => { bestiaryOpen = false; selectedCombatTree = undefined; selectedAbilityOwner = undefined; selectedBondPerson = undefined; selectedCareerTree = undefined; current = id; render(); }, 'journal-tab');
    navigation.set(id, link);
    adminNav.append(link);
  }
  render();
  return {
    refresh(snapshot?: AchievementPlayerView) {
      if (destroyed) return;
      const next = snapshot ?? port.getPlayerView();
      const oldIds = new Set(view.nodes.filter(node => node.unlocked).map(node => node.nodeId));
      next.nodes.filter(node => node.unlocked && !oldIds.has(node.nodeId)).forEach(node => recent.add(node.nodeId));
      view = next;
      if (current !== 'settings' && current !== 'prompting' && current !== 'versions') render();
    },
    destroy() { destroyed = true; clearTimer(); cleanupPage?.(); book.remove(); },
    getSelection: () => ({ module: current, nodeId: shown, pinned: !!pinned }),
  };
}
