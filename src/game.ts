import { START_MONEY } from './config';
import { ballTier } from './tiers';

export type GameMode = 'classic' | 'double';
export const startingBalance = (mode: GameMode): number => mode === 'double' ? 0 : START_MONEY;
const cents = (value: number): number => Math.abs(value) < Number.MAX_SAFE_INTEGER / 100 ? Math.round(value * 100) / 100 : value;

export interface Wager { id: number; tier: number; amount: number; cost: number; }

/** Balances and outstanding bets for one life, independent of animation. */
export class GameRun {
  balance: number;
  peak: number;
  drops = 0;
  private houseAvailable: boolean;
  private wagers = new Map<number, Wager & { remaining: number; remainingShare: number; paid: number; rawPaid: number }>();

  constructor(readonly mode: GameMode, readonly houseStake = 10) {
    this.balance = this.peak = startingBalance(mode);
    this.houseAvailable = mode === 'double';
  }
  get houseDropAvailable(): boolean { return this.houseAvailable; }
  get active(): number { return this.wagers.size; }
  get minimumBet(): number { return this.mode === 'double' ? cents(Math.max(this.houseStake * .1, this.peak * .05)) : 1; }
  get busted(): boolean { return !this.houseAvailable && this.balance < this.minimumBet && this.active === 0; }
  get inPlay(): number { return [...this.wagers.values()].reduce((sum, bet) => sum + bet.amount * bet.remainingShare, 0); }

  canSpend(amount: number): boolean {
    return !this.houseAvailable && !this.busted && this.active === 0 && Number.isFinite(amount) && amount > 0
      && amount <= this.balance && cents(this.balance - amount) >= this.minimumBet;
  }
  spend(amount: number): boolean {
    if (!this.canSpend(amount)) return false;
    this.balance = cents(this.balance - amount);
    return true;
  }
  drop(tier: number): Wager | null {
    if (this.busted || (this.mode === 'double' && this.active > 0)) return null;
    const tierIndex = this.mode === 'double' ? 0 : tier;
    const amount = this.houseAvailable ? this.houseStake : this.mode === 'double' ? this.balance : ballTier(tierIndex)?.cost;
    if (amount === undefined || amount < this.minimumBet || (!this.houseAvailable && amount > this.balance)) return null;
    const cost = this.houseAvailable ? 0 : amount;
    const bet = { id: ++this.drops, tier: tierIndex, amount, cost };
    this.houseAvailable = false;
    this.balance = cents(this.balance - cost);
    this.wagers.set(bet.id, { ...bet, remaining: 1, remainingShare: 1, paid: 0, rawPaid: 0 });
    return bet;
  }
  /** A split adds a ball that shares the original wager without an extra charge. */
  duplicate(id: number): boolean {
    const wager = this.wagers.get(id);
    if (!wager) return false;
    wager.remaining++;
    return true;
  }
  settle(id: number, multiplier: number, costShare = 1): { wager: Wager; payout: number; profit: number; complete: boolean; totalProfit: number; totalPayout: number } | null {
    const wager = this.wagers.get(id);
    if (!wager || !(costShare > 0 && costShare <= 1) || !Number.isFinite(multiplier) || multiplier < 0) return null;
    wager.remaining--;
    wager.remainingShare = Math.max(0, wager.remainingShare - costShare);
    const complete = wager.remaining === 0;
    if (complete) this.wagers.delete(id);
    wager.rawPaid += wager.amount * costShare * multiplier;
    const payout = cents(wager.rawPaid) - wager.paid;
    wager.paid = cents(wager.rawPaid);
    this.balance = cents(this.balance + payout);
    this.peak = Math.max(this.peak, this.balance);
    return { wager, payout, profit: cents(payout - wager.cost * costShare), complete,
      totalProfit: cents(wager.paid - wager.cost), totalPayout: wager.paid };
  }
}
