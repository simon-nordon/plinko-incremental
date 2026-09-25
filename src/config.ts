export const START_MONEY = 5;
export const MIN_ROWS = 8;
export const MAX_ROWS = 16;

export type Risk = 'low' | 'medium' | 'high';
export const RISKS: Risk[] = ['low', 'medium', 'high'];

/**
 * Stake's multipliers for a classic 3-pin-top board, edge to centre, mirrored to build a row.
 * These are the base payouts at 0% luck. Luck applies a straight percentage adjustment.
 */
export const STAKE_SHAPES: Record<Risk, Record<number, number[]>> = {
  low: {
    8: [5.6, 2.1, 1.1, 1, 0.5],
    9: [5.6, 2, 1.6, 1, 0.7],
    10: [8.9, 3, 1.4, 1.1, 1, 0.5],
    11: [8.4, 3, 1.9, 1.3, 1, 0.7],
    12: [10, 3, 1.6, 1.4, 1.1, 1, 0.5],
    13: [8.1, 4, 3, 1.9, 1.2, 0.9, 0.7],
    14: [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5],
    15: [15, 8, 3, 2, 1.5, 1.1, 1, 0.7],
    16: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5],
  },
  medium: {
    8: [13, 3, 1.3, 0.7, 0.4],
    9: [18, 4, 1.7, 0.9, 0.5],
    10: [22, 5, 2, 1.4, 0.6, 0.4],
    11: [24, 6, 3, 1.8, 0.7, 0.5],
    12: [33, 11, 4, 2, 1.1, 0.6, 0.3],
    13: [43, 13, 6, 3, 1.3, 0.7, 0.4],
    14: [58, 15, 7, 4, 1.9, 1, 0.5, 0.2],
    15: [88, 18, 11, 5, 3, 1.3, 0.5, 0.3],
    16: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3],
  },
  high: {
    8: [29, 4, 1.5, 0.3, 0.2],
    9: [43, 7, 2, 0.6, 0.2],
    10: [76, 10, 3, 0.9, 0.3, 0.2],
    11: [120, 14, 5.2, 1.4, 0.4, 0.2],
    12: [170, 24, 8.1, 2, 0.7, 0.2, 0.2],
    13: [260, 37, 11, 4, 1, 0.2, 0.2],
    14: [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2],
    15: [620, 83, 27, 8, 3, 0.5, 0.2, 0.2],
    16: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2],
  },
};

/** Percentage adjustment to every base bucket multiplier. */
export const DEFAULT_LUCK = 10;
export const LUCK_RANGE = 50;

const EDGE = [255, 0, 63];
const CENTRE = [255, 192, 0];

/** Red at the edges fading to amber in the middle, like the reference board. */
export function bucketColor(k: number, buckets: number, dark = 0): string {
  const c = (buckets - 1) / 2;
  const d = Math.abs(k - c) / c; // 0 centre → 1 edge
  const [r, g, b] = CENTRE.map((c, i) => Math.round((c + (EDGE[i] - c) * d) * (0.86 - dark * 0.3)));
  return `rgb(${r}, ${g}, ${b})`;
}

export interface BallStyle {
  /** button and ball colour */
  color: string;
  /** darker edge for the ball's shading */
  deep: string;
}

/** Appearance repeats as the stake ladder grows. */
const BALL_STYLES: BallStyle[] = [
  { color: '#22c55e', deep: '#15803d' },
  { color: '#f59e0b', deep: '#b45309' },
  { color: '#a855f7', deep: '#6b21a8' },
  { color: '#38bdf8', deep: '#0369a1' },
  { color: '#f43f5e', deep: '#9f1239' },
];

export function ballStyle(tier: number): BallStyle {
  return BALL_STYLES[tier % BALL_STYLES.length];
}

/** Minimum real time between two balls entering the board, so they never spawn inside each other. */
export const SPAWN_GAP = 0.15;

/** Ball physics the Tuning panel can change independently of payouts. */
export interface PhysicsSettings {
  /** ball radius as a multiple of the pin radius */
  ballSize: number;
  /** gravity multiplier: low is floaty, high is heavy */
  weight: number;
  /** restitution against pins and walls up to 1; above 1, pins also kick like pinball bumpers */
  bounce: number;
}

export const DEFAULT_PHYSICS: PhysicsSettings = { ballSize: 2, weight: 1, bounce: 0.8 };

/** Bump to replace saved tuning preferences when the default physics preset changes. */
export const PHYSICS_VERSION = 3;

/** [min, max, step] for each Tuning slider. */
export const PHYSICS_RANGES: Record<keyof PhysicsSettings, [number, number, number]> = {
  ballSize: [0.5, 2.5, 0.1],
  weight: [0.25, 1.5, 0.05],
  bounce: [0.3, 5, 0.05],
};
