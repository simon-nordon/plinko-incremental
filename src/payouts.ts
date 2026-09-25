import { STAKE_SHAPES, type Risk } from './config';

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
