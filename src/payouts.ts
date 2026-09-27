import { MAX_ROWS, MIN_ROWS, RISKS, STAKE_SHAPES, type Risk } from './config';
import type { GameMode } from './game';

/** Reference payouts, mirrored edge to edge, with luck applied as a percentage. */
export function payoutTable(risk: Risk, rows: number, luck: number): number[] {
  const half = STAKE_SHAPES[risk][rows];
  const buckets = rows + 1;
  const factor = 1 + luck / 100;
  return Array.from({ length: buckets }, (_, k) => {
    const base = half[Math.min(k, buckets - 1 - k)];
    // Remove floating-point noise without losing small percentage adjustments.
    return Math.round(base * factor * 10000) / 10000;
  });
}

/** Per-layout offsets, applied after Normal's luck and before Golden Bucket bonuses. */
export type BucketTuning = Partial<Record<number, number[]>>;
export type RiskBucketTuning = Partial<Record<Risk, BucketTuning>>;
const precise = (value: number): number => Math.round(value * 10000) / 10000;

export function loadBucketTuning(saved: unknown): BucketTuning {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
  const tuning: BucketTuning = {};
  for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) {
    const values = (saved as Record<string, unknown>)[rows];
    if (Array.isArray(values) && values.length === rows + 1
      && values.every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e9)) {
      tuning[rows] = values.map(precise);
    }
  }
  return tuning;
}

/** Keep old fixed-High edits on High when upgrading to separate risk presets. */
export function loadRiskBucketTuning(saved: unknown, legacy?: unknown): RiskBucketTuning {
  const source = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  const tuning: RiskBucketTuning = {};
  for (const risk of RISKS) tuning[risk] = loadBucketTuning(source[risk] ?? (risk === 'high' ? legacy : undefined));
  return tuning;
}

/** Luck applies to Normal and Prestige; Double or Nothing always uses the reference table. */
export function bucketPayouts(mode: GameMode, rows: number, luck = 0, tuning: BucketTuning = {}, risk: Risk = 'high'): number[] {
  const base = payoutTable(risk, rows, mode === 'double' ? 0 : luck);
  return base.map((value, k) => Math.max(0, precise(value + (tuning[rows]?.[k] ?? 0))));
}

/** Change only the selected bucket by an exact tenth, without allowing negative payouts. */
export function adjustBucket(tuning: BucketTuning, mode: GameMode, rows: number, luck: number, bucket: number, step: -1 | 1, risk: Risk = 'high'): BucketTuning {
  if (!Number.isInteger(bucket) || bucket < 0 || bucket > rows) return tuning;
  const base = bucketPayouts(mode, rows, luck, {}, risk);
  const current = bucketPayouts(mode, rows, luck, tuning, risk);
  const offsets = [...(tuning[rows] ?? Array<number>(rows + 1).fill(0))];
  offsets[bucket] = precise(Math.max(0, precise(current[bucket] + step / 10)) - base[bucket]);
  return { ...tuning, [rows]: offsets };
}
