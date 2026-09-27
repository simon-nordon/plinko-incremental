import { START_MONEY } from './config';
import { ballTier } from './tiers';

export type GameMode = 'classic' | 'double' | 'prestige';
export const GAME_MODES: readonly GameMode[] = ['classic', 'double', 'prestige'];
/** Prestige unlocks tiers by paying debts and can start above $5. */
export interface PrestigeRunSettings { maxTier: number; startingMoney: number; }
export const PRESTIGE_DEFAULTS: PrestigeRunSettings = { maxTier: 0, startingMoney: START_MONEY };
/** Prestige doubles ball lineages, so bound the physics load of one board. */
export const PRESTIGE_MAX_BALLS = 150;
export const prestigeStake = (tier: number): number => 10 ** tier;
export const startingBalance = (mode: GameMode, prestige = PRESTIGE_DEFAULTS): number =>
  mode === 'double' ? 0 : mode === 'prestige' ? prestige.startingMoney : START_MONEY;
const cents = (value: number): number => Math.abs(value) < Number.MAX_SAFE_INTEGER / 100 ? Math.round(value * 100) / 100 : value;

export interface Wager { id: number; tier: number; amount: number; cost: number; }

/** Balances and outstanding bets for one life, independent of animation. */
export class GameRun {
  balance: number;
  peak: number;
  drops = 0;
  private houseAvailable: boolean;
  private wagers = new Map<number, Wager & { remaining: number; remainingShare: number; paid: number; rawPaid: number }>();
  private prestige: PrestigeRunSettings;

  constructor(readonly mode: GameMode, readonly houseStake = 10, prestige = PRESTIGE_DEFAULTS) {
    this.prestige = { ...prestige };
    this.balance = this.peak = startingBalance(mode, prestige);
    this.houseAvailable = mode === 'double';
  }
  get houseDropAvailable(): boolean { return this.houseAvailable; }
  get active(): number { return this.wagers.size; }
  get activeBalls(): number { return [...this.wagers.values()].reduce((sum, bet) => sum + bet.remaining, 0); }
  get maxBalls(): number { return this.mode === 'prestige' ? PRESTIGE_MAX_BALLS : Infinity; }
  /** Highest ball tier this run may buy; only Prestige restricts it. */
  get maxTier(): number { return this.mode === 'prestige' ? this.prestige.maxTier : Infinity; }
  /** Paying a debt unlocks the next tier immediately. */
  setMaxTier(maxTier: number): void { this.prestige = { ...this.prestige, maxTier }; }
  stake(tier: number): number | undefined {
    if (this.mode !== 'prestige') return ballTier(tier)?.cost;
    return Number.isSafeInteger(tier) && tier >= 0 && tier <= this.maxTier ? prestigeStake(tier) : undefined;
  }
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
    const tierIndex = this.mode === 'double' ? 0 : tier;
    const amount = this.houseAvailable ? this.houseStake : this.mode === 'double' ? this.balance : this.stake(tierIndex);
    if (amount === undefined || !Number.isFinite(amount) || amount < this.minimumBet) return null;
    const cost = this.houseAvailable ? 0 : amount;
    if (cost > this.balance) return null;
    const bet = { id: ++this.drops, tier: tierIndex, amount, cost };
    this.houseAvailable = false;
    this.balance = cents(this.balance - cost);
    this.wagers.set(bet.id, { ...bet, remaining: 1, remainingShare: 1, paid: 0, rawPaid: 0 });
    return bet;
  }
  /** Prestige Double Pegs add payout value; other modes divide the original value. */
  duplicate(id: number, extraValueShare = 0): boolean {
    const wager = this.wagers.get(id);
    if (!wager || this.activeBalls >= this.maxBalls || !Number.isFinite(extraValueShare) || extraValueShare < 0) return false;
    wager.remaining++;
    if (this.mode === 'prestige') wager.remainingShare += extraValueShare;
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
    const payout = cents(wager.rawPaid) - wager.paid;
    wager.paid = cents(wager.rawPaid);
    this.balance = cents(this.balance + payout);
    this.peak = Math.max(this.peak, this.balance);
    return { wager, payout, profit: cents(payout - wager.cost * costShare), complete,
      totalProfit: cents(wager.paid - wager.cost), totalPayout: wager.paid };
  }
}
