import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRun } from '../src/game';
import { SkillTree, pegIds } from '../src/skills';

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}

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
