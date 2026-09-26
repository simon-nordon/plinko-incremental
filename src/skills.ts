import { MAX_ROWS } from './config';
import { GameRun, type GameMode } from './game';

export type ChargeKind = 'bouncy' | 'split' | 'bucket';
export type SkillKind = ChargeKind | 'starting';
export const CHARGES: readonly ChargeKind[] = ['bouncy', 'split', 'bucket'];
export const SKILLS: readonly SkillKind[] = [...CHARGES, 'starting'];
export const STARTING_DROPS = [100, 150, 250, 500] as const;
export const pegIds = (rows: number): string[] => Array.from({ length: rows }, (_, row) =>
  Array.from({ length: row + 3 }, (_, column) => `${row}:${column}`)).flat();
const targets = (kind: ChargeKind, rows: number): string[] => kind === 'bucket'
  ? Array.from({ length: rows + 1 }, (_, i) => String(i)) : pegIds(rows);
export const luckyBucketReturn = (base: number): number => Math.floor(base + 1e-9) + 1;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
type Levels = Record<SkillKind, number>;

/** Only unlock counts persist. Old experimental saves remain untouched. */
export class SkillTree {
  readonly key: string;
  private levels: Levels = { bouncy: 0, split: 0, bucket: 0, starting: 0 };

  constructor(readonly mode: GameMode, private storage: Storage) {
    this.key = `plinko-skills-${mode}-v2`;
    const raw = storage.getItem(this.key);
    if (raw === null) return;
    const saved = JSON.parse(raw);
    if (saved?.version !== 2 || !saved.levels || SKILLS.some(kind =>
      !Number.isSafeInteger(saved.levels[kind]) || saved.levels[kind] < 0
      || saved.levels[kind] > this.maximum(kind, MAX_ROWS))) throw new Error('Invalid skill save');
    this.levels = { ...saved.levels };
  }
  maximum(kind: SkillKind, rows: number): number { return kind === 'starting' ? STARTING_DROPS.length - 1 : targets(kind, rows).length; }
  level(kind: SkillKind): number { return this.mode === 'double' ? this.levels[kind] : 0; }
  get startingDrop(): number { return STARTING_DROPS[this.level('starting')]; }
  cost(kind: SkillKind): number {
    return kind === 'starting' ? (STARTING_DROPS[this.level(kind) + 1] ?? Infinity) * 10 : 25 * 2 ** this.level(kind);
  }
  canBuy(run: GameRun, rows: number, kind: SkillKind): boolean {
    return this.mode === 'double' && run.mode === this.mode && run.canSpend(this.cost(kind))
      && this.level(kind) < this.maximum(kind, rows);
  }
  buy(run: GameRun, rows: number, kind: SkillKind): boolean {
    if (!this.canBuy(run, rows, kind)) return false;
    const levels = { ...this.levels, [kind]: this.level(kind) + 1 };
    this.storage.setItem(this.key, JSON.stringify({ version: 2, levels }));
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
