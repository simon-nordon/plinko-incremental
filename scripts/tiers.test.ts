import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ballStyle } from '../src/config';
import { GameRun } from '../src/game';
import { affordableTiers, ballTier } from '../src/tiers';

const costs = (balance: number) => affordableTiers(balance).map(t => t.cost);

test('stake ladder follows the requested steps and continues into billions', () => {
  const expected = [1, 10, 100, 500, 1000, 2500, 10000, 25000, 100000, 250000, 500000,
    1e6, 2e6, 5e6, 10e6, 25e6, 100e6, 250e6, 500e6, 1e9, 2e9, 5e9];
  assert.deepEqual(expected.map((_, index) => ballTier(index)!.cost), expected);
});

test('buttons show only the five highest affordable stakes and recover cheaper options after losses', () => {
  assert.deepEqual(costs(5), [1]);
  assert.deepEqual(costs(50), [1, 10]);
  assert.deepEqual(costs(1000), [1, 10, 100, 500, 1000]);
  assert.deepEqual(costs(2500), [10, 100, 500, 1000, 2500]);
  assert.deepEqual(costs(1e6), [25000, 100000, 250000, 500000, 1e6]);
  assert.deepEqual(costs(999.99), [1, 10, 100, 500]);
  assert.deepEqual(costs(9.99), [1]);
  assert.deepEqual(costs(1), [1]);
  assert.deepEqual(costs(0.99), []);
  assert.deepEqual(costs(0), []);
});

test('tiers keep growing with valid appearances and at most five affordable buttons', () => {
  for (const balance of [2.5e7, 1e12, 1e30, 1e100, 1e307]) {
    const visible = affordableTiers(balance);
    assert.equal(visible.length, 5);
    for (const [slot, tier] of visible.entries()) {
      assert.ok(tier.cost <= balance);
      if (slot > 0) assert.ok(tier.cost > visible[slot - 1].cost);
      assert.ok(ballStyle(tier.index).color);
      assert.ok(ballStyle(tier.index).deep);
    }
    assert.ok(ballTier(visible[4].index + 1)!.cost > balance);
  }
  assert.equal(ballTier(-1), undefined);
  assert.equal(ballTier(0.5), undefined);
});

test('large wagers keep their original stake and rounding does not overflow the balance', () => {
  const game = new GameRun('classic');
  game.balance = 1e307;
  const tier = affordableTiers(game.balance).at(-1)!;
  const wager = game.drop(tier.index)!;
  assert.equal(wager.amount, tier.cost);
  assert.equal(game.balance, 0);
  const result = game.settle(wager.id, 2)!;
  assert.equal(result.profit, 1e307);
  assert.equal(game.balance, 2e307);
  assert.ok(Number.isFinite(game.balance));
});
