import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRun } from '../src/game';
import { SkillTree, LifeSkills, SKILLS, CHARGES, pegIds, luckyBucketReturn } from '../src/skills';
import { payoutTable } from '../src/payouts';

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}
function earned(balance = 1000): GameRun {
  const run = new GameRun('double');
  run.settle(run.drop(0)!.id, balance / 100);
  return run;
}

test('charge prices are halved, grow independently, and spend earned money', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = earned(10000);
  for (const kind of CHARGES) {
    for (const cost of [25, 50, 100, 200]) {
      assert.equal(tree.cost(kind), cost);
      const before = run.balance;
      assert.ok(tree.buy(run, 8, kind));
      assert.equal(run.balance, before - cost);
    }
    assert.equal(tree.level(kind), 4);
  }
});

test('house money, in-flight proceeds, insufficient cash and Normal mode cannot buy upgrades', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = new GameRun('double');
  for (const kind of SKILLS) assert.equal(tree.buy(run, 8, kind), false);
  const bet = run.drop(0)!;
  run.settle(bet.id, 10, .5);
  for (const kind of SKILLS) assert.equal(tree.buy(run, 8, kind), false);
  run.settle(bet.id, 0, .5);
  assert.ok(tree.buy(run, 8, 'bouncy'));
  const classic = new SkillTree('classic', storage);
  for (const kind of SKILLS) {
    assert.equal(tree.buy(earned(20), 8, kind), false);
    assert.equal(tree.buy(new GameRun('classic'), 8, kind), false);
    assert.equal(classic.buy(earned(), 8, kind), false);
    assert.equal(classic.level(kind), 0);
  }
  assert.deepEqual(new LifeSkills(8, classic).payouts([.4, .7, 1.2]), [.4, .7, 1.2]);
});

test('permanent counts survive death and fresh lives randomize positions with overlapping types', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = earned();
  for (const kind of CHARGES) for (let i = 0; i < 3; i++) tree.buy(run, 8, kind);
  const life = new LifeSkills(8, tree, () => 0);
  assert.deepEqual(life.remaining('bouncy'), ['0:0', '0:1', '0:2']);
  assert.deepEqual(life.remaining('split'), life.remaining('bouncy'));
  for (const kind of CHARGES) {
    assert.equal(new Set(life.remaining(kind)).size, 3);
    for (const id of life.remaining(kind)) {
      assert.equal(life.consume(kind, id), true);
      assert.equal(life.consume(kind, id), false);
    }
  }
  run.settle(run.drop(0)!.id, 0);
  assert.equal(run.busted, true);
  const restored = new SkillTree('double', storage);
  const next = new LifeSkills(8, restored, () => .999);
  for (const kind of CHARGES) {
    assert.equal(restored.level(kind), 3);
    assert.equal(next.remaining(kind).length, 3);
  }
  assert.ok(next.remaining('bouncy').every(id => id.startsWith('7:')));
});

test('syncing, switching risk and purchasing other skills never refill consumed charges', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = earned();
  tree.buy(run, 8, 'bouncy');
  tree.buy(run, 8, 'bucket');
  const life = new LifeSkills(8, tree, () => 0);
  life.consume('bouncy', '0:0');
  life.consume('bucket', '0');
  for (const risk of ['low', 'medium', 'high'] as const) {
    life.sync(tree);
    const base = payoutTable(risk, 8, 0);
    assert.deepEqual(life.payouts(base), base);
    assert.deepEqual(life.remaining('bouncy'), []);
  }
  tree.buy(run, 8, 'split');
  life.sync(tree);
  assert.deepEqual(life.remaining('bouncy'), []);
  assert.deepEqual(life.remaining('split'), ['0:0']);
  tree.buy(run, 8, 'bouncy');
  tree.buy(run, 8, 'bucket');
  life.sync(tree);
  assert.deepEqual(life.remaining('bouncy'), ['0:1']);
  assert.deepEqual(life.remaining('bucket'), ['1']);
});

test('Lucky Buckets pay the next whole multiplier once, even for split siblings', () => {
  assert.deepEqual([.1, .4, .7, 1, 1.2, 2, 110].map(luckyBucketReturn), [1, 1, 1, 2, 2, 3, 111]);
  const tree = new SkillTree('double', memoryStorage());
  tree.buy(earned(), 8, 'bucket');
  const life = new LifeSkills(8, tree, () => 0);
  const base = [.4, .7, 1.2];
  assert.deepEqual(life.payouts(base), [1, .7, 1.2]);
  const run = earned(100);
  const bet = run.drop(0)!;
  const first = life.payouts(base)[0];
  life.consume('bucket', '0');
  run.settle(bet.id, first, .5);
  run.settle(bet.id, life.payouts(base)[0], .5);
  assert.equal(run.balance, 70);
  assert.deepEqual(life.payouts(base), base);
  assert.deepEqual(new LifeSkills(8, tree, () => 0).payouts(base), [1, .7, 1.2]);
});

test('More Starting Money follows $150/$250/$500 with costs exactly ten times the new amount', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = earned(10000);
  for (const amount of [150, 250, 500]) {
    const before = run.balance;
    assert.equal(tree.cost('starting'), amount * 10);
    assert.ok(tree.buy(run, 8, 'starting'));
    assert.equal(run.balance, before - amount * 10);
    assert.equal(run.houseStake, 100, 'cannot retroactively change this life');
    assert.equal(tree.startingDrop, amount);
    const next = new GameRun('double', new SkillTree('double', storage).startingDrop);
    assert.equal(next.balance, 0);
    assert.equal(next.canSpend(25), false);
    assert.equal(next.drop(0)!.amount, amount);
  }
  assert.equal(tree.buy(earned(100000), 8, 'starting'), false);
  assert.equal(tree.cost('starting'), Infinity);
});

test('purchase caps match the visible layout and excess unlocks return on a larger board', () => {
  const storage = memoryStorage();
  storage.setItem('plinko-skills-double-v2', JSON.stringify({ version: 2,
    levels: { bouncy: pegIds(9).length, split: 0, bucket: 10, starting: 0 } }));
  const tree = new SkillTree('double', storage);
  const life = new LifeSkills(8, tree);
  assert.equal(life.remaining('bouncy').length, pegIds(8).length);
  assert.equal(life.remaining('bucket').length, 9);
  const rich = earned(1e30);
  assert.equal(tree.buy(rich, 8, 'bouncy'), false);
  assert.equal(tree.buy(rich, 8, 'bucket'), false);
  assert.ok(tree.buy(rich, 10, 'bouncy'));
  const next = new LifeSkills(10, tree);
  assert.equal(next.remaining('bouncy').length, pegIds(9).length + 1);
  assert.equal(next.remaining('bucket').length, 10);
});

test('spending the last money ends the life while keeping the bought upgrade', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = earned(25);
  assert.ok(tree.buy(run, 8, 'split'));
  assert.equal(run.busted, true);
  assert.equal(new SkillTree('double', storage).level('split'), 1);
});

test('old experimental skills are ignored and their original save stays untouched', () => {
  const storage = memoryStorage();
  const old = JSON.stringify({ version: 1, returnLevel: 9, pityLevel: 9, bouncyPegs: ['0:0'], luckyPegs: ['0:1'] });
  storage.setItem('plinko-skills-double-v1', old);
  const tree = new SkillTree('double', storage);
  for (const kind of SKILLS) assert.equal(tree.level(kind), 0);
  tree.buy(earned(), 8, 'bouncy');
  assert.equal(storage.getItem('plinko-skills-double-v1'), old);
  assert.equal(new SkillTree('double', storage).level('bouncy'), 1);
});

test('save failure never spends money or grants an upgrade; corrupt saves are rejected', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  for (const kind of SKILLS) {
    const tree = new SkillTree('double', storage);
    const run = earned(10000);
    assert.throws(() => tree.buy(run, 8, kind));
    assert.equal(run.balance, 10000);
    assert.equal(tree.level(kind), 0);
  }
  for (const raw of ['broken', '{"version":2}', ...[-1, 1.5, '1', 200].map(value =>
    JSON.stringify({ version: 2, levels: { bouncy: value, split: 0, bucket: 0, starting: 0 } }))]) {
    assert.throws(() => new SkillTree('double', { ...storage, getItem: () => raw }));
  }
});
