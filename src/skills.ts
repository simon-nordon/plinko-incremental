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
  private pity = 0;
  private lucky: string[] = [];
  private duplicate: string[] = [];
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
      || (saved.pity !== undefined && typeof saved.pity !== 'boolean')
      || (saved.pityLevel !== undefined && (!Number.isSafeInteger(saved.pityLevel) || saved.pityLevel < 0))) {
      throw new Error('Invalid skill save');
    }
    this.owned = [...saved.bouncyPegs];
    this.returns = saved.returnLevel ?? 0;
    this.pity = saved.pityLevel ?? Number(saved.pity ?? false);
    const lucky = saved.luckyPegs ?? [];
    const duplicate = saved.duplicatePegs ?? [];
    if (!Array.isArray(lucky) || !Array.isArray(duplicate)) throw new Error('Invalid peg save');
    const all = [...this.owned, ...lucky, ...duplicate];
    if (all.some(id => !validPegs.has(id)) || new Set(all).size !== all.length) throw new Error('Invalid peg save');
    this.lucky = lucky;
    this.duplicate = duplicate;
  }

  get bouncyPegs(): readonly string[] { return this.mode === 'double' ? this.owned : []; }
  get level(): number { return this.bouncyPegs.length; }
  get cost(): number { return 50 * 2 ** this.level; }
  get returnLevel(): number { return this.mode === 'double' ? this.returns : 0; }
  get returnMultiplier(): number { return 1 + this.returnLevel * 0.05; }
  get returnCost(): number { return 50 * 2 ** this.returnLevel; }
  get pityLevel(): number { return this.mode === 'double' ? this.pity : 0; }
  get hasPity(): boolean { return this.pityLevel > 0; }
  get pityCost(): number { return 50 * 2 ** this.pityLevel; }
  get luckyPegs(): readonly string[] { return this.mode === 'double' ? this.lucky : []; }
  get duplicatePegs(): readonly string[] { return this.mode === 'double' ? this.duplicate : []; }
  pegCost(kind: 'lucky' | 'duplicate'): number { return 50 * 2 ** (kind === 'lucky' ? this.luckyPegs.length : this.duplicatePegs.length); }
  canBuyPeg(run: GameRun, rows: number, kind: 'lucky' | 'duplicate'): boolean {
    return this.mode === 'double' && run.mode === this.mode && run.canSpend(this.pegCost(kind)) && this.available(rows).length > 0;
  }
  buyPeg(run: GameRun, rows: number, kind: 'lucky' | 'duplicate', random = Math.random): string | null {
    if (!this.canBuyPeg(run, rows, kind)) return null;
    const choices = this.available(rows);
    const id = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    const cost = this.pegCost(kind);
    const lucky = kind === 'lucky' ? [...this.lucky, id] : this.lucky;
    const duplicate = kind === 'duplicate' ? [...this.duplicate, id] : this.duplicate;
    this.save(this.owned, this.returns, this.pity, lucky, duplicate);
    run.spend(cost);
    this.lucky = lucky;
    this.duplicate = duplicate;
    return id;
  }
  pityActive(balanceBeforeDrop: number): boolean {
    return this.hasPity && balanceBeforeDrop < 100;
  }
  improvePayouts(payouts: number[], balanceBeforeDrop = Infinity): number[] {
    const pityMultiplier = this.pityActive(balanceBeforeDrop) ? 1 + this.pityLevel * .05 : 1;
    return payouts.map(value => value * this.returnMultiplier * pityMultiplier);
  }
  canBuyPity(run: GameRun): boolean {
    return this.mode === 'double' && run.mode === this.mode && run.canSpend(this.pityCost);
  }
  buyPity(run: GameRun): boolean {
    if (!this.canBuyPity(run)) return false;
    this.save(this.owned, this.returns, this.pity + 1);
    run.spend(this.pityCost);
    this.pity++;
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
  private save(bouncyPegs: string[], returnLevel: number, pityLevel = this.pity, luckyPegs = this.lucky, duplicatePegs = this.duplicate): void {
    this.storage.setItem(this.key, JSON.stringify({ version: 1, bouncyPegs, returnLevel, pityLevel, luckyPegs, duplicatePegs }));
  }
  available(rows: number): string[] {
    const owned = new Set([...this.bouncyPegs, ...this.luckyPegs, ...this.duplicatePegs]);
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
