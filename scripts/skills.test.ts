import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameRun } from '../src/game';
import { SkillTree, LifeSkills, SKILLS, CHARGES, pegIds, interiorPegIds, pegSpawnWeight, binomialWeight, luckyBucketReturn, startingDropAt } from '../src/skills';
import { payoutTable } from '../src/payouts';
import { resetAllProgress } from '../src/progress';

function memoryStorage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } };
}
function earned(balance = 1000): GameRun {
  const run = new GameRun('double');
  run.settle(run.drop(0)!.id, balance / run.houseStake);
  return run;
}

test('developer reset clears both modes and legacy saves without touching other site data', () => {
  const keys = ['plinko-prefs', 'plinko-prefs-classic', 'plinko-prefs-double',
    'plinko-skills-classic-v3', 'plinko-skills-double-v1', 'plinko-skills-double-v2',
    'plinko-skills-double-v3', 'plinko-skills-double-v4', 'unrelated-preference'];
  const items = new Map(keys.map(key => [key, 'saved']));
  resetAllProgress({
    get length() { return items.size; },
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => { items.delete(key); },
  });
  assert.deepEqual([...items.keys()], ['unrelated-preference']);
  const fresh = new SkillTree('double', {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
  });
  assert.equal(fresh.startingDrop, 10);
  for (const kind of SKILLS) assert.equal(fresh.level(kind), 0);
});

test('all charge prices start at $10, doubling independently from earned money', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = earned(10000);
  for (const kind of CHARGES) {
    for (const cost of [10, 20, 40, 80]) {
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
  run.duplicate(bet.id);
  run.settle(bet.id, 10, .5);
  for (const kind of SKILLS) assert.equal(tree.buy(run, 8, kind), false);
  run.settle(bet.id, 0, .5);
  assert.ok(tree.buy(run, 8, 'bouncy'));
  const classic = new SkillTree('classic', storage);
  for (const kind of SKILLS) {
    assert.equal(tree.buy(earned(9), 8, kind), false);
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
  assert.deepEqual(life.remaining('bouncy'), ['0:1', '0:1', '0:1']);
  assert.deepEqual(life.remaining('split'), life.remaining('bouncy'));
  for (const kind of CHARGES) {
    const charges = life.remaining(kind);
    assert.equal(charges.length, 3);
    for (const id of charges) assert.equal(life.consume(kind, id), true);
    assert.equal(life.consume(kind, charges[0]), false);
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
  life.consume('bouncy', '0:1');
  life.consume('bucket', '0');
  for (const risk of ['low', 'medium', 'high', 'extreme'] as const) {
    life.sync(tree);
    const base = payoutTable(risk, 8, 0);
    assert.deepEqual(life.payouts(base), base);
    assert.deepEqual(life.remaining('bouncy'), []);
  }
  tree.buy(run, 8, 'split');
  life.sync(tree);
  assert.deepEqual(life.remaining('bouncy'), []);
  assert.deepEqual(life.remaining('split'), ['0:1']);
  tree.buy(run, 8, 'bouncy');
  tree.buy(run, 8, 'bucket');
  life.sync(tree);
  assert.deepEqual(life.remaining('bouncy'), ['0:1']);
  assert.deepEqual(life.remaining('bucket'), ['1']);
});

test('Golden Buckets double their multiplier once, even for full-value duplicates', () => {
  assert.deepEqual([.1, .4, .7, 1, 1.2, 2, 110].map(luckyBucketReturn), [.2, .8, 1.4, 2, 2.4, 4, 220]);
  const tree = new SkillTree('double', memoryStorage());
  tree.buy(earned(), 8, 'bucket');
  const life = new LifeSkills(8, tree, () => 0);
  const base = [.4, .7, 1.2];
  assert.deepEqual(life.payouts(base), [.8, .7, 1.2]);
  const run = earned(100);
  const bet = run.drop(0)!;
  run.duplicate(bet.id);
  const first = life.payouts(base)[0];
  life.consume('bucket', '0');
  run.settle(bet.id, first, .5);
  run.settle(bet.id, life.payouts(base)[0], .5);
  assert.equal(run.balance, 120);
  assert.deepEqual(life.payouts(base), base);
  assert.deepEqual(new LifeSkills(8, tree, () => 0).payouts(base), [.8, .7, 1.2]);
});

test('starting money continues past $500 and every upgrade costs ten times its new amount', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = earned(1e9);
  assert.equal(tree.startingDrop, 10);
  for (const amount of [20, 50, 100, 150, 250, 500, 1000, 1500, 2500, 5000, 10000, 15000, 25000, 50000, 100000]) {
    assert.equal(tree.cost('starting'), amount * 10);
    const before = run.balance;
    assert.ok(tree.buy(run, 8, 'starting'));
    assert.equal(run.balance, before - amount * 10);
    assert.equal(run.houseStake, 10, 'starting changes take effect next life');
    assert.equal(tree.startingDrop, amount);
    const next = new GameRun('double', new SkillTree('double', storage).startingDrop);
    assert.equal(next.balance, 0);
    assert.equal(next.minimumBet, amount / 10);
    assert.equal(next.canSpend(1), false);
    assert.equal(next.drop(0)!.amount, amount);
  }
  assert.ok(tree.canBuy(run, 8, 'starting'));
  for (const level of [30, 60, 100]) {
    assert.ok(Number.isFinite(startingDropAt(level)));
    assert.ok(startingDropAt(level + 1) > startingDropAt(level));
  }
});

test('version 2 saves keep purchased starting amounts and migrate without spending or overwriting', () => {
  for (const [oldLevel, amount] of [[0, 10], [1, 150], [2, 250], [3, 500]]) {
    const storage = memoryStorage();
    const raw = JSON.stringify({ version: 2, levels: { bouncy: 2, split: 3, bucket: 1, starting: oldLevel } });
    storage.setItem('plinko-skills-double-v2', raw);
    const tree = new SkillTree('double', storage);
    assert.equal(tree.startingDrop, amount);
    assert.equal(tree.level('split'), 3);
    assert.ok(tree.buy(earned(), 8, 'bucket'));
    assert.equal(storage.getItem('plinko-skills-double-v2'), raw);
    assert.equal(new SkillTree('double', storage).startingDrop, amount);
  }
});

test('version 3 saves retain starting amounts after inserting the $20 upgrade', () => {
  for (const [level, amount] of [10, 50, 100, 150, 250, 500, 1000, 1500, 2500, 5000, 10000].entries()) {
    const storage = memoryStorage();
    const raw = JSON.stringify({ version: 3, levels: { bouncy: 2, split: 1, bucket: 0, starting: level } });
    storage.setItem('plinko-skills-double-v3', raw);
    const tree = new SkillTree('double', storage);
    assert.equal(tree.startingDrop, amount);
    assert.ok(tree.buy(earned(), 8, 'bucket'));
    assert.equal(new SkillTree('double', storage).startingDrop, amount);
    assert.equal(storage.getItem('plinko-skills-double-v3'), raw);
  }
});

test('occupied pegs reroll exactly once, then stack while preserving every charge', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = earned();
  tree.buy(run, 8, 'bouncy');
  tree.buy(run, 8, 'bouncy');
  tree.buy(run, 8, 'split');
  const values = [0, 0, .999, 0, 0, 0, 0];
  let rolls = 0;
  const life = new LifeSkills(8, tree, () => values[rolls++] ?? 0);
  assert.equal(rolls, 5, 'first placement rolls once, each occupied roll gets exactly one retry');
  assert.equal(life.remaining('bouncy').length, 2);
  assert.equal(new Set(life.remaining('bouncy')).size, 2, 'first reroll found an empty peg');
  assert.deepEqual(life.remaining('split'), ['0:1']);
  tree.buy(run, 8, 'split');
  life.sync(tree);
  assert.equal(rolls, 7, 'the occupied reroll result is accepted without a third roll');
  assert.deepEqual(life.remaining('split'), ['0:1', '0:1']);
});

test('peg weights follow a binomial path from the top center at every row', () => {
  for (let rows = 8; rows <= 16; rows++) {
    for (let row = 0; row < rows; row++) {
      const weights = Array.from({ length: row + 1 }, (_, k) => pegSpawnWeight(`${row}:${k + 1}`));
      assert.equal(weights.reduce((sum, value) => sum + value, 0), 1);
      assert.deepEqual(weights, [...weights].reverse());
      for (let k = 0; k <= row; k++) {
        const probability = row === 0 ? 1 : (binomialWeight(row - 1, k - 1) + binomialWeight(row - 1, k)) / 2;
        assert.equal(weights[k], probability);
      }
      assert.equal(pegSpawnWeight(`${row}:0`), 0);
      assert.equal(pegSpawnWeight(`${row}:${row + 2}`), 0);
    }
  }
});

test('actual peg and Golden Bucket placement samples the binomial distribution', () => {
  const tree = new SkillTree('double', memoryStorage());
  const run = earned();
  tree.buy(run, 8, 'bouncy');
  tree.buy(run, 8, 'bucket');
  const pegs = new Map<string, number>();
  const buckets = Array<number>(9).fill(0);
  // Evenly spaced rolls cover the CDF exactly, without flaky random sampling.
  for (let i = 0; i < 1024; i++) {
    const life = new LifeSkills(8, tree, () => (i + .5) / 1024);
    const id = life.remaining('bouncy')[0];
    pegs.set(id, (pegs.get(id) ?? 0) + 1);
    buckets[Number(life.remaining('bucket')[0])]++;
  }
  assert.deepEqual(buckets, [1, 8, 28, 56, 70, 56, 28, 8, 1].map(value => value * 4));
  assert.equal(pegs.get('0:1'), 128);
  assert.deepEqual(Array.from({ length: 8 }, (_, k) => pegs.get(`7:${k + 1}`)), [1, 7, 21, 35, 35, 21, 7, 1]);
});

test('special pegs never occupy either outer edge on any layout', () => {
  const storage = memoryStorage();
  storage.setItem('plinko-skills-double-v2', JSON.stringify({ version: 2,
    levels: { bouncy: pegIds(16).length, split: pegIds(16).length, bucket: 0, starting: 0 } }));
  const tree = new SkillTree('double', storage);
  for (let rows = 8; rows <= 16; rows++) {
    const life = new LifeSkills(rows, tree);
    for (const kind of ['bouncy', 'split'] as const) {
      assert.equal(life.remaining(kind).length, interiorPegIds(rows).length);
      for (const id of life.remaining(kind)) {
        const [row, col] = id.split(':').map(Number);
        assert.ok(col > 0 && col < row + 2);
      }
    }
  }
});

test('purchase caps match the visible layout and excess unlocks return on a larger board', () => {
  const storage = memoryStorage();
  storage.setItem('plinko-skills-double-v2', JSON.stringify({ version: 2,
    levels: { bouncy: interiorPegIds(9).length, split: 0, bucket: 10, starting: 0 } }));
  const tree = new SkillTree('double', storage);
  const life = new LifeSkills(8, tree);
  assert.equal(life.remaining('bouncy').length, interiorPegIds(8).length);
  assert.equal(life.remaining('bucket').length, 9);
  const rich = earned(1e30);
  assert.equal(tree.buy(rich, 8, 'bouncy'), false);
  assert.equal(tree.buy(rich, 8, 'bucket'), false);
  assert.ok(tree.buy(rich, 10, 'bouncy'));
  const next = new LifeSkills(10, tree);
  assert.equal(next.remaining('bouncy').length, interiorPegIds(9).length + 1);
  assert.equal(next.remaining('bucket').length, 10);
});

test('upgrade purchases cannot leave less than the next ball threshold', () => {
  const storage = memoryStorage();
  const tree = new SkillTree('double', storage);
  const run = earned(10);
  assert.equal(tree.buy(run, 8, 'split'), false);
  assert.equal(run.balance, 10);
  assert.equal(run.busted, false);
  assert.equal(new SkillTree('double', storage).level('split'), 0);
  const enough = earned(20);
  assert.ok(tree.buy(enough, 8, 'split'));
  assert.ok(enough.drop(0));
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
  const legacy = memoryStorage();
  legacy.setItem('plinko-skills-double-v2', JSON.stringify({ version: 2,
    levels: { bouncy: 0, split: 0, bucket: 0, starting: 4 } }));
  assert.throws(() => new SkillTree('double', legacy));
});
