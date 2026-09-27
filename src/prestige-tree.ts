import { fmt } from './format';
import { prestigeStake } from './game';
import { BRANCHES, DEBTS, PRESTIGE_SKILLS, PRESTIGE_SKILL_IDS, type Branch, type PrestigeProgress, type PrestigeSkill } from './prestige';

/** A skill, or a debt by its index on the trunk. */
export type TreeSelection = PrestigeSkill | number;

export const TREE_COLORS: Record<Branch | 'trunk', string> = {
  pegs: '#a78bfa', buckets: '#34d399', balls: '#f472b6', pity: '#38bdf8', risk: '#fb7185', trunk: '#fbbf24',
};

/** 24×24 stroke icons, drawn in the current colour. */
const ICONS = {
  you: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  debt: '<path d="M5 2v20l2.3-1.5L9.7 22l2.3-1.5 2.3 1.5 2.4-1.5L19 22V2l-2.3 1.5L14.3 2 12 3.5 9.7 2 7.3 3.5Z"/><path d="M15 8h-4.5a2 2 0 0 0 0 4h3a2 2 0 0 1 0 4H9"/><path d="M12 6.5v11"/>',
  mystery: '<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  bouncyPegs: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  doublePegs: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.2-2.9L3 3"/><path d="m15 9 6-6"/>',
  beginnersLuck: '<path d="M12 12c-1.5-3.5-5.8-4.2-6.5-1.8-.6 2 1.8 3.4 6.5 1.8Zm0 0c3.5-1.5 4.2-5.8 1.8-6.5-2-.6-3.4 1.8-1.8 6.5Zm0 0c1.5 3.5 5.8 4.2 6.5 1.8.6-2-1.8-3.4-6.5-1.8Zm0 0c-3.5 1.5-4.2 5.8-1.8 6.5 2 .6 3.4-1.8 1.8-6.5Z"/><path d="M13.5 17.5c1 1.6 2.3 3 4 4"/>',
  bucketSlider: '<path d="M4 14h16l-2 7H6Z"/><path d="M4 7h16M8 3 4 7l4 4M16 3l4 4-4 4"/>',
  bouncyBalls: '<circle cx="15" cy="9" r="5"/><path d="M3 21c1.5-3.5 4-6.5 7.5-8M3.5 15H7M6 10.5h2.5"/>',
  rookieLuck: '<path d="m12 3 1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 16v5M16.5 18.5h5"/>',
  pityLuck: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>',
  startingMoney: '<circle cx="8" cy="8" r="6"/><path d="M18.1 10.4A6 6 0 1 1 10.3 18"/><path d="M7 6h1v4M16.7 13.9l.7.7-2.8 2.8"/>',
  greed: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5Z"/>',
  jackpotEdges: '<path d="M12 3a8 8 0 0 0-8 8c0 2.6 1.2 4.4 3 5.5V21h10v-4.5c1.8-1.1 3-2.9 3-5.5a8 8 0 0 0-8-8Z"/><circle cx="9" cy="11.5" r="1.6"/><circle cx="15" cy="11.5" r="1.6"/><path d="M10 21v-2.5M14 21v-2.5"/>',
} satisfies Record<string, string>;
export type IconName = keyof typeof ICONS;

export function iconSvg(name: IconName): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/** Degrees clockwise from north. The trunk owns north; branches fill the other five points of a hexagon. */
const DIRECTION: Record<Branch, number> = { pegs: -60, buckets: -120, balls: 180, pity: 120, risk: 60 };
const BRANCH_STEP = 190;
const TRUNK_STEP = 175;
const RING = 2 * Math.PI * 46;
const SVG_NS = 'http://www.w3.org/2000/svg';

const along = (degrees: number, distance: number) => ({
  x: Math.round(Math.sin(degrees * Math.PI / 180) * distance),
  y: Math.round(-Math.cos(degrees * Math.PI / 180) * distance),
});
const money = (value: number): string => '$' + fmt(value);

interface TreeNode {
  el: HTMLButtonElement;
  ring: SVGCircleElement;
  icon: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
  badge: HTMLElement;
  x: number;
  y: number;
  color: string;
}
interface TreeEdge { from: string; to: string; line: SVGPathElement; glow: SVGPathElement; flow: SVGPathElement; }

/**
 * The Prestige skill tree as a pannable constellation: debts rise north from "You",
 * and each branch grows outward from the same root.
 */
export class PrestigeTree {
  private nodes = new Map<string, TreeNode>();
  private edges: TreeEdge[] = [];
  private rootMeta!: HTMLElement;
  private view = { x: 0, y: 0, scale: 1 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pan: { x: number; y: number; viewX: number; viewY: number } | null = null;
  private pinch: { distance: number; scale: number } | null = null;
  private dragged = false;

  constructor(
    private viewport: HTMLElement,
    private world: HTMLElement,
    private onSelect: (selection: TreeSelection) => void,
    /** Screen space covered by floating panels, so fitting keeps nodes visible. */
    private insets: () => { top: number; right: number; bottom: number } = () => ({ top: 0, right: 0, bottom: 0 }),
  ) {
    this.build();
    this.bindGestures();
  }

  static key(selection: TreeSelection): string {
    return typeof selection === 'number' ? `debt${selection}` : selection;
  }

  private build(): void {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('tree-edges');
    // Faint orbits give the constellation its scale.
    for (const radius of [BRANCH_STEP, BRANCH_STEP * 2, BRANCH_STEP * 3]) {
      const orbit = document.createElementNS(SVG_NS, 'circle');
      orbit.classList.add('tree-orbit');
      orbit.setAttribute('r', String(radius));
      svg.append(orbit);
    }
    const root = document.createElement('div');
    root.className = 'tn tn-root';
    root.innerHTML = `<span class="tn-orb"><span class="tn-icon">${iconSvg('you')}</span></span>
      <span class="tn-label"><strong>You</strong><span class="tn-meta"></span></span>`;
    this.rootMeta = root.querySelector('.tn-meta')!;
    this.world.replaceChildren(svg, root);

    const addEdge = (from: string, to: string) => {
      const [glow, line, flow] = ['glow', 'line', 'flow'].map(kind => {
        const path = document.createElementNS(SVG_NS, 'path');
        path.classList.add(`edge-${kind}`);
        return path;
      });
      svg.append(glow, line, flow);
      this.edges.push({ from, to, line, glow, flow });
    };

    for (const { id: branch, title } of BRANCHES) {
      const skills = PRESTIGE_SKILL_IDS.filter(id => PRESTIGE_SKILLS[id].branch === branch);
      const color = TREE_COLORS[branch];
      skills.forEach((id, i) => {
        const { x, y } = along(DIRECTION[branch], BRANCH_STEP * (i + 1));
        this.addNode(id, id, x, y, color, id);
        addEdge(i === 0 ? 'root' : skills[i - 1], id);
      });
      const tag = document.createElement('span');
      tag.className = 'tree-branch-tag';
      tag.textContent = title;
      tag.style.setProperty('--c', color);
      const at = along(DIRECTION[branch], BRANCH_STEP * .6);
      tag.style.left = `${at.x}px`;
      tag.style.top = `${at.y}px`;
      this.world.append(tag);
    }
    DEBTS.forEach((_, i) => {
      this.addNode(`debt${i}`, i, 0, -TRUNK_STEP * (i + 1), TREE_COLORS.trunk, 'debt', 'tn-debt');
      addEdge(i === 0 ? 'root' : `debt${i - 1}`, `debt${i}`);
    });
    for (const edge of this.edges) {
      const a = this.position(edge.from);
      const b = this.position(edge.to);
      const d = `M${a.x} ${a.y}L${b.x} ${b.y}`;
      for (const path of [edge.line, edge.glow, edge.flow]) path.setAttribute('d', d);
      const color = this.nodes.get(edge.to)!.color;
      edge.line.style.setProperty('--c', color);
      edge.glow.style.setProperty('--c', color);
      edge.flow.style.setProperty('--c', color);
      if (edge.to.startsWith('debt')) [edge.line, edge.glow, edge.flow].forEach(path => path.classList.add('edge-trunk'));
    }
  }

  private addNode(key: string, selection: TreeSelection, x: number, y: number, color: string, icon: IconName, extra = ''): void {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `tn ${extra}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--c', color);
    el.innerHTML = `<span class="tn-orb">
        <svg class="tn-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="tn-ring-track" cx="50" cy="50" r="46"/><circle class="tn-ring-fill" cx="50" cy="50" r="46"/></svg>
        <span class="tn-icon">${iconSvg(icon)}</span>
        <span class="tn-badge"></span>
      </span>
      <span class="tn-label"><strong></strong><span class="tn-meta"></span></span>`;
    el.addEventListener('click', () => this.onSelect(selection));
    this.world.append(el);
    const ring = el.querySelector<SVGCircleElement>('.tn-ring-fill')!;
    ring.style.strokeDasharray = String(RING);
    this.nodes.set(key, { el, ring, icon: el.querySelector('.tn-icon')!, title: el.querySelector('strong')!, meta: el.querySelector('.tn-meta')!,
      badge: el.querySelector('.tn-badge')!, x, y, color });
  }

  private position(key: string): { x: number; y: number } {
    return key === 'root' ? { x: 0, y: 0 } : this.nodes.get(key)!;
  }

  private visible(key: string): boolean {
    return key === 'root' || !this.nodes.get(key)!.el.hidden;
  }

  private owned(key: string): boolean {
    return key === 'root' || this.nodes.get(key)!.el.classList.contains('is-owned');
  }

  render(progress: PrestigeProgress | null, selection: TreeSelection): void {
    const selected = PrestigeTree.key(selection);
    for (const id of PRESTIGE_SKILL_IDS) {
      const node = this.nodes.get(id)!;
      const { title, max } = PRESTIGE_SKILLS[id];
      const level = progress?.level(id) ?? 0;
      const locked = !progress || progress.locked(id);
      const maxed = level >= max;
      node.title.textContent = title;
      node.meta.textContent = locked ? 'Locked' : maxed ? 'Maxed' : money(progress.cost(id));
      node.badge.innerHTML = locked ? iconSvg('lock') : maxed && max === 1 ? iconSvg('check') : level > 0 ? `${level}/${max}` : '';
      node.ring.style.strokeDashoffset = String(RING * (1 - level / max));
      this.setState(node, { locked, owned: level > 0, maxed, affordable: !!progress?.canBuy(id), selected: selected === id });
    }
    const paid = progress?.debtsPaid ?? 0;
    DEBTS.forEach((debt, i) => {
      const node = this.nodes.get(`debt${i}`)!;
      const done = i < paid;
      const next = i === paid;
      const mystery = i === paid + 1;
      node.el.hidden = !(done || next || mystery);
      node.el.disabled = mystery;
      node.el.classList.toggle('tn-next', next);
      node.el.classList.toggle('is-mystery', mystery);
      node.icon.innerHTML = iconSvg(mystery ? 'mystery' : 'debt');
      node.title.textContent = mystery ? '???' : debt.title;
      node.meta.textContent = done ? `${money(prestigeStake(i + 1))} balls unlocked` : next ? money(debt.cost) : 'Pay the debt below';
      node.badge.innerHTML = done ? iconSvg('check') : '';
      node.ring.style.strokeDashoffset = String(done ? 0 : next ? RING * (1 - Math.min(1, (progress?.wallet ?? 0) / debt.cost)) : RING);
      this.setState(node, { locked: mystery, owned: done, maxed: done, affordable: next && !!progress?.canPayDebt(), selected: selected === `debt${i}` });
    });
    this.rootMeta.textContent = `${paid} of ${DEBTS.length} debts paid`;
    for (const edge of this.edges) {
      const shown = this.visible(edge.from) && this.visible(edge.to);
      const lit = shown && this.owned(edge.from);
      const live = lit && this.owned(edge.to);
      for (const path of [edge.line, edge.glow, edge.flow]) {
        path.classList.toggle('is-hidden', !shown);
        path.classList.toggle('is-lit', lit);
        path.classList.toggle('is-live', live);
      }
    }
  }

  private setState(node: TreeNode, state: { locked: boolean; owned: boolean; maxed: boolean; affordable: boolean; selected: boolean }): void {
    node.el.classList.toggle('is-locked', state.locked);
    node.el.classList.toggle('is-owned', state.owned);
    node.el.classList.toggle('is-maxed', state.maxed);
    node.el.classList.toggle('is-affordable', state.affordable && !state.maxed);
    node.el.setAttribute('aria-pressed', String(state.selected));
    node.el.setAttribute('aria-label', `${node.title.textContent}, ${node.meta.textContent}`);
  }

  /** A burst of light on the node that was just bought. */
  celebrate(selection: TreeSelection): void {
    const el = this.nodes.get(PrestigeTree.key(selection))?.el;
    if (!el) return;
    el.classList.remove('is-bought');
    void el.offsetWidth;
    el.classList.add('is-bought');
    window.setTimeout(() => el.classList.remove('is-bought'), 1200);
  }

  /** Frame the whole tree, or the root and the next debt when the trunk is too tall. */
  fit(): void {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (!width || !height) return;
    const { top, right, bottom } = this.insets();
    const availableW = Math.max(200, width - right);
    const availableH = Math.max(200, height - top - bottom);
    const shown = [{ x: 0, y: 0 }, ...[...this.nodes.values()].filter(node => !node.el.hidden)];
    const pad = 100;
    const minX = Math.min(...shown.map(n => n.x)) - pad;
    const maxX = Math.max(...shown.map(n => n.x)) + pad;
    const minY = Math.min(...shown.map(n => n.y)) - pad;
    const maxY = Math.max(...shown.map(n => n.y)) + pad + 30;
    const scale = Math.max(.36, Math.min(1.05, availableW / (maxX - minX), availableH / (maxY - minY)));
    this.view.scale = scale;
    this.view.x = availableW / 2 - ((minX + maxX) / 2) * scale;
    // A trunk taller than the screen starts at its top, where the next debt waits.
    this.view.y = top + ((maxY - minY) * scale <= availableH ? availableH / 2 - ((minY + maxY) / 2) * scale : -minY * scale);
    this.apply(false);
  }

  zoomBy(factor: number): void {
    const { top, right, bottom } = this.insets();
    const rect = this.viewport.getBoundingClientRect();
    this.zoomAt(rect.left + (rect.width - right) / 2, rect.top + top + (rect.height - top - bottom) / 2, factor);
  }

  private zoomAt(clientX: number, clientY: number, factor: number): void {
    const rect = this.viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const scale = Math.max(.35, Math.min(1.8, this.view.scale * factor));
    this.view.x = px - (px - this.view.x) * (scale / this.view.scale);
    this.view.y = py - (py - this.view.y) * (scale / this.view.scale);
    this.view.scale = scale;
    this.apply(false);
  }

  private apply(animate: boolean): void {
    this.world.classList.toggle('is-gliding', animate);
    this.world.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.scale})`;
    this.viewport.style.setProperty('--grid-x', `${this.view.x}px`);
    this.viewport.style.setProperty('--grid-y', `${this.view.y}px`);
  }

  /** Drag to pan, wheel or pinch to zoom. A drag never counts as a click on a node. */
  private bindGestures(): void {
    const vp = this.viewport;
    vp.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.pan = { x: e.clientX, y: e.clientY, viewX: this.view.x, viewY: this.view.y };
        this.dragged = false;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: this.view.scale };
        this.pan = null;
      }
    });
    vp.addEventListener('pointermove', e => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const target = this.pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / this.pinch.distance;
        this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, target / this.view.scale);
        this.dragged = true;
        return;
      }
      if (!this.pan) return;
      const dx = e.clientX - this.pan.x;
      const dy = e.clientY - this.pan.y;
      if (!this.dragged && Math.hypot(dx, dy) < 6) return;
      if (!this.dragged) {
        this.dragged = true;
        vp.setPointerCapture(e.pointerId);
        vp.classList.add('is-panning');
      }
      this.view.x = this.pan.viewX + dx;
      this.view.y = this.pan.viewY + dy;
      this.apply(false);
    });
    const release = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.pointers.size === 0) {
        this.pan = null;
        vp.classList.remove('is-panning');
      }
    };
    vp.addEventListener('pointerup', release);
    vp.addEventListener('pointercancel', release);
    vp.addEventListener('click', e => {
      if (!this.dragged) return;
      e.stopPropagation();
      e.preventDefault();
      this.dragged = false;
    }, true);
    vp.addEventListener('wheel', e => {
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015)));
    }, { passive: false });
  }
}
