import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ROWS, MIN_ROWS, RISKS } from '../src/config';
import { fmtMult } from '../src/format';
import { payoutTable } from '../src/payouts';
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
