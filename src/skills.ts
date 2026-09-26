import { MAX_ROWS } from './config';
import { GameRun, type GameMode } from './game';

export const pegIds = (rows: number): string[] => Array.from({ length: rows }, (_, row) =>
  Array.from({ length: row + 3 }, (_, column) => `${row}:${column}`)).flat();

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const validPegs = new Set(pegIds(MAX_ROWS));

/** Each mode owns its progression. Runs can end without touching this save. */
export class SkillTree {
  private owned: string[] = [];
  private returns = 0;
  private pity = false;
  readonly key: string;

  constructor(readonly mode: GameMode, private storage: Storage) {
    this.key = `plinko-skills-${mode}-v1`;
    const raw = storage.getItem(this.key);
    if (raw === null) return;
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Array.isArray(saved.bouncyPegs)
      || saved.bouncyPegs.some((id: unknown) => typeof id !== 'string' || !validPegs.has(id))
      || new Set(saved.bouncyPegs).size !== saved.bouncyPegs.length
      || (saved.returnLevel !== undefined && (!Number.isSafeInteger(saved.returnLevel) || saved.returnLevel < 0))
      || (saved.pity !== undefined && typeof saved.pity !== 'boolean')) {
      throw new Error('Invalid skill save');
    }
    this.owned = [...saved.bouncyPegs];
    this.returns = saved.returnLevel ?? 0;
    this.pity = saved.pity ?? false;
  }

  get bouncyPegs(): readonly string[] { return this.mode === 'double' ? this.owned : []; }
  get level(): number { return this.bouncyPegs.length; }
  get cost(): number { return 50 * 2 ** this.level; }
  get returnLevel(): number { return this.mode === 'double' ? this.returns : 0; }
  get returnMultiplier(): number { return 1 + this.returnLevel * 0.05; }
  get returnCost(): number { return 50 * 2 ** this.returnLevel; }
  get hasPity(): boolean { return this.mode === 'double' && this.pity; }
  readonly pityCost = 50;
  pityActive(balanceBeforeDrop: number): boolean {
    return this.hasPity && balanceBeforeDrop < 100;
  }
  improvePayouts(payouts: number[], balanceBeforeDrop = Infinity): number[] {
    const pityMultiplier = this.pityActive(balanceBeforeDrop) ? 1.05 : 1;
    return payouts.map(value => value * this.returnMultiplier * pityMultiplier);
  }
  canBuyPity(run: GameRun): boolean {
    return this.mode === 'double' && run.mode === this.mode && !this.hasPity && run.canSpend(this.pityCost);
  }
  buyPity(run: GameRun): boolean {
    if (!this.canBuyPity(run)) return false;
    this.save(this.owned, this.returns, true);
    run.spend(this.pityCost);
    this.pity = true;
    return true;
  }
  canBuyReturn(run: GameRun): boolean {
    return this.mode === 'double' && run.mode === this.mode && run.canSpend(this.returnCost);
  }
  buyReturn(run: GameRun): boolean {
    if (!this.canBuyReturn(run)) return false;
    this.save(this.owned, this.returns + 1);
    run.spend(this.returnCost);
    this.returns++;
    return true;
  }
  private save(bouncyPegs: string[], returnLevel: number, pity = this.pity): void {
    this.storage.setItem(this.key, JSON.stringify({ version: 1, bouncyPegs, returnLevel, pity }));
  }
  available(rows: number): string[] {
    const owned = new Set(this.bouncyPegs);
    return pegIds(rows).filter(id => !owned.has(id));
  }
  canBuy(run: GameRun, rows: number): boolean {
    return this.mode === 'double' && run.mode === this.mode && run.canSpend(this.cost)
      && this.available(rows).length > 0;
  }

  /** Persist first: failed storage must never charge the player's balance. */
  buy(run: GameRun, rows: number, random = Math.random): string | null {
    if (!this.canBuy(run, rows)) return null;
    const choices = this.available(rows);
    const id = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
    const next = [...this.owned, id];
    const cost = this.cost;
    this.save(next, this.returns);
    run.spend(cost);
    this.owned = next;
    return id;
  }
}
