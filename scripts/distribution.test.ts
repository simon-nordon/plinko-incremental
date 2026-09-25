import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Board } from '../src/board';

// Exercise the actual game simulation. Payout-table tests alone cannot catch
// friction changes that make the rare jackpot buckets land every few drops.
for (const interval of [Infinity, 0.15]) {
  test(`default landing distribution stays concentrated with ${interval === Infinity ? 'single' : 'rapid'} drops`, () => {
    const originalRandom = Math.random;
    let seed = 143718;
    Math.random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    try {
      const count = 600;
      const counts = new Array<number>(17).fill(0);
      const board = new Board({ getContext: () => ({}) } as unknown as HTMLCanvasElement, {
        onPegHit() {},
        onLand(k) { counts[k]++; },
      });
      board.setLayout(16, []);
      let dropped = 0;
      let wait = 0;
      for (let tick = 0; (dropped < count || board.active) && tick < count * 60 * 31; tick++) {
        if (dropped < count && (interval === Infinity ? board.active === 0 : wait <= 0)) {
          board.drop(dropped % 5);
          dropped++;
          wait = interval;
        }
        board.update(1 / 60);
        wait -= 1 / 60;
      }
      assert.equal(counts.reduce((sum, n) => sum + n, 0), count);
      assert.equal(board.active, 0);
      const mean = counts.reduce((sum, n, k) => sum + n * k, 0) / count;
      const variance = counts.reduce((sum, n, k) => sum + n * (k - mean) ** 2, 0) / count;
      const edgeHits = counts[0] + counts[16];
      // Broad tolerances catch the old 3.5% jackpot rate and excessive lateral
      // spread, without asserting a precise return from rare random payouts.
      assert.ok(edgeHits <= 2, `outer jackpots occurred ${edgeHits}/${count} times`);
      assert.ok(Math.abs(mean - 8) < 0.4, `distribution shifted off centre: ${mean}`);
      assert.ok(variance > 2 && variance < 6, `distribution too narrow or wide: ${variance}`);
    } finally {
      Math.random = originalRandom;
    }
  });
}
