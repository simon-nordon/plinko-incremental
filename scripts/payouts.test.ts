import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ROWS, MIN_ROWS, RISKS } from '../src/config';
import { fmtMult } from '../src/format';
import { adjustBucket, bucketPayouts, loadBucketTuning, loadRiskBucketTuning, payoutTable, type BucketTuning } from '../src/payouts';
import { GameRun } from '../src/game';
import { binomialWeight } from '../src/skills';

test('zero luck uses the original reference table without fitting or stretching', () => {
  assert.deepEqual(payoutTable('medium', 16, 0), [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110]);
  assert.deepEqual(payoutTable('medium', 9, 0), [18, 4, 1.7, 0.9, 0.5, 0.5, 0.9, 1.7, 4, 18]);
  assert.deepEqual(payoutTable('extreme', 16, 0), [1000, 130, 26, 9, 4, 2, .2, .2, .2, .2, .2, 2, 4, 9, 26, 130, 1000]);
});

test('High copies Medium with the agreed 16-row center and side-bucket tradeoff', () => {
  for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) {
    const medium = payoutTable('medium', rows, 0);
    const high = payoutTable('high', rows, 0);
    const expected = [...medium];
    if (rows === 16) {
      expected[8] = .1;
      expected[6] = expected[10] = 1.2;
    }
    assert.deepEqual(high, expected);
  }
  const base = payoutTable('high', 16, 0);
  const expectedReturn = base.reduce((sum, value, k) => sum + value * binomialWeight(16, k), 0);
  assert.ok(Math.abs(expectedReturn - .9994842529296875) < 1e-12);
});

test('luck scales every bucket by the stated percentage for every layout and risk', () => {
  for (const risk of RISKS) {
    for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) {
      const base = payoutTable(risk, rows, 0);
      assert.equal(base.length, rows + 1);
      assert.deepEqual(base, [...base].reverse());
      for (const luck of [-50, 1, 10, 50]) {
        const adjusted = payoutTable(risk, rows, luck);
        base.forEach((value, bucket) => {
          assert.ok(Math.abs(adjusted[bucket] - value * (1 + luck / 100)) < 1e-10);
        });
      }
    }
  }
});

test('small percentage increases survive payout and display rounding', () => {
  const onePercent = payoutTable('medium', 16, 1)[8];
  assert.equal(onePercent, 0.303);
  assert.equal(fmtMult(onePercent), '0.303×');
  assert.equal(Math.round(10 * onePercent * 100) / 100, 3.03);
  const fiftyPercent = payoutTable('medium', 16, 50);
  assert.equal(fiftyPercent[0], 165);
  assert.equal(fiftyPercent[8], 0.45);
  assert.equal(payoutTable('extreme', 16, 50)[5], 3);
  assert.equal(fmtMult(61.5), '61.5×');
  assert.equal(fmtMult(165), '165');
});

test('Prestige copies Normal payouts, including luck; Double or Nothing ignores luck', () => {
  assert.deepEqual(bucketPayouts('prestige', 16), [110, 41, 10, 5, 3, 1.5, 1.2, .5, .1, .5, 1.2, 1.5, 3, 5, 10, 41, 110]);
  for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) {
    assert.deepEqual(bucketPayouts('prestige', rows, 10), payoutTable('high', rows, 10));
    assert.deepEqual(bucketPayouts('double', rows, 10), payoutTable('high', rows, 0));
    assert.deepEqual(bucketPayouts('classic', rows, 10), payoutTable('high', rows, 10));
  }
  const run = new GameRun('prestige');
  const result = run.settle(run.drop(0)!.id, bucketPayouts('prestige', 16)[8])!;
  assert.equal(result.payout, .1);
  assert.equal(result.totalProfit, -.9);
  assert.equal(run.balance, 4.1);
});

test('bucket editing changes only its target by 0.1 and never produces negative payouts', () => {
  let tuning: BucketTuning = {};
  for (let i = 1; i <= 10; i++) {
    tuning = adjustBucket(tuning, 'prestige', 16, 0, 6, 1);
    assert.equal(bucketPayouts('prestige', 16, 0, tuning)[6], (12 + i) / 10);
    assert.equal(bucketPayouts('prestige', 16, 0, tuning)[10], 1.2, 'mirror bucket stays independent');
  }
  for (let i = 0; i < 10; i++) tuning = adjustBucket(tuning, 'prestige', 16, 0, 6, -1);
  assert.deepEqual(bucketPayouts('prestige', 16, 0, tuning), bucketPayouts('prestige', 16));
  for (let i = 0; i < 7; i++) tuning = adjustBucket(tuning, 'prestige', 16, 0, 7, -1);
  assert.equal(bucketPayouts('prestige', 16, 0, tuning)[7], 0);
  tuning = adjustBucket(tuning, 'prestige', 16, 0, 8, 1);
  assert.equal(bucketPayouts('prestige', 16, 0, tuning)[8], .2, 'dev controls can also tune the center bucket');
  assert.deepEqual(bucketPayouts('prestige', 8, 0, tuning), bucketPayouts('prestige', 8), 'other layouts are unchanged');
  assert.equal(adjustBucket(tuning, 'prestige', 16, 0, 17, 1), tuning);
});

test('bucket tuning survives serialization, rejects corrupt layouts and follows Normal luck', () => {
  const tuning = adjustBucket({}, 'classic', 16, 10, 7, 1);
  assert.equal(bucketPayouts('classic', 16, 10, tuning)[7], .65, 'the visible base payout increases by exactly a tenth');
  assert.equal(bucketPayouts('classic', 16, 0, tuning)[7], .6);
  const restored = loadBucketTuning(JSON.parse(JSON.stringify(tuning)));
  assert.deepEqual(restored, tuning);
  assert.deepEqual(loadBucketTuning({ ...tuning, 8: [1, 2], 9: Array(10).fill('1'), 10: Array(11).fill(Infinity) }), tuning);
  for (const invalid of [null, 5, [], 'bad']) assert.deepEqual(loadBucketTuning(invalid), {});
  const reset = { ...restored };
  delete reset[16];
  assert.deepEqual(bucketPayouts('classic', 16, 10, reset), bucketPayouts('classic', 16, 10));
});

test('each risk restores its own defaults and keeps its edits separate', () => {
  const tuning = loadRiskBucketTuning(null);
  for (const risk of RISKS) {
    const base = bucketPayouts('prestige', 16, 0, {}, risk);
    assert.deepEqual(base, payoutTable(risk, 16, 0));
    tuning[risk] = adjustBucket({}, 'prestige', 16, 0, 7, 1, risk);
    assert.equal(bucketPayouts('prestige', 16, 0, tuning[risk], risk)[7], Math.round((base[7] + .1) * 10) / 10);
  }
  const restored = loadRiskBucketTuning(JSON.parse(JSON.stringify(tuning)));
  assert.deepEqual(restored, tuning);
  delete restored.low![16];
  assert.deepEqual(bucketPayouts('prestige', 16, 0, restored.low, 'low'), payoutTable('low', 16, 0));
  assert.equal(bucketPayouts('prestige', 16, 0, restored.high, 'high')[7], .6);
  delete restored.high![16];
  assert.deepEqual(bucketPayouts('prestige', 16, 0, restored.high, 'high'), bucketPayouts('prestige', 16));
});

test('legacy fixed-High tuning migrates only to High and newer tuning takes precedence', () => {
  const legacy = adjustBucket({}, 'prestige', 16, 0, 6, 1);
  const migrated = loadRiskBucketTuning(undefined, legacy);
  assert.deepEqual(migrated.high, legacy);
  for (const risk of ['low', 'medium', 'extreme'] as const) assert.deepEqual(migrated[risk], {});
  assert.deepEqual(loadRiskBucketTuning({ high: {} }, legacy).high, {}, 'a reset cannot resurrect legacy edits');
});
