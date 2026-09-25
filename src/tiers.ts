import { ballStyle, type BallStyle } from './config';

export interface BallTier extends BallStyle {
  index: number;
  cost: number;
}

export const MAX_VISIBLE_TIERS = 5;
const EARLY_STAKES = [1, 10, 100, 500, 1_000, 2_500, 10_000, 25_000, 100_000, 250_000, 500_000];
// Repeat at each thousandfold scale: millions, billions, trillions, and beyond.
const LARGE_STEPS = [1, 2, 5, 10, 25, 100, 250, 500];

export function ballTier(index: number): BallTier | undefined {
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  const offset = index - EARLY_STAKES.length;
  const cost = offset < 0 ? EARLY_STAKES[index]
    : LARGE_STEPS[offset % LARGE_STEPS.length] * 10 ** (6 + 3 * Math.floor(offset / LARGE_STEPS.length));
  if (!Number.isFinite(cost)) return undefined;
  return { index, cost, ...ballStyle(index) };
}

/** The five highest affordable stakes, in ascending order. */
export function affordableTiers(balance: number): BallTier[] {
  if (!Number.isFinite(balance) || balance < 1) return [];
  const visible: BallTier[] = [];
  for (let index = 0; ; index++) {
    const tier = ballTier(index);
    if (!tier || tier.cost > balance) break;
    visible.push(tier);
    if (visible.length > MAX_VISIBLE_TIERS) visible.shift();
  }
  return visible;
}
