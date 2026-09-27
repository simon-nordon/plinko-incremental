import assert from 'node:assert/strict';
import { test } from 'node:test';
import Matter from 'matter-js';
import { Board, BOUNCY_PEG_KICK } from '../src/board';
import { GameRun } from '../src/game';
import { pegIds } from '../src/skills';
import { DEFAULT_PHYSICS, MAX_ROWS, MIN_ROWS, type PhysicsSettings } from '../src/config';

const STEP = 1 / 120;
const canvas = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
// Inspect physical state without adding a test-only interface to the game.
const state = (board: Board) => board as unknown as {
  engine: Matter.Engine;
  pegs: { id: string; bouncy: number; split: number }[];
  balls: { body: Matter.Body; r: number; costShare: number }[];
};

test('a split peg creates two half-value bodies, then stays ordinary', () => seeded(() => {
  const run = new GameRun('double', 100);
  const shares: number[] = [];
  const board = new Board(canvas, { onPegHit() {}, onDuplicate(id) { run.duplicate(id); }, onLand(_k, _tier, id, share) {
    shares.push(share);
    run.settle(id, 1, share);
  } });
  board.setLayout(16, []);
  board.setPegCharges([], ['0:1']);
  const wager = run.drop(0)!;
  board.drop(0, wager.id);
  board.update(STEP);
  Matter.Body.setPosition(state(board).balls[0].body, { x: 380.5, y: 0 });
  Matter.Body.setVelocity(state(board).balls[0].body, { x: 0, y: 0 });
  for (let i = 0; i < 120 && board.active < 2; i++) board.update(STEP);
  assert.equal(board.active, 2);
  assert.deepEqual(state(board).balls.map(b => b.costShare), [.5, .5]);
  assert.equal(state(board).pegs.find(p => p.id === '0:1')!.split, 0);
  for (let i = 0; i < 120 * 31 && board.active; i++) board.update(STEP);
  assert.deepEqual(shares, [.5, .5]);
  assert.equal(run.balance, 100);
  assert.equal(run.active, 0);
}));

test('stacked effects each fire once per life and split shares conserve the wager', () => seeded(() => {
  const run = new GameRun('double', 100);
  const consumed = new Set<string>();
  let landedShare = 0;
  const board = new Board(canvas, { onPegHit() {},
    onDuplicate(id) { run.duplicate(id); },
    onChargeUsed(kind, id) {
      const key = kind + id;
      assert.equal(consumed.has(key), false, 'no charge may activate twice');
      consumed.add(key);
    },
    onLand(_k, _tier, id, share) { landedShare += share; run.settle(id, 1, share); }
  });
  board.setLayout(8, []);
  const ids = pegIds(8);
  board.setPegCharges(ids, ids);
  const wager = run.drop(0)!;
  board.drop(0, wager.id);
  for (let i = 0; i < 120 * 31 && board.active; i++) {
    board.update(STEP);
    assert.ok(board.active <= ids.length + 1);
  }
  assert.ok(consumed.size > 0);
  for (const key of consumed) {
    if (key.startsWith('bouncy')) assert.ok(consumed.has('split' + key.slice(6)));
  }
  assert.equal(landedShare, 1);
  assert.equal(run.balance, 100);
  assert.equal(run.active, 0);
  assert.ok(state(board).pegs.every(p => p.bouncy === p.split));
}));

test('a spent stacked peg has no effect on a later ball in the same life', () => seeded(() => {
  const used: string[] = [];
  const board = new Board(canvas, { onPegHit() {}, onLand() {}, onChargeUsed(kind) { used.push(kind); } });
  board.setLayout(16, []);
  board.setPegCharges(['0:1'], ['0:1']);
  for (let drop = 0; drop < 2; drop++) {
    board.drop(0, drop);
    board.update(STEP);
    Matter.Body.setPosition(state(board).balls[0].body, { x: 380.5, y: 0 });
    Matter.Body.setVelocity(state(board).balls[0].body, { x: 0, y: 0 });
    let maxBodies = board.active;
    for (let i = 0; i < 120 * 31 && board.active; i++) {
      board.update(STEP);
      maxBodies = Math.max(maxBodies, board.active);
    }
    assert.equal(maxBodies, drop === 0 ? 2 : 1);
  }
  assert.deepEqual(used, ['bouncy', 'split']);
}));

test('same-type charges stack and divide value among the resulting balls', () => seeded(() => {
  const run = new GameRun('double', 100);
  const used: string[] = [];
  const board = new Board(canvas, {
    onPegHit() {},
    onDuplicate(id) { run.duplicate(id); },
    onChargeUsed(kind) { used.push(kind); },
    onLand(_k, _tier, id, share) { run.settle(id, 1, share); },
  });
  board.setLayout(16, []);
  board.setPegCharges([], ['0:1', '0:1']);
  const wager = run.drop(0)!;
  board.drop(0, wager.id);
  board.update(STEP);
  Matter.Body.setPosition(state(board).balls[0].body, { x: 380.5, y: 0 });
  Matter.Body.setVelocity(state(board).balls[0].body, { x: 0, y: 0 });
  for (let i = 0; i < 120 && board.active < 3; i++) board.update(STEP);
  assert.equal(board.active, 3);
  assert.deepEqual(used, ['split', 'split']);
  assert.deepEqual(state(board).balls.map(ball => ball.costShare), [1 / 3, 1 / 3, 1 / 3]);
  assert.equal(run.inPlay, 100);
}));

function seeded<T>(fn: () => T): T {
  const original = Math.random;
  let seed = 417;
  Math.random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try { return fn(); } finally { Math.random = original; }
}

test('Prestige double pegs never run out, pay full child value and trigger once per lineage', () => seeded(() => {
  const run = new GameRun('prestige');
  const used: string[] = [];
  let landedValue = 0;
  let landedCost = 0;
  const board = new Board(canvas, { onPegHit() {},
    onDuplicate: (id, extra) => run.duplicate(id, extra),
    onChargeUsed(kind) { used.push(kind); },
    onLand(_bucket, _tier, id, cost, value) {
      landedCost += cost;
      landedValue += value;
      run.settle(id, 1, cost, value);
    },
  });
  board.fullValueSplits = board.persistentPegs = true;
  board.setLayout(16, []);
  board.setPegCharges([], ['0:1']);
  for (let drop = 0; drop < 2; drop++) {
    board.drop(0, run.drop(0)!.id);
    board.update(STEP);
    Matter.Body.setPosition(state(board).balls[0].body, { x: 380.5, y: 0 });
    Matter.Body.setVelocity(state(board).balls[0].body, { x: 0, y: 0 });
    for (let i = 0; i < 120 * 31 && board.active; i++) board.update(STEP);
    assert.equal(board.active, 0);
  }
  assert.deepEqual(used, [], 'persistent pegs are never consumed');
  assert.equal(state(board).pegs.find(peg => peg.id === '0:1')!.split, 1);
  assert.equal(landedCost, 2);
  assert.equal(landedValue, 4, 'each drop doubled exactly once');
  assert.equal(run.balance, 7);
}));

test('Bouncy Balls spawn with 200% bounciness regardless of the Tuning slider', () => {
  const board = new Board(canvas, { onPegHit() {}, onLand() {} });
  board.setLayout(16, []);
  board.drop(0, 0, true);
  board.drop(0, 0, false);
  for (let i = 0; i < 60 && state(board).balls.length < 2; i++) board.update(STEP);
  const [bouncy, normal] = state(board).balls as unknown as { bouncy: boolean; bumperKick: number; body: Matter.Body }[];
  assert.equal(bouncy.bouncy, true);
  assert.equal(bouncy.body.restitution, 1);
  assert.ok(bouncy.bumperKick > 0);
  assert.equal(normal.bouncy, false);
  assert.equal(normal.bumperKick, 0);
});

/** A controlled, slightly off-centre impact on the top middle pin. */
function rebound(bounce: number, changeAfterSpawn?: number, bouncy = false, startX = 380.5): { height: number; upwardSpeed: number; outwardSpeed: number; tangentSpeed: number } {
  let hits = 0;
  const board = new Board(canvas, { onPegHit() { hits++; }, onLand() {} });
  board.setPhysics({ ...DEFAULT_PHYSICS, bounce });
  board.setLayout(16, []);
  board.setPegCharges(bouncy ? ['0:1'] : [], []);
  board.drop(0);
  seeded(() => board.update(STEP));
  const ball = state(board).balls[0].body;
  Matter.Body.setPosition(ball, { x: startX, y: 0 });
  Matter.Body.setVelocity(ball, { x: 0, y: 0 });
  if (changeAfterSpawn !== undefined) board.setPhysics({ ...DEFAULT_PHYSICS, bounce: changeAfterSpawn });
  for (let i = 0; i < 120 && hits === 0; i++) board.update(STEP);
  assert.ok(hits > 0, 'ball must strike the pin');
  const impactY = ball.position.y;
  const upwardSpeed = -ball.velocity.y;
  const dx = ball.position.x - 380;
  const dy = ball.position.y - 36;
  const distance = Math.hypot(dx, dy);
  const outwardSpeed = (ball.velocity.x * dx + ball.velocity.y * dy) / distance;
  const tangentSpeed = (ball.velocity.x * -dy + ball.velocity.y * dx) / distance;
  let minY = impactY;
  for (let i = 0; i < 120 && ball.velocity.y < 0; i++) {
    board.update(STEP);
    minY = Math.min(minY, ball.position.y);
  }
  return { height: impactY - minY, upwardSpeed, outwardSpeed, tangentSpeed };
}

test('default ball visibly rebounds upward; bounce slider increases rebound', () => {
  const dead = rebound(0.3);
  const normal = rebound(DEFAULT_PHYSICS.bounce);
  const bumper = rebound(2);
  // Reference damping still leaves an upward arc of most of the ball's 8 px radius.
  assert.ok(normal.height > 6, `expected a visible arc, got ${normal.height.toFixed(2)} px`);
  assert.ok(normal.height > dead.height * 2);
  assert.ok(bumper.upwardSpeed > normal.upwardSpeed + 1, 'pinball impulse must survive collision resolution');
});

test('changing bounce affects new balls and preserves an existing ball rebound', () => {
  assert.deepEqual(rebound(2, 0.3), rebound(2));
  assert.deepEqual(rebound(0.3, 5), rebound(0.3));
});

test('charged pegs add a fixed tangent kick for both grazing and head-on hits', () => {
  for (const bounce of [0.3, DEFAULT_PHYSICS.bounce, 2]) {
    const grazingOffset = 4 * (1 + DEFAULT_PHYSICS.ballSize) * .85;
    for (const x of [380 - grazingOffset, 380.5, 380 + grazingOffset]) {
      const normal = rebound(bounce, undefined, false, x);
      const upgraded = rebound(bounce, undefined, true, x);
      const tangent = normal.tangentSpeed + BOUNCY_PEG_KICK * Math.sign(normal.tangentSpeed);
      const cap = Math.min(1, 16 / Math.hypot(normal.outwardSpeed, tangent));
      assert.ok(Math.abs(upgraded.outwardSpeed - normal.outwardSpeed * cap) < 1e-8);
      assert.ok(Math.abs(upgraded.tangentSpeed - tangent * cap) < 1e-8);
      assert.ok(Math.abs(upgraded.tangentSpeed) > 10, 'grazes must still launch visibly');
    }
  }
});

test('balls spawn clear of the chute walls at either edge for every ball size', () => {
  const original = Math.random;
  try {
    for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) {
      for (const ballSize of [0.5, 2, 2.5]) {
        for (const edge of [0, 1]) {
          Math.random = () => edge;
          const board = new Board(canvas, { onPegHit() {}, onLand() {} });
          board.setLayout(rows, []);
          board.setPhysics({ ...DEFAULT_PHYSICS, ballSize });
          board.drop(0);
          board.update(STEP);
          const { engine, balls } = state(board);
          const obstacles = Matter.Composite.allBodies(engine.world).filter(b => b.isStatic);
          assert.equal(Matter.Query.collides(balls[0].body, obstacles).length, 0);
        }
      }
    }
  } finally { Math.random = original; }
});

test('default drops reach actual buckets on every layout without timeout payouts', () => seeded(() => {
  for (let rows = MIN_ROWS; rows <= MAX_ROWS; rows++) {
    let landed = 0;
    let body: Matter.Body;
    let radius = 0;
    let hits = 0;
    const board = new Board(canvas, {
      onPegHit() { hits++; },
      onLand(bucket, tier) {
        landed++;
        assert.equal(tier, 0);
        assert.ok(bucket >= 0 && bucket < board.buckets);
        assert.ok(body.position.y + radius >= 565, `${rows} rows: ball timed out above the buckets`);
      },
    });
    board.setLayout(rows, []);
    for (let drop = 0; drop < 40; drop++) {
      board.drop(0);
      let elapsed = 0;
      while (board.active && elapsed < 31) {
        board.update(STEP);
        const ball = state(board).balls[0];
        if (ball) {
          body = ball.body;
          radius = ball.r;
          assert.ok(Number.isFinite(body.position.x + body.position.y));
        }
        elapsed += STEP;
      }
      assert.equal(board.active, 0, `${rows} rows: drop stuck`);
    }
    assert.equal(landed, 40);
    assert.ok(hits / landed > rows, `${rows} rows: balls should repeatedly bounce through the pins`);
  }
}));

test('fixed-step results match at 30, 60 and 144 Hz, including queued drops', () => {
  const run = (fps: number) => seeded(() => {
    const landings: number[] = [];
    const board = new Board(canvas, { onPegHit() {}, onLand(k) { landings.push(k); } });
    board.setLayout(16, []);
    for (let i = 0; i < 12; i++) board.drop(i % 5);
    for (let i = 0; i < fps * 40 && board.active; i++) board.update(1 / fps);
    assert.equal(board.active, 0);
    assert.equal(landings.length, 12);
    return landings;
  });
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(144), run(60));
});

test('queued balls return the matching wager IDs even when they land out of order', () => seeded(() => {
  const landed = new Map<number, number>();
  const board = new Board(canvas, {
    onPegHit() {},
    onLand(_bucket, tier, wagerId) {
      assert.equal(landed.has(wagerId), false);
      landed.set(wagerId, tier);
    },
  });
  board.setLayout(16, []);
  for (let tier = 0; tier < 5; tier++) board.drop(tier, 100 + tier);
  for (let tick = 0; tick < 60 * 40 && board.active; tick++) board.update(1 / 60);
  assert.equal(board.active, 0);
  assert.equal(landed.size, 5);
  for (let tier = 0; tier < 5; tier++) assert.equal(landed.get(100 + tier), tier);
}));

test('rapid mixed-size drops remain finite and pay out exactly once at slider extremes', () => seeded(() => {
  for (const rows of [8, 16]) {
    for (const weight of [0.25, 1.5]) {
      let landed = 0;
      const board = new Board(canvas, { onPegHit() {}, onLand() { landed++; } });
      board.setLayout(rows, []);
      for (let i = 0; i < 16; i++) {
        const physics: PhysicsSettings = { ballSize: i % 2 ? 0.5 : 2.5, bounce: i % 2 ? 5 : 0.3, weight };
        board.setPhysics(physics);
        board.drop(i % 5);
        for (let tick = 0; tick < 24; tick++) board.update(STEP);
      }
      for (let tick = 0; tick < 120 * 45 && board.active; tick++) {
        board.update(STEP);
        for (const { body } of state(board).balls) {
          assert.ok(Number.isFinite(body.position.x + body.position.y + body.speed));
          assert.ok(body.speed <= 16.001, 'bumper energy must stay bounded');
        }
      }
      assert.equal(board.active, 0);
      assert.equal(landed, 16);
    }
  }
}));
