import { START_MONEY } from './config';
import { fmtMoney } from './format';
import type { ChargeSkills } from './skills';

export type Branch = 'pegs' | 'buckets' | 'balls' | 'pity' | 'risk';
export type PrestigeSkill =
  | 'bouncyPegs' | 'doublePegs'
  | 'beginnersLuck' | 'bucketSlider'
  | 'bouncyBalls'
  | 'rookieLuck' | 'pityLuck' | 'startingMoney'
  | 'greed' | 'jackpotEdges';

export interface SkillDef {
  branch: Branch;
  title: string;
  symbol: string;
  max: number;
  /** First price and the multiplier applied for each level already owned. */
  price: [number, number];
  requires?: PrestigeSkill;
}

export const BRANCHES: readonly { id: Branch; title: string }[] = [
  { id: 'pegs', title: 'Pegs' },
  { id: 'buckets', title: 'Buckets' },
  { id: 'balls', title: 'Balls' },
  { id: 'pity', title: 'Pity' },
  { id: 'risk', title: 'Risk' },
];

/** Branch order is bottom to top: later skills require the one below them. */
export const PRESTIGE_SKILLS: Record<PrestigeSkill, SkillDef> = {
  bouncyPegs: { branch: 'pegs', title: 'Bouncy Pegs', symbol: '↟', max: 10, price: [25, 2] },
  doublePegs: { branch: 'pegs', title: 'Double Pegs', symbol: '⑂', max: 10, price: [100, 2.5], requires: 'bouncyPegs' },
  beginnersLuck: { branch: 'buckets', title: 'Beginner’s Luck', symbol: '☘', max: 1, price: [10, 1] },
  bucketSlider: { branch: 'buckets', title: 'Bucket Slider', symbol: '⇆', max: 1, price: [250, 1], requires: 'beginnersLuck' },
  bouncyBalls: { branch: 'balls', title: 'Bouncy Balls', symbol: '●', max: 10, price: [50, 1.8] },
  rookieLuck: { branch: 'pity', title: 'Rookie Luck', symbol: '$', max: 5, price: [15, 2] },
  pityLuck: { branch: 'pity', title: 'Pity Luck', symbol: '♥', max: 5, price: [30, 2] },
  startingMoney: { branch: 'pity', title: 'More Starting Money', symbol: '↑', max: 10, price: [20, 2] },
  greed: { branch: 'risk', title: 'Greed', symbol: '⚠', max: 3, price: [500, 3] },
  jackpotEdges: { branch: 'risk', title: 'Jackpot Edges', symbol: '☠', max: 1, price: [1000, 1], requires: 'greed' },
};
export const PRESTIGE_SKILL_IDS = Object.keys(PRESTIGE_SKILLS) as PrestigeSkill[];

export interface Debt { title: string; cost: number; flavor: string; }
/** The north trunk. Paying debt n unlocks balls worth 10^(n + 1). */
export const DEBTS: readonly Debt[] = [
  { title: 'Pay off the Step Pay burrito payments', cost: 25, flavor: 'Four burritos, twelve easy installments.' },
  { title: 'Pay Ted back his $100', cost: 100, flavor: 'He has asked about it every day since March.' },
  { title: 'Pay the electricity bill', cost: 250, flavor: 'Plinko is more fun with the lights on.' },
  { title: 'Pay rent', cost: 1_000, flavor: 'Your landlord has started leaving notes on the door.' },
  { title: 'Pay off the car loan', cost: 20_000, flavor: 'The car has 240,000 miles and no passenger door.' },
  { title: 'Pay off the student loans', cost: 100_000, flavor: 'A degree in medieval pottery, fully paid.' },
  { title: 'Pay off the mortgage', cost: 500_000, flavor: 'The house is finally yours. The raccoons stay.' },
  { title: 'Bail out Ted’s company', cost: 2_500_000, flavor: 'Artisanal ice cubes did not catch on.' },
  { title: 'End world hunger', cost: 6_000_000, flavor: 'Somebody had to do it.' },
  { title: 'Buy a private island', cost: 25_000_000, flavor: 'Mostly rocks. A lot of rocks.' },
  { title: 'Fund Ted’s moon base', cost: 150_000_000, flavor: 'He promises it will not be ice cubes this time.' },
  { title: 'Buy the moon', cost: 1_000_000_000, flavor: 'Ted’s moon base now pays you rent.' },
  { title: 'Pay off the national debt', cost: 35_000_000_000_000, flavor: 'You are now, officially, debt free.' },
];

/** Starting cash for each level of More Starting Money. */
export const STARTING_MONEY = [START_MONEY, 10, 15, 25, 40, 60, 100, 150, 250, 400, 600];
/** The cheapest first skill; reaching it reveals Cash Out for good. */
export const CASH_OUT_AT = PRESTIGE_SKILLS.beginnersLuck.price[0];
export const BEGINNER_HITS = 3;
export const BEGINNER_PAYOUT = 2;
export const BOUNCY_BALL_CHANCE = .01;
export const GREED_BONUS = .25;
export const GREED_TAX = .15;
export const ROOKIE_BONUS = .05;
export const PITY_BONUS = .1;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
interface Save { version: 1; wallet: number; debts: number; revealed: boolean; levels: Record<PrestigeSkill, number>; }
const cents = (value: number): number => Math.round(value * 100) / 100;

/** Permanent prestige progress: banked cash, skills and the debt storyline. */
export class PrestigeProgress {
  static readonly key = 'plinko-prestige-v1';
  private state: Save = { version: 1, wallet: 0, debts: 0, revealed: false,
    levels: Object.fromEntries(PRESTIGE_SKILL_IDS.map(id => [id, 0])) as Record<PrestigeSkill, number> };

  constructor(private storage: Storage) {
    const raw = storage.getItem(PrestigeProgress.key);
    if (raw === null) return;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !(Number.isFinite(saved.wallet) && saved.wallet >= 0)
      || !Number.isSafeInteger(saved.debts) || saved.debts < 0 || saved.debts > DEBTS.length
      || typeof saved.revealed !== 'boolean' || !saved.levels
      || PRESTIGE_SKILL_IDS.some(id => !Number.isSafeInteger(saved.levels[id]) || saved.levels[id] < 0 || saved.levels[id] > PRESTIGE_SKILLS[id].max)) {
      throw new Error('Invalid prestige save');
    }
    this.state = { ...saved, levels: { ...saved.levels } };
  }

  get wallet(): number { return this.state.wallet; }
  get debtsPaid(): number { return this.state.debts; }
  get revealed(): boolean { return this.state.revealed; }
  /** The highest ball tier: $1 always, then ten times more for every debt paid. */
  get maxTier(): number { return this.state.debts; }
  get nextDebt(): Debt | undefined { return DEBTS[this.state.debts]; }
  get startingMoney(): number { return STARTING_MONEY[this.level('startingMoney')]; }
  /** Share of the run's balance that reaches the wallet; Greed takes a cut. */
  get keepRate(): number { return 1 - GREED_TAX * this.level('greed'); }
  get ownedSkills(): number { return PRESTIGE_SKILL_IDS.reduce((sum, id) => sum + this.level(id), 0); }
  /** Charged peg placement reuses the Double or Nothing weighted spawner. */
  get pegSkills(): ChargeSkills {
    return { level: kind => kind === 'bouncy' ? this.level('bouncyPegs') : kind === 'split' ? this.level('doublePegs') : 0 };
  }

  level(id: PrestigeSkill): number { return this.state.levels[id]; }
  cost(id: PrestigeSkill): number {
    const [base, growth] = PRESTIGE_SKILLS[id].price;
    return Math.ceil(base * growth ** this.level(id));
  }
  locked(id: PrestigeSkill): boolean {
    const requires = PRESTIGE_SKILLS[id].requires;
    return !!requires && this.level(requires) === 0;
  }
  maxed(id: PrestigeSkill): boolean { return this.level(id) >= PRESTIGE_SKILLS[id].max; }
  canBuy(id: PrestigeSkill): boolean { return !this.locked(id) && !this.maxed(id) && this.wallet >= this.cost(id); }
  buy(id: PrestigeSkill): boolean {
    if (!this.canBuy(id)) return false;
    return this.commit({ ...this.state, wallet: cents(this.wallet - this.cost(id)), levels: { ...this.state.levels, [id]: this.level(id) + 1 } });
  }
  canPayDebt(): boolean { return !!this.nextDebt && this.wallet >= this.nextDebt.cost; }
  payDebt(): boolean {
    if (!this.canPayDebt()) return false;
    return this.commit({ ...this.state, wallet: cents(this.wallet - this.nextDebt!.cost), debts: this.debtsPaid + 1 });
  }
  /** Bank a run's balance and return the amount that reached the wallet. */
  cashOut(balance: number): number {
    const banked = cents(Math.max(0, balance) * this.keepRate);
    this.commit({ ...this.state, wallet: cents(this.wallet + banked), revealed: true });
    return banked;
  }
  reveal(): void {
    if (!this.revealed) this.commit({ ...this.state, revealed: true });
  }
  /** Persist first so a failed write leaves progress unchanged. */
  private commit(next: Save): boolean {
    this.storage.setItem(PrestigeProgress.key, JSON.stringify(next));
    this.state = next;
    return true;
  }
}

/** The center bucket, or both center buckets on layouts with an even bucket count. */
export const centerBuckets = (rows: number): number[] => [...new Set([Math.floor(rows / 2), Math.ceil(rows / 2)])];

/**
 * Bucket labels for a Prestige run: Jackpot Edges and Greed reshape the table,
 * then unbroken Beginner's Luck buckets show their fixed 2×.
 */
export function prestigePayouts(base: number[], progress: PrestigeProgress, beginnerHits: ReadonlyMap<number, number>): number[] {
  const rows = base.length - 1;
  const centers = centerBuckets(rows);
  const greed = 1 + GREED_BONUS * progress.level('greed');
  return base.map((value, k) => {
    if (progress.level('jackpotEdges')) {
      if (centers.includes(k)) value = 0;
      else if (k < 2 || k > rows - 2) value *= 2;
    }
    value = Math.round(value * greed * 10000) / 10000;
    return beginnerCharges(progress, beginnerHits, rows, k) > 0 ? BEGINNER_PAYOUT : value;
  });
}

export function beginnerCharges(progress: PrestigeProgress, hits: ReadonlyMap<number, number>, rows: number, k: number): number {
  if (!progress.level('beginnersLuck') || !centerBuckets(rows).includes(k)) return 0;
  return Math.max(0, BEGINNER_HITS - (hits.get(k) ?? 0));
}

/** Bonuses that depend on the landing ball rather than the bucket label. */
export function landingFactor(progress: PrestigeProgress, tier: number, balance: number, underSlider: boolean): number {
  let factor = underSlider ? 2 : 1;
  if (tier === 0) factor *= 1 + ROOKIE_BONUS * progress.level('rookieLuck');
  if (balance < progress.startingMoney) factor *= 1 + PITY_BONUS * progress.level('pityLuck');
  return factor;
}

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/** Player-facing copy for the detail panel: what it does, what you have, what is next. */
export function describeSkill(id: PrestigeSkill, level: number): { description: string; current: string; next: string } {
  const max = PRESTIGE_SKILLS[id].max;
  const next = level >= max ? 'Maximum level reached.' : '';
  switch (id) {
    case 'bouncyPegs': return { description: 'Adds a permanent purple peg that kicks every ball sideways on contact. Pegs move to fresh random spots each run, but never run out.',
      current: `${level} bouncy peg${level === 1 ? '' : 's'} per run.`, next: next || `Next: ${level + 1} bouncy pegs.` };
    case 'doublePegs': return { description: 'Adds a permanent blue peg that doubles any ball that touches it: a free copy with the same value. Each ball can be doubled once by each peg.',
      current: `${level} double peg${level === 1 ? '' : 's'} per run.`, next: next || `Next: ${level + 1} double pegs.` };
    case 'beginnersLuck': return { description: `The middle bucket pays ${BEGINNER_PAYOUT}× instead of its usual payout for the first ${BEGINNER_HITS} hits of every run. It cracks on each hit and breaks on the third.`,
      current: level ? `Active: ${BEGINNER_HITS} lucky hits each run.` : 'Not owned yet.', next };
    case 'bucketSlider': return { description: 'A slider moves across the buckets one at a time. Any ball that lands in the bucket beneath it pays double.',
      current: level ? 'Active every run.' : 'Not owned yet.', next };
    case 'bouncyBalls': return { description: `Each ball has a chance to spawn pink and super bouncy: 200% bounciness, so it flies toward the edges. Split copies stay bouncy.`,
      current: `${pct(BOUNCY_BALL_CHANCE * level)} chance per ball.`, next: next || `Next: ${pct(BOUNCY_BALL_CHANCE * (level + 1))} chance.` };
    case 'rookieLuck': return { description: 'Your $1 balls pay extra. A boost for the early game that matters less as bigger balls unlock.',
      current: `$1 balls pay +${pct(ROOKIE_BONUS * level)}.`, next: next || `Next: +${pct(ROOKIE_BONUS * (level + 1))}.` };
    case 'pityLuck': return { description: 'While your balance is below your starting money, every bucket pays extra.',
      current: `+${pct(PITY_BONUS * level)} while you are down.`, next: next || `Next: +${pct(PITY_BONUS * (level + 1))}.` };
    case 'startingMoney': return { description: 'Start every run with more cash.',
      current: `Runs start with ${fmtMoney(STARTING_MONEY[level])}.`, next: next || `Next: ${fmtMoney(STARTING_MONEY[level + 1])}.` };
    case 'greed': return { description: `Every bucket pays +${pct(GREED_BONUS)} more per level. Drawback: cashing out keeps ${pct(GREED_TAX)} less of your balance per level.`,
      current: `Payouts +${pct(GREED_BONUS * level)}, cash out keeps ${pct(1 - GREED_TAX * level)}.`,
      next: next || `Next: payouts +${pct(GREED_BONUS * (level + 1))}, keep ${pct(1 - GREED_TAX * (level + 1))}.` };
    case 'jackpotEdges': return { description: 'The two outermost buckets on each side pay double. Drawback: the middle bucket becomes a skull that pays nothing (Beginner’s Luck still covers it until it breaks).',
      current: level ? 'Active every run.' : 'Not owned yet.', next };
  }
}
