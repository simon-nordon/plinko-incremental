import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRun } from '../src/game';
import { IncrementalSkills, INCREMENTAL_SKILLS } from '../src/incremental';
import { LifeSkills, SkillTree } from '../src/skills';
import { resetAllProgress } from '../src/progress';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    get length() { return data.size; }, key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); } };
}

function earned() {
  const run = new GameRun('oneball');
  run.settle(run.drop(0)!.id, 1000);
  return run;
}

test('One Ball starts with $5, charges $1 and caps even wealthy runs at five balls', () => {
  const run = new GameRun('oneball');
  assert.equal(run.balance, 5);
  assert.equal(run.houseDropAvailable, false);
  assert.equal(run.maxBalls, 5);
  const bets = Array.from({ length: 5 }, () => run.drop(0)!);
  assert.ok(bets.every(bet => bet.cost === 1 && bet.amount === 1 && bet.tier === 0));
  assert.equal(run.balance, 0);
  assert.equal(run.activeBalls, 5);
  assert.equal(run.drop(0), null);
  assert.equal(run.busted, false);
  run.settle(bets[0].id, 100);
  assert.ok(run.drop(9), 'all tiers use the single $1 ball');
  assert.equal(run.balance, 99);
  assert.equal(run.drop(0), null, 'capacity applies even when the player can afford more');
});

test('payout value compounds 5% while cost and the loss threshold stay at $1', () => {
  const storage = memoryStorage();
  const tree = new IncrementalSkills(storage);
  const run = earned();
  for (let level = 1; level <= 3; level++) {
    const before = run.balance;
    const cost = tree.cost('value');
    assert.ok(tree.buy(run, 16, 'value'));
    assert.equal(run.balance, Math.round((before - cost) * 100) / 100);
    assert.equal(run.ballValue, 1.05 ** level);
  }
  const fresh = new GameRun('oneball', 10, new IncrementalSkills(storage).settings);
  assert.equal(fresh.balance, 5);
  const bets = Array.from({ length: 5 }, () => fresh.drop(0)!);
  assert.equal(bets[4].cost, 1, 'a balance below payout value still buys a $1 ball');
  assert.equal(fresh.minimumBet, 1);
  for (const bet of bets) fresh.settle(bet.id, 0);
  assert.equal(fresh.busted, true);
});

test('split children use slots, retain full value and refund cashback once per purchase', () => {
  const run = new GameRun('oneball', 10, { maxBalls: 5, ballValue: 1.05, cashback: .1 });
  const bet = run.drop(0)!;
  for (let i = 0; i < 4; i++) assert.ok(run.duplicate(bet.id, 1));
  assert.equal(run.active, 1);
  assert.equal(run.activeBalls, 5);
  assert.equal(run.inPlay, 5.25);
  assert.equal(run.duplicate(bet.id, 1), false);
  assert.equal(run.drop(0), null);
  run.settle(bet.id, 1, .2, 1);
  assert.equal(run.activeBalls, 4);
  assert.equal(run.inPlay, 4.2);
  assert.ok(run.drop(0), 'a child landing frees a slot immediately');
  for (let i = 0; i < 3; i++) run.settle(bet.id, 1, .2, 1);
  const result = run.settle(bet.id, 1, .2, 1)!;
  assert.equal(result.totalPayout, 5.35);
  assert.equal(result.totalProfit, 4.35);
  assert.equal(result.complete, true);
  assert.equal(run.settle(bet.id, 1, .2, 1), null);
});

test('every skill has independent growing prices and survives restart without affecting other modes', () => {
  const storage = memoryStorage();
  const tree = new IncrementalSkills(storage);
  const run = earned();
  for (const kind of INCREMENTAL_SKILLS) {
    const cost = tree.cost(kind);
    assert.ok(tree.buy(run, 16, kind));
    assert.ok(tree.cost(kind) > cost);
    assert.equal(tree.level(kind), 1);
  }
  assert.equal(run.maxBalls, 6);
  assert.equal(tree.settings.cashback, .05);
  const restored = new IncrementalSkills(storage);
  for (const kind of INCREMENTAL_SKILLS) assert.equal(restored.level(kind), 1);
  assert.equal(new SkillTree('double', storage).level('split'), 0);
  assert.equal(tree.buy(new GameRun('classic'), 16, 'value'), false);
  assert.equal(tree.buy(new GameRun('double'), 16, 'value'), false);
  resetAllProgress(storage);
  assert.equal(new IncrementalSkills(storage).level('value'), 0);
});

test('upgrades preserve a dollar and wait for every split child to land', () => {
  const tree = new IncrementalSkills(memoryStorage());
  const run = new GameRun('oneball');
  assert.equal(tree.buy(run, 16, 'capacity'), false);
  assert.ok(tree.buy(run, 16, 'bouncy'));
  assert.equal(run.balance, 1);
  const bet = run.drop(0)!;
  run.duplicate(bet.id, 1);
  run.settle(bet.id, 100, .5, 1);
  assert.equal(tree.buy(run, 16, 'value'), false);
  run.settle(bet.id, 1, .5, 1);
  assert.ok(tree.buy(run, 16, 'value'));
});

test('recharging restores purchased specials and syncing preserves spent charges', () => {
  const tree = new IncrementalSkills(memoryStorage());
  const run = earned();
  for (const kind of ['bouncy', 'split', 'bucket'] as const) tree.buy(run, 16, kind);
  const wave = new LifeSkills(16, tree, () => 0);
  for (const kind of ['bouncy', 'split', 'bucket'] as const) {
    assert.equal(wave.remaining(kind).length, 1);
    assert.ok(wave.consume(kind, wave.remaining(kind)[0]));
    wave.sync(tree);
    assert.equal(wave.remaining(kind).length, 0);
  }
  const recharged = new LifeSkills(16, tree, () => .5);
  for (const kind of ['bouncy', 'split', 'bucket'] as const) assert.equal(recharged.remaining(kind).length, 1);
});

test('cashback and capacity respect their maximums; a full refund waits for settlement', () => {
  const storage = memoryStorage();
  storage.setItem('plinko-skills-oneball-v1', JSON.stringify({ version: 1,
    levels: { capacity: 45, value: 0, bouncy: 0, split: 0, bucket: 0, cashback: 20 } }));
  const tree = new IncrementalSkills(storage);
  const run = new GameRun('oneball', 10, tree.settings);
  assert.equal(run.maxBalls, 50);
  assert.equal(tree.buy(run, 16, 'cashback'), false);
  assert.equal(tree.buy(run, 16, 'capacity'), false);
  const bet = run.drop(0)!;
  assert.equal(run.balance, 4);
  assert.equal(run.settle(bet.id, 0)!.payout, 1);
  assert.equal(run.balance, 5);
});

test('failed saves do not spend money or grant upgrades; corrupt saves remain untouched', () => {
  const run = earned();
  const before = run.balance;
  const tree = new IncrementalSkills({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.throws(() => tree.buy(run, 16, 'value'));
  assert.equal(run.balance, before);
  assert.equal(run.ballValue, 1);
  assert.equal(tree.level('value'), 0);
  for (const raw of ['broken', '{"version":1}', ...[-1, 1.5, '1', 46].map(capacity => JSON.stringify({ version: 1,
    levels: { capacity, value: 0, bouncy: 0, split: 0, bucket: 0, cashback: 0 } }))]) {
    const storage = memoryStorage();
    storage.setItem('plinko-skills-oneball-v1', raw);
    assert.throws(() => new IncrementalSkills(storage));
    assert.equal(storage.getItem('plinko-skills-oneball-v1'), raw);
  }
});
