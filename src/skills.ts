import { MAX_ROWS } from './config';
import { GameRun, type GameMode } from './game';

export type ChargeKind = 'bouncy' | 'split' | 'bucket';
export type SkillKind = ChargeKind | 'starting';
export const CHARGES: readonly ChargeKind[] = ['bouncy', 'split', 'bucket'];
export const SKILLS: readonly SkillKind[] = [...CHARGES, 'starting'];
const EARLY_STARTS = [10, 20, 50, 100, 150, 250, 500];
const STARTING_STEPS = [1, 1.5, 2.5, 5];
/** No gameplay cap: continue the same progression at each power of ten. */
export function startingDropAt(level: number): number {
  if (!Number.isSafeInteger(level) || level < 0) return NaN;
  const offset = level - EARLY_STARTS.length;
  return offset < 0 ? EARLY_STARTS[level]
    : STARTING_STEPS[offset % STARTING_STEPS.length] * 10 ** (3 + Math.floor(offset / STARTING_STEPS.length));
}
export const pegIds = (rows: number): string[] => Array.from({ length: rows }, (_, row) =>
  Array.from({ length: row + 3 }, (_, column) => `${row}:${column}`)).flat();
export const interiorPegIds = (rows: number): string[] => pegIds(rows).filter(id => {
  const [row, column] = id.split(':').map(Number);
  return column > 0 && column < row + 2;
});
const targets = (kind: ChargeKind, rows: number): string[] => kind === 'bucket'
  ? Array.from({ length: rows + 1 }, (_, i) => String(i)) : interiorPegIds(rows);
export const luckyBucketReturn = (base: number): number => base * 2;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Levels = Record<SkillKind, number>;

/** Only unlock counts persist. Prior saves remain available for migration. */
export class SkillTree {
  readonly key: string;
  private levels: Levels = { bouncy: 0, split: 0, bucket: 0, starting: 0 };

  constructor(readonly mode: GameMode, private storage: Storage) {
    this.key = `plinko-skills-${mode}-v4`;
    const current = storage.getItem(this.key);
    const raw = current ?? storage.getItem(`plinko-skills-${mode}-v3`) ?? storage.getItem(`plinko-skills-${mode}-v2`);
    if (raw === null) return;
    const saved = JSON.parse(raw);
    const migrating = current === null && (saved?.version === 2 || saved?.version === 3);
    if ((!migrating && saved?.version !== 4) || !saved.levels) throw new Error('Invalid skill save');
    if (migrating && saved.version === 2 && saved.levels.starting > 3) throw new Error('Invalid legacy starting level');
    const levels = { ...saved.levels };
    // Previously purchased $150/$250/$500 starts keep their value; the base becomes $10.
    if (migrating && levels.starting > 0) levels.starting += saved.version === 2 ? 3 : 1;
    if (SKILLS.some(kind => !Number.isSafeInteger(levels[kind]) || levels[kind] < 0
      || (kind === 'starting' ? !Number.isFinite(startingDropAt(levels[kind]) * 10)
        : levels[kind] > (kind === 'bucket' ? MAX_ROWS + 1 : pegIds(MAX_ROWS).length)))) {
      throw new Error('Invalid skill save');
    }
    this.levels = levels;
  }
  maximum(kind: SkillKind, rows: number): number { return kind === 'starting' ? Infinity : targets(kind, rows).length; }
  level(kind: SkillKind): number { return this.mode === 'double' ? this.levels[kind] : 0; }
  get startingDrop(): number { return startingDropAt(this.level('starting')); }
  cost(kind: SkillKind): number {
    return kind === 'starting' ? startingDropAt(this.level(kind) + 1) * 10
      : (kind === 'bucket' ? 25 : 10) * 2 ** this.level(kind);
  }
  canBuy(run: GameRun, rows: number, kind: SkillKind): boolean {
    return this.mode === 'double' && run.mode === this.mode && run.canSpend(this.cost(kind))
      && this.level(kind) < this.maximum(kind, rows);
  }
  buy(run: GameRun, rows: number, kind: SkillKind): boolean {
    if (!this.canBuy(run, rows, kind)) return false;
    const levels = { ...this.levels, [kind]: this.level(kind) + 1 };
    this.storage.setItem(this.key, JSON.stringify({ version: 4, levels }));
    run.spend(this.cost(kind));
    this.levels = levels;
    return true;
  }
}

/** A life owns its assignments and consumed charges, independent of board redraws. */
export class LifeSkills {
  private assigned: Record<ChargeKind, Set<string>> = { bouncy: new Set(), split: new Set(), bucket: new Set() };
  private charged: Record<ChargeKind, Set<string>> = { bouncy: new Set(), split: new Set(), bucket: new Set() };

  constructor(readonly rows: number, skills: SkillTree | null, private random = Math.random) { this.sync(skills); }
  /** Newly purchased unlocks add one charge; previously consumed charges stay spent. */
  sync(skills: SkillTree | null): void {
    for (const kind of CHARGES) {
      const choices = targets(kind, this.rows).filter(id => !this.assigned[kind].has(id));
      const count = Math.min(skills?.level(kind) ?? 0, targets(kind, this.rows).length);
      while (this.assigned[kind].size < count && choices.length) {
        const index = Math.min(choices.length - 1, Math.max(0, Math.floor(this.random() * choices.length)));
        const [id] = choices.splice(index, 1);
        this.assigned[kind].add(id);
        this.charged[kind].add(id);
      }
    }
  }
  remaining(kind: ChargeKind): readonly string[] { return [...this.charged[kind]]; }
  consume(kind: ChargeKind, id: string): boolean { return this.charged[kind].delete(id); }
  payouts(base: number[]): number[] {
    return base.map((value, k) => this.charged.bucket.has(String(k)) ? luckyBucketReturn(value) : value);
  }
}
