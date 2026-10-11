import type { PlayerNodeView } from '../domain/index.ts';
import { button, element, type JournalScene } from './journal-port.ts';

export type CanvasWheelIntent = 'scroll' | 'zoom-in' | 'zoom-out';

export function getCanvasWheelIntent(input: { ctrlKey: boolean; deltaY: number }): CanvasWheelIntent {
  if (!input.ctrlKey) return 'scroll';
  return input.deltaY < 0 ? 'zoom-in' : 'zoom-out';
}

export function isCanvasPanButton(button: number): boolean {
  return button === 1;
}

export function mountCanvas(
  host: HTMLElement,
  nodes: PlayerNodeView[],
  scene: JournalScene,
  nodeButton: (node: PlayerNodeView) => HTMLElement,
  map = false,
) {
  const doc = host.ownerDocument;
  const viewport = element(doc, 'div', 'journal-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', '画布。普通滚轮滚动页面，Ctrl 加滚轮缩放，中键拖动平移；方向键平移，加减键缩放，Home 复位。');
  const plane = element(doc, 'div', 'journal-plane');
  if (map) plane.classList.add('journal-map');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'journal-connections');
  svg.setAttribute('aria-hidden', 'true');
  const placed = nodes.filter(node => scene.positions[node.nodeId]);
  const missing = nodes.filter(node => !scene.positions[node.nodeId]);
  if (missing.length) {
    const list = element(doc, 'div', 'journal-unplaced');
    list.append(element(doc, 'p', '', '以下节点尚未配置坐标：'));
    missing.forEach(node => list.append(nodeButton(node)));
    host.append(list);
  }
  const points = new Map(placed.map(node => [node.nodeId, scene.positions[node.nodeId]!]));
  const width = scene.bounds?.width ?? Math.max(1, ...Array.from(points.values(), point => point.x + 140));
  const height = scene.bounds?.height ?? Math.max(1, ...Array.from(points.values(), point => point.y + 150));
  plane.style.width = `${width}px`;
  plane.style.height = `${height}px`;
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  for (const edge of scene.edges) {
    const start = points.get(edge.from);
    const end = points.get(edge.to);
    if (!start || !end) continue;
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    if (edge.completed !== undefined) path.setAttribute('class', edge.completed ? 'is-completed' : 'is-pending');
    const bend = edge.points?.[0], middle = bend?.x ?? (start.x + end.x) / 2;
    path.setAttribute('d', edge.routing === 'orthogonal'
      ? `M${start.x},${start.y} H${middle} V${bend?.y ?? end.y} H${end.x} V${end.y}`
      : bend ? `M${start.x},${start.y} Q${bend.x},${bend.y} ${end.x},${end.y}` : `M${start.x},${start.y} C${middle},${start.y} ${middle},${end.y} ${end.x},${end.y}`);
    if (edge.routing === 'orthogonal') path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  for (const background of scene.backgrounds ?? []) {
    const img = element(doc, 'img', 'journal-map-background');
    img.src = background.url; img.alt = background.alt;
    Object.assign(img.style, {position:'absolute',left:`${background.x}px`,top:`${background.y}px`,width:`${background.width}px`,height:`${background.height}px`});
    plane.append(img);
  }
  for (const chapter of scene.chapters ?? []) {
    const label = element(doc, 'h3', 'journal-chapter-label', chapter.chapterName);
    Object.assign(label.style, {position:'absolute',left:`${chapter.x + 24}px`,top:'0'});
    plane.append(label);
  }
  plane.append(svg);
  if (scene.fogBoundary) {
    const fog = element(doc, 'div', 'journal-chapter-fog');
    fog.setAttribute('aria-label', '后续大章尚未开放');
    Object.assign(fog.style, {position:'absolute',left:`${scene.fogBoundary.x}px`,top:'0',width:`${scene.fogBoundary.width}px`,height:`${scene.fogBoundary.height}px`,background:'linear-gradient(90deg, transparent, #17191d 35%)',pointerEvents:'none'});
    plane.append(fog);
  }
  for (const node of placed) {
    const point = points.get(node.nodeId)!;
    const item = nodeButton(node);
    item.classList.add('journal-map-node');
    item.style.left = `${point.x}px`;
    item.style.top = `${point.y}px`;
    plane.append(item);
  }
  viewport.append(plane);
  let x = 0, y = 0, scale = 1;
  const controls = element(doc, 'div', 'journal-canvas-controls');
  const value = element(doc, 'output', '', '100%');
  value.setAttribute('aria-label', '画布缩放');
  function paint() {
    x = Math.min(0, Math.max(Math.min(0, viewport.clientWidth - width * scale), x));
    y = Math.min(0, Math.max(Math.min(0, viewport.clientHeight - height * scale), y));
    plane.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    value.textContent = `${Math.round(scale * 100)}%`;
  }
  function zoom(next: number) {
    const previous = scale;
    scale = Math.max(.45, Math.min(1.8, next));
    const cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2;
    x = cx - (cx - x) * scale / previous;
    y = cy - (cy - y) * scale / previous;
    paint();
  }
  function reset() {
    scale = Math.max(.72, Math.min(1, (viewport.clientWidth - 36) / width, (viewport.clientHeight - 36) / height));
    x = Math.max(18, (viewport.clientWidth - width * scale) / 2);
    y = Math.max(18, (viewport.clientHeight - height * scale) / 2);
    paint();
  }
  const minus = button(doc, '−', () => zoom(scale - .1));
  minus.setAttribute('aria-label', '缩小画布');
  const plus = button(doc, '+', () => zoom(scale + .1));
  plus.setAttribute('aria-label', '放大画布');
  controls.append(minus, value, plus, button(doc, '复位', reset));
  host.append(viewport, controls);
  const observer = new ResizeObserver(reset);
  observer.observe(viewport);
  let drag: { id: number; x: number; y: number } | undefined;
  viewport.addEventListener('pointerdown', event => {
    if (!isCanvasPanButton(event.button) || (event.target as Element).closest('button')) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    x += event.clientX - drag.x;
    y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    paint();
  });
  const endDrag = () => { drag = undefined; viewport.classList.remove('is-dragging'); };
  viewport.addEventListener('lostpointercapture', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('auxclick', event => {
    if (isCanvasPanButton(event.button)) event.preventDefault();
  });
  viewport.addEventListener('wheel', event => {
    const intent = getCanvasWheelIntent(event);
    if (intent === 'scroll') return;
    event.preventDefault();
    zoom(scale + (intent === 'zoom-in' ? .08 : -.08));
  }, { passive: false });
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport) return;
    const moves: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    const move = moves[event.key];
    if (move) { x += move[0]; y += move[1]; paint(); }
    else if (event.key === '+' || event.key === '=') zoom(scale + .1);
    else if (event.key === '-') zoom(scale - .1);
    else if (event.key === 'Home') reset();
    else return;
    event.preventDefault();
  });
  return () => observer.disconnect();
}
