import { MAX_ROWS } from './config';
import { GameRun, type OneBallSettings } from './game';
import { interiorPegIds, type ChargeKind } from './skills';

export type IncrementalKind = 'capacity' | 'value' | ChargeKind | 'cashback';
export const INCREMENTAL_SKILLS: readonly IncrementalKind[] = ['capacity', 'value', 'bouncy', 'split', 'bucket', 'cashback'];
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const PRICES: Record<IncrementalKind, [number, number]> = {
  capacity: [5, 1.6], value: [2, 1.35], bouncy: [4, 1.8], split: [8, 1.8], bucket: [6, 1.8], cashback: [3, 1.5],
};

/** Independent permanent progression for fixed-price $1 drops. */
export class IncrementalSkills {
  readonly key = 'plinko-skills-oneball-v1';
  private levels: Record<IncrementalKind, number> = { capacity: 0, value: 0, bouncy: 0, split: 0, bucket: 0, cashback: 0 };

  constructor(private storage: Storage) {
    const raw = storage.getItem(this.key);
    if (raw === null) return;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !saved.levels || INCREMENTAL_SKILLS.some(kind => {
      const level = saved.levels[kind];
      return !Number.isSafeInteger(level) || level < 0 || level > this.maximum(kind, MAX_ROWS)
        || !Number.isFinite(PRICES[kind][0] * PRICES[kind][1] ** level);
    })) throw new Error('Invalid One Ball skill save');
    this.levels = { ...saved.levels };
  }
  level(kind: IncrementalKind): number { return this.levels[kind]; }
  maximum(kind: IncrementalKind, rows: number): number {
    if (kind === 'capacity') return 45;
    if (kind === 'cashback') return 20;
    if (kind === 'value') return Infinity;
    return kind === 'bucket' ? rows + 1 : interiorPegIds(rows).length;
  }
  get settings(): OneBallSettings {
    return { maxBalls: 5 + this.level('capacity'), ballValue: 1.05 ** this.level('value'), cashback: this.level('cashback') / 20 };
  }
  cost(kind: IncrementalKind): number {
    const [base, growth] = PRICES[kind];
    return Math.ceil(base * growth ** this.level(kind) * 100) / 100;
  }
  canBuy(run: GameRun, rows: number, kind: IncrementalKind): boolean {
    return run.mode === 'oneball' && this.level(kind) < this.maximum(kind, rows) && run.canSpend(this.cost(kind));
  }
  buy(run: GameRun, rows: number, kind: IncrementalKind): boolean {
    if (!this.canBuy(run, rows, kind)) return false;
    const levels = { ...this.levels, [kind]: this.level(kind) + 1 };
    this.storage.setItem(this.key, JSON.stringify({ version: 1, levels }));
    run.spend(this.cost(kind));
    this.levels = levels;
    run.setOneBallSettings(this.settings);
    return true;
  }
}
