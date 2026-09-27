import { START_MONEY } from './config';
import { ballTier } from './tiers';

export type GameMode = 'classic' | 'double' | 'oneball';
export interface OneBallSettings { maxBalls: number; ballValue: number; cashback: number; }
export const ONE_BALL_DEFAULTS: OneBallSettings = { maxBalls: 5, ballValue: 1, cashback: 0 };
export const startingBalance = (mode: GameMode): number => mode === 'double' ? 0 : START_MONEY;
const cents = (value: number): number => Math.abs(value) < Number.MAX_SAFE_INTEGER / 100 ? Math.round(value * 100) / 100 : value;

export interface Wager { id: number; tier: number; amount: number; cost: number; }

/** Balances and outstanding bets for one life, independent of animation. */
export class GameRun {
  balance: number;
  peak: number;
  drops = 0;
  private houseAvailable: boolean;
  private wagers = new Map<number, Wager & { remaining: number; remainingShare: number; paid: number; rawPaid: number; cashback: number }>();
  private oneBall: OneBallSettings;

  constructor(readonly mode: GameMode, readonly houseStake = 10, oneBall = ONE_BALL_DEFAULTS) {
    this.oneBall = { ...oneBall };
    this.balance = this.peak = startingBalance(mode);
    this.houseAvailable = mode === 'double';
  }
  get houseDropAvailable(): boolean { return this.houseAvailable; }
  get active(): number { return this.wagers.size; }
  get activeBalls(): number { return [...this.wagers.values()].reduce((sum, bet) => sum + bet.remaining, 0); }
  get maxBalls(): number { return this.mode === 'oneball' ? this.oneBall.maxBalls : Infinity; }
  get ballValue(): number { return this.mode === 'oneball' ? this.oneBall.ballValue : 1; }
  /** Existing wagers retain the value and cashback they had when purchased. */
  setOneBallSettings(settings: OneBallSettings): void { this.oneBall = { ...settings }; }
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
    if (this.busted || this.activeBalls >= this.maxBalls || (this.mode === 'double' && this.active > 0)) return null;
    const tierIndex = this.mode === 'classic' ? tier : 0;
    const amount = this.houseAvailable ? this.houseStake : this.mode === 'double' ? this.balance
      : this.mode === 'oneball' ? this.ballValue : ballTier(tierIndex)?.cost;
    if (amount === undefined || !Number.isFinite(amount) || amount < this.minimumBet) return null;
    const cost = this.houseAvailable ? 0 : this.mode === 'oneball' ? 1 : amount;
    if (cost > this.balance) return null;
    const bet = { id: ++this.drops, tier: tierIndex, amount, cost };
    this.houseAvailable = false;
    this.balance = cents(this.balance - cost);
    this.wagers.set(bet.id, { ...bet, remaining: 1, remainingShare: 1, paid: 0, rawPaid: 0,
      cashback: this.mode === 'oneball' ? this.oneBall.cashback : 0 });
    return bet;
  }
  /** One Ball splits add payout value; other modes divide the original value. */
  duplicate(id: number, extraValueShare = 0): boolean {
    const wager = this.wagers.get(id);
    if (!wager || this.activeBalls >= this.maxBalls || !Number.isFinite(extraValueShare) || extraValueShare < 0) return false;
    wager.remaining++;
    if (this.mode === 'oneball') wager.remainingShare += extraValueShare;
    return true;
  }
  settle(id: number, multiplier: number, costShare = 1, valueShare = costShare): { wager: Wager; payout: number; profit: number; complete: boolean; totalProfit: number; totalPayout: number } | null {
    const wager = this.wagers.get(id);
    if (!wager || !(costShare > 0 && costShare <= 1) || !(valueShare > 0 && valueShare <= 1)
      || !Number.isFinite(multiplier) || multiplier < 0) return null;
    wager.remaining--;
    wager.remainingShare = Math.max(0, wager.remainingShare - valueShare);
    const complete = wager.remaining === 0;
    if (complete) this.wagers.delete(id);
    wager.rawPaid += wager.amount * valueShare * multiplier;
    if (complete) wager.rawPaid += wager.cost * wager.cashback;
    const payout = cents(wager.rawPaid) - wager.paid;
    wager.paid = cents(wager.rawPaid);
    this.balance = cents(this.balance + payout);
    this.peak = Math.max(this.peak, this.balance);
    return { wager, payout, profit: cents(payout - wager.cost * costShare), complete,
      totalProfit: cents(wager.paid - wager.cost), totalPayout: wager.paid };
  }
}
