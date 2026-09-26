import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRun } from '../src/game';
import { SkillTree, pegIds } from '../src/skills';
import { payoutTable } from '../src/payouts';

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}

test('Pity uses the pre-drop balance: below $100 qualifies, exactly $100 and above do not', () => {
  const tree = new SkillTree('double', memoryStorage());
  assert.equal(tree.pityActive(50), false);
  assert.ok(tree.buyPity(new GameRun('double')));
  for (const [balance, expected] of [[99.99, 1.05], [100, 1], [100.01, 1], [10, 1.05]]) {
    const run = new GameRun('double');
    run.balance = balance;
    const before = tree.improvePayouts([.1, 1, 110], run.balance);
    const bet = run.drop(0)!;
    assert.equal(run.balance, 0);
    const during = tree.improvePayouts([.1, 1, 110], run.balance + run.inPlay);
    assert.deepEqual(during, before);
    assert.deepEqual(during, [.1, 1, 110].map(n => n * expected));
    const result = run.settle(bet.id, during[1])!;
    assert.equal(result.payout, Math.round(balance * expected * 100) / 100);
  }
});

test('Pity stacks with other bonuses and follows balance changes between drops', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = new GameRun('double');
  run.balance = 200;
  tree.buyReturn(run);
  tree.buyPity(run);
  assert.equal(run.balance, 100);
  assert.equal(tree.pityActive(run.balance), false);
  const bet = run.drop(0)!;
  run.settle(bet.id, .5);
  assert.equal(tree.pityActive(run.balance), true);
  const base = payoutTable('medium', 16, 10);
  assert.deepEqual(tree.improvePayouts(base, run.balance), base.map(n => n * 1.05 * 1.05));
  const next = run.drop(0)!;
  run.settle(next.id, 3);
  assert.equal(tree.pityActive(run.balance), false);
});

test('Pity is a one-time purchase retained alongside older skills after death and reload', () => {
  const storage = memoryStorage();
  storage.setItem('plinko-skills-double-v1', JSON.stringify({ version: 1, bouncyPegs: ['0:1'], returnLevel: 2 }));
  const tree = new SkillTree('double', storage);
  assert.equal(tree.hasPity, false);
  const run = new GameRun('double');
  run.balance = 50;
  assert.ok(tree.buyPity(run));
  assert.equal(run.busted, true);
  const restored = new SkillTree('double', storage);
  assert.equal(restored.hasPity, true);
  assert.equal(restored.returnLevel, 2);
  assert.deepEqual(restored.bouncyPegs, ['0:1']);
  const fresh = new GameRun('double');
  assert.equal(restored.buyPity(fresh), false);
  assert.equal(fresh.balance, 100);
  restored.buy(fresh, 8);
  assert.equal(new SkillTree('double', storage).hasPity, true);
  const classic = new SkillTree('classic', storage);
  assert.equal(classic.buyPity(new GameRun('double')), false);
  assert.deepEqual(classic.improvePayouts([1, 2], 50), [1, 2]);
  assert.equal(tree.buyPity(new GameRun('classic')), false);
});

test('Pity purchase fails safely when in flight, unaffordable or unable to save', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = new GameRun('double');
  const bet = run.drop(0)!;
  assert.equal(tree.buyPity(run), false);
  run.settle(bet.id, .2);
  assert.equal(tree.buyPity(run), false);
  assert.equal(run.balance, 20);
  const broken = new SkillTree('double', { getItem: () => null, setItem() { throw new Error('quota'); } });
  const fresh = new GameRun('double');
  assert.throws(() => broken.buyPity(fresh));
  assert.equal(fresh.balance, 100);
  assert.equal(broken.hasPity, false);
});

test('Bucket Return adds 5% per level, stacks with Luck and pays the displayed return', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = new GameRun('double');
  run.balance = 1000;
  for (let level = 1; level <= 3; level++) {
    const cost = 50 * 2 ** (level - 1);
    const before = run.balance;
    assert.equal(tree.returnCost, cost);
    assert.equal(tree.buyReturn(run), true);
    assert.equal(run.balance, before - cost);
    assert.equal(tree.returnLevel, level);
    assert.equal(tree.returnMultiplier, 1 + level * .05);
    for (const risk of ['low', 'medium', 'high'] as const) {
      for (const rows of [8, 16]) {
        const base = payoutTable(risk, rows, 10);
        assert.deepEqual(tree.improvePayouts(base), base.map(n => n * (1 + level * .05)));
      }
    }
  }
  const wager = run.drop(0)!;
  const multiplier = tree.improvePayouts([2])[0];
  assert.equal(run.settle(wager.id, multiplier)!.payout, 1495);
});

test('old saves migrate safely and both skills survive purchases, death and reload', () => {
  const storage = memoryStorage();
  storage.setItem('plinko-skills-double-v1', JSON.stringify({ version: 1, bouncyPegs: ['0:1'] }));
  const tree = new SkillTree('double', storage);
  assert.equal(tree.returnLevel, 0);
  const run = new GameRun('double');
  run.balance = 150;
  assert.ok(tree.buyReturn(run));
  assert.ok(tree.buy(run, 8));
  assert.equal(run.busted, true);
  const restored = new SkillTree('double', storage);
  assert.equal(restored.returnLevel, 1);
  assert.equal(restored.level, 2);
  assert.equal(restored.returnCost, 100);
  assert.ok(restored.bouncyPegs.includes('0:1'));
  const classic = new SkillTree('classic', storage);
  assert.deepEqual(classic.improvePayouts([.1, 2, 110]), [.1, 2, 110]);
  assert.equal(classic.buyReturn(new GameRun('double')), false);
  assert.equal(restored.buyReturn(new GameRun('classic')), false);
});

test('Bucket Return rejects in-flight, unaffordable and failed-save purchases without charging', () => {
  const run = new GameRun('double');
  const tree = new SkillTree('double', memoryStorage());
  const bet = run.drop(0)!;
  assert.equal(tree.buyReturn(run), false);
  run.settle(bet.id, .2);
  assert.equal(tree.buyReturn(run), false);
  assert.equal(run.balance, 20);
  run.balance = 100;
  const broken = new SkillTree('double', { getItem: () => null, setItem: () => { throw new Error('quota'); } });
  assert.throws(() => broken.buyReturn(run));
  assert.equal(run.balance, 100);
  assert.equal(broken.returnLevel, 0);
  for (const value of [-1, 1.5, '1']) {
    assert.throws(() => new SkillTree('double', { getItem: () => JSON.stringify({ version: 1, bouncyPegs: [], returnLevel: value }), setItem() {} }));
  }
});

test('cash purchases upgrade unique pegs and cost $50, $100, $200, $400', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = new GameRun('double');
  run.balance = 1000;
  for (const cost of [50, 100, 200, 400]) {
    assert.equal(tree.cost, cost);
    const before = run.balance;
    assert.ok(tree.buy(run, 8, () => 0));
    assert.equal(run.balance, before - cost);
  }
  assert.equal(tree.level, 4);
  assert.equal(new Set(tree.bouncyPegs).size, 4);
  assert.equal(tree.buy(run, 8), null);
  assert.equal(run.balance, 250);
});

test('death, a fresh run, reload and mode changes preserve only Double or Nothing upgrades', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = new GameRun('double');
  const id = tree.buy(run, 16, () => .999);
  const wager = run.drop(0)!;
  run.settle(wager.id, 0);
  assert.equal(run.busted, true);
  const reloaded = new SkillTree('double', storage);
  assert.deepEqual(reloaded.bouncyPegs, [id]);
  assert.equal(reloaded.cost, 100);
  assert.equal(reloaded.canBuy(new GameRun('double'), 16), true);
  assert.equal(reloaded.available(8).length, pegIds(8).length);
  assert.equal(reloaded.available(16).length, pegIds(16).length - 1);
  const classic = new SkillTree('classic', storage);
  assert.deepEqual(classic.bouncyPegs, []);
  assert.equal(classic.buy(new GameRun('double'), 16), null);
  const classicRun = new GameRun('classic');
  classicRun.balance = 1000;
  assert.equal(reloaded.buy(classicRun, 16), null);
});

test('purchases are blocked in flight and when every visible peg is upgraded', () => {
  const storage = memoryStorage();
  const run = new GameRun('double');
  const tree = new SkillTree('double', storage);
  const bet = run.drop(0)!;
  assert.equal(tree.buy(run, 8), null);
  run.settle(bet.id, 2);
  storage.setItem(tree.key, JSON.stringify({ version: 1, bouncyPegs: pegIds(8) }));
  const full = new SkillTree('double', storage);
  run.balance = 1e30;
  assert.equal(full.buy(run, 8), null);
  assert.ok(full.buy(run, 9));
});

test('an exact-balance purchase ends the run but retains the permanent upgrade', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = new GameRun('double');
  run.balance = 50;
  assert.ok(tree.buy(run, 8));
  assert.equal(run.busted, true);
  assert.equal(new SkillTree('double', storage).level, 1);
});

test('save failures never spend money or grant upgrades; invalid saves are not overwritten', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const tree = new SkillTree('double', storage);
  const run = new GameRun('double');
  assert.throws(() => tree.buy(run, 8));
  assert.equal(run.balance, 100);
  assert.equal(tree.level, 0);
  for (const raw of ['broken', '{"version":2}', '{"version":1,"bouncyPegs":["0:0","0:0"]}']) {
    assert.throws(() => new SkillTree('double', { ...storage, getItem: () => raw }));
  }
});
