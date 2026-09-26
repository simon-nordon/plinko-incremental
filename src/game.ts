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
  private wagers = new Map<number, Wager & { remaining: number; paid: number; rawPaid: number; bonus: number }>();

  constructor(readonly mode: GameMode) {
    this.balance = this.peak = startingBalance(mode);
  }

  get active(): number { return this.wagers.size; }
  get minimumBet(): number { return this.mode === 'double' ? 10 : 1; }
  get busted(): boolean { return this.balance < this.minimumBet && this.active === 0; }
  get inPlay(): number { return [...this.wagers.values()].reduce((sum, bet) => sum + bet.amount * bet.remaining, 0); }
  // Freeze conditional bonuses for the whole drop, including all split children.
  get payoutBalance(): number { return this.mode === 'double' && this.active ? [...this.wagers.values()][0].amount : this.balance; }

  luckyHit(id: number, share: number): number {
    const bet = this.wagers.get(id);
    if (!bet || this.mode !== 'double' || !(share > 0 && share <= bet.remaining)) return 0;
    const total = bet.bonus + bet.amount * share * .1;
    const award = cents(total) - cents(bet.bonus);
    bet.bonus = total;
    this.balance = cents(this.balance + award);
    this.peak = Math.max(this.peak, this.balance);
    return award;
  }

  canSpend(amount: number): boolean {
    return !this.busted && this.active === 0 && Number.isFinite(amount) && amount > 0 && amount <= this.balance;
  }

  spend(amount: number): boolean {
    if (!this.canSpend(amount)) return false;
    this.balance = cents(this.balance - amount);
    return true;
  }

  drop(tier: number): Wager | null {
    if (this.busted || (this.mode === 'double' && this.active > 0)) return null;
    const tierIndex = this.mode === 'double' ? 0 : tier;
    const amount = this.mode === 'double' ? this.balance : ballTier(tierIndex)?.cost;
    if (amount === undefined || amount < this.minimumBet || amount > this.balance) return null;
    const bet = { id: ++this.drops, tier: tierIndex, amount };
    this.balance = cents(this.balance - amount);
    this.wagers.set(bet.id, { ...bet, remaining: 1, paid: 0, rawPaid: 0, bonus: 0 });
    return bet;
  }

  settle(id: number, multiplier: number, share = 1): { wager: Wager; payout: number; profit: number; complete: boolean; totalProfit: number; totalPayout: number } | null {
    const wager = this.wagers.get(id);
    if (!wager || !(share > 0 && share <= wager.remaining)) return null;
    wager.remaining -= share;
    const complete = wager.remaining === 0;
    if (complete) this.wagers.delete(id);
    wager.rawPaid += wager.amount * share * multiplier;
    const payout = cents(wager.rawPaid) - wager.paid;
    wager.paid = cents(wager.rawPaid);
    this.balance = cents(this.balance + payout);
    this.peak = Math.max(this.peak, this.balance);
    const totalPayout = cents(wager.paid + cents(wager.bonus));
    return { wager, payout, profit: cents(payout - wager.amount * share), complete,
      totalProfit: cents(totalPayout - wager.amount), totalPayout };
  }
}
