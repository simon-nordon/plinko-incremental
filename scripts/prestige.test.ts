import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRun } from '../src/game';
import { bucketPayouts } from '../src/payouts';
import {
  BEGINNER_HITS, CASH_OUT_AT, DEBTS, PRESTIGE_SKILLS, PRESTIGE_SKILL_IDS, PrestigeProgress, STARTING_MONEY,
  beginnerCharges, centerBuckets, landingFactor, prestigePayouts,
} from '../src/prestige';
import { resetAllProgress } from '../src/progress';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

function funded(wallet: number, storage = memoryStorage()): PrestigeProgress {
  const progress = new PrestigeProgress(storage);
  progress.cashOut(wallet);
  return progress;
}

test('a Prestige run starts with $5 and only $1 balls until the first debt is paid', () => {
  const run = new GameRun('prestige');
  assert.equal(run.balance, 5);
  assert.equal(run.maxTier, 0);
  assert.equal(run.drop(1), null, '$10 balls are locked');
  const bet = run.drop(0)!;
  assert.equal(bet.amount, 1);
  run.settle(bet.id, 110);
  assert.equal(run.drop(1), null, 'money alone does not unlock bigger balls');
  run.setMaxTier(2);
  assert.equal(run.drop(1)!.amount, 10);
  assert.equal(run.drop(2)!.amount, 100);
  assert.equal(run.drop(3), null);
});

test('cash out appears at the price of the first skill and stays revealed', () => {
  assert.equal(CASH_OUT_AT, 10);
  assert.equal(PRESTIGE_SKILLS.beginnersLuck.price[0], 10);
  assert.equal(Math.min(...PRESTIGE_SKILL_IDS.map(id => PRESTIGE_SKILLS[id].price[0])), CASH_OUT_AT);
  const storage = memoryStorage();
  const progress = new PrestigeProgress(storage);
  assert.equal(progress.revealed, false);
  progress.reveal();
  assert.equal(new PrestigeProgress(storage).revealed, true);
});

test('cashing out banks the balance and skills are bought from the wallet', () => {
  const storage = memoryStorage();
  const progress = funded(12.5, storage);
  assert.equal(progress.wallet, 12.5);
  assert.equal(progress.canBuy('bucketSlider'), false, 'needs Beginner’s Luck first');
  assert.ok(progress.buy('beginnersLuck'));
  assert.equal(progress.wallet, 2.5);
  assert.equal(progress.buy('beginnersLuck'), false, 'single level');
  const restored = new PrestigeProgress(storage);
  assert.equal(restored.level('beginnersLuck'), 1);
  assert.equal(restored.wallet, 2.5);
});

test('peg skills cap at ten with increasing prices', () => {
  const progress = funded(1e12);
  let last = 0;
  for (let i = 0; i < 10; i++) {
    const cost = progress.cost('bouncyPegs');
    assert.ok(cost > last);
    last = cost;
    assert.ok(progress.buy('bouncyPegs'));
  }
  assert.equal(progress.buy('bouncyPegs'), false);
  assert.equal(progress.pegSkills.level('bouncy'), 10);
  assert.equal(progress.pegSkills.level('split'), 0);
  assert.ok(progress.buy('doublePegs'));
  assert.equal(progress.pegSkills.level('split'), 1);
  assert.equal(progress.pegSkills.level('bucket'), 0);
});

test('debts are paid in order, each unlocking a ten times larger ball', () => {
  assert.deepEqual(DEBTS.slice(0, 9).map(debt => debt.cost), [25, 100, 250, 1000, 20_000, 100_000, 500_000, 2_500_000, 6_000_000]);
  const storage = memoryStorage();
  const progress = funded(125, storage);
  assert.ok(progress.payDebt());
  assert.equal(progress.maxTier, 1);
  assert.ok(progress.payDebt());
  assert.equal(progress.maxTier, 2);
  assert.equal(progress.wallet, 0);
  assert.equal(progress.payDebt(), false);
  assert.equal(new PrestigeProgress(storage).debtsPaid, 2);
});

test('Beginner’s Luck pays 2× in the middle for three hits, then the base payout returns', () => {
  const progress = funded(10);
  progress.buy('beginnersLuck');
  const base = bucketPayouts('prestige', 16);
  const hits = new Map<number, number>();
  assert.deepEqual(centerBuckets(16), [8]);
  assert.deepEqual(centerBuckets(15), [7, 8]);
  for (let hit = 0; hit < BEGINNER_HITS; hit++) {
    assert.equal(beginnerCharges(progress, hits, 16, 8), BEGINNER_HITS - hit);
    assert.equal(prestigePayouts(base, progress, hits)[8], 2);
    hits.set(8, hit + 1);
  }
  assert.equal(prestigePayouts(base, progress, hits)[8], .1);
  assert.deepEqual(prestigePayouts(base, progress, hits), base);
  assert.equal(beginnerCharges(funded(0), new Map(), 16, 8), 0, 'nothing without the skill');
});

test('risk skills trade rewards for drawbacks', () => {
  const progress = funded(1e6);
  const base = bucketPayouts('prestige', 16);
  progress.buy('greed');
  assert.equal(prestigePayouts(base, progress, new Map())[0], 137.5);
  assert.equal(progress.keepRate, .85);
  assert.equal(progress.cashOut(100), 85);
  progress.buy('jackpotEdges');
  const edges = prestigePayouts(base, progress, new Map());
  assert.equal(edges[0], 275);
  assert.equal(edges[1], 102.5);
  assert.equal(edges[2], 12.5);
  assert.equal(edges[8], 0, 'skull center');
});

test('pity skills help small balls, low balances and the starting stake', () => {
  const progress = funded(1e6);
  assert.equal(landingFactor(progress, 0, 1, false), 1);
  assert.equal(landingFactor(progress, 0, 1, true), 2, 'bucket slider doubles');
  progress.buy('rookieLuck');
  progress.buy('pityLuck');
  assert.equal(landingFactor(progress, 0, 100, false), 1.05);
  assert.equal(landingFactor(progress, 1, 100, false), 1);
  assert.equal(landingFactor(progress, 1, 4, false), 1.1);
  assert.equal(progress.startingMoney, STARTING_MONEY[0]);
  progress.buy('startingMoney');
  assert.equal(progress.startingMoney, 10);
  assert.equal(new GameRun('prestige', 10, { maxTier: 0, startingMoney: progress.startingMoney }).balance, 10);
});

test('invalid saves are rejected without being overwritten, and dev reset clears prestige', () => {
  const storage = memoryStorage();
  for (const raw of ['{"version":2}', JSON.stringify({ version: 1, wallet: -1, debts: 0, revealed: false, levels: {} })]) {
    storage.setItem(PrestigeProgress.key, raw);
    assert.throws(() => new PrestigeProgress(storage));
    assert.equal(storage.getItem(PrestigeProgress.key), raw);
  }
  const failing = new PrestigeProgress({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.throws(() => failing.cashOut(50));
  assert.equal(failing.wallet, 0);
  const keys = [PrestigeProgress.key, 'plinko-prefs-prestige', 'unrelated'];
  const removed: string[] = [];
  resetAllProgress({ length: keys.length, key: i => keys[i], removeItem: key => { removed.push(key); } });
  assert.deepEqual(removed, [PrestigeProgress.key, 'plinko-prefs-prestige']);
});
