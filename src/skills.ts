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
/** Smooth bias toward the triangle's center, with every interior peg still eligible. */
export function pegSpawnWeight(id: string, rows: number): number {
  const [row, column] = id.split(':').map(Number);
  const x = (column - (row + 2) / 2) / (rows / 4);
  const y = (row - (rows - 1) * 2 / 3) / (rows / 3);
  return .15 + Math.exp(-(x * x + y * y) / 2);
}
function weightedPeg(choices: string[], rows: number, random: () => number): string {
  const weights = choices.map(id => pegSpawnWeight(id, rows));
  let roll = Math.max(0, Math.min(1, random())) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < choices.length; i++) {
    roll -= weights[i];
    if (roll < 0) return choices[i];
  }
  return choices[choices.length - 1];
}
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
      : 10 * 2 ** this.level(kind);
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
  private assigned: Record<ChargeKind, Map<string, number>> = { bouncy: new Map(), split: new Map(), bucket: new Map() };
  private charged: Record<ChargeKind, Map<string, number>> = { bouncy: new Map(), split: new Map(), bucket: new Map() };

  constructor(readonly rows: number, skills: SkillTree | null, private random = Math.random) { this.sync(skills); }
  /** Newly purchased unlocks add one charge; previously consumed charges stay spent. */
  sync(skills: SkillTree | null): void {
    for (const kind of CHARGES) {
      const all = targets(kind, this.rows);
      const count = Math.min(skills?.level(kind) ?? 0, all.length);
      const assignedCount = () => [...this.assigned[kind].values()].reduce((sum, value) => sum + value, 0);
      while (assignedCount() < count) {
        let id: string;
        if (kind === 'bucket') {
          const choices = all.filter(choice => !this.assigned.bucket.has(choice));
          const index = Math.min(choices.length - 1, Math.max(0, Math.floor(this.random() * choices.length)));
          id = choices[index];
        } else {
          id = weightedPeg(all, this.rows, this.random);
          if (this.assigned.bouncy.has(id) || this.assigned.split.has(id)) {
            // Reroll exactly once. If that peg is occupied too, all upgrades stack there.
            id = weightedPeg(all, this.rows, this.random);
          }
        }
        this.assigned[kind].set(id, (this.assigned[kind].get(id) ?? 0) + 1);
        this.charged[kind].set(id, (this.charged[kind].get(id) ?? 0) + 1);
      }
    }
  }
  remaining(kind: ChargeKind): readonly string[] {
    return [...this.charged[kind]].flatMap(([id, count]) => Array<string>(count).fill(id));
  }
  consume(kind: ChargeKind, id: string): boolean {
    const count = this.charged[kind].get(id) ?? 0;
    if (count <= 0) return false;
    if (count === 1) this.charged[kind].delete(id);
    else this.charged[kind].set(id, count - 1);
    return true;
  }
  payouts(base: number[]): number[] {
    return base.map((value, k) => this.charged.bucket.has(String(k)) ? luckyBucketReturn(value) : value);
  }
}
