import { START_MONEY } from './config';
import { ballTier } from './tiers';

export type GameMode = 'classic' | 'double';
export const startingBalance = (mode: GameMode): number => mode === 'double' ? 100 : START_MONEY;
// Large balances no longer have cent precision; avoid overflowing just to round them.
const cents = (value: number): number => Math.abs(value) < Number.MAX_SAFE_INTEGER / 100 ? Math.round(value * 100) / 100 : value;

export interface Wager {
  id: number;
  tier: number;
  amount: number;
}

/** Balances and outstanding bets for one run, independent of the animation. */
export class GameRun {
  balance: number;
  peak: number;
  drops = 0;
  private wagers = new Map<number, Wager>();

  constructor(readonly mode: GameMode) {
    this.balance = this.peak = startingBalance(mode);
  }

  get active(): number { return this.wagers.size; }
  get minimumBet(): number { return this.mode === 'double' ? 10 : 1; }
  get busted(): boolean { return this.balance < this.minimumBet && this.active === 0; }
  get inPlay(): number { return [...this.wagers.values()].reduce((sum, bet) => sum + bet.amount, 0); }

  drop(tier: number): Wager | null {
    if (this.busted || (this.mode === 'double' && this.active > 0)) return null;
    const tierIndex = this.mode === 'double' ? 0 : tier;
    const amount = this.mode === 'double' ? this.balance : ballTier(tierIndex)?.cost;
    if (amount === undefined || amount < this.minimumBet || amount > this.balance) return null;
    const bet = { id: ++this.drops, tier: tierIndex, amount };
    this.balance = cents(this.balance - amount);
    this.wagers.set(bet.id, bet);
    return bet;
  }

  settle(id: number, multiplier: number): { wager: Wager; payout: number; profit: number } | null {
    const wager = this.wagers.get(id);
    if (!wager) return null;
    this.wagers.delete(id);
    const payout = cents(wager.amount * multiplier);
    this.balance = cents(this.balance + payout);
    this.peak = Math.max(this.peak, this.balance);
    return { wager, payout, profit: cents(payout - wager.amount) };
  }
}
