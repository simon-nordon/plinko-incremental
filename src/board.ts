import Matter from 'matter-js';
import { DEFAULT_PHYSICS, SPAWN_GAP, ballStyle, bucketColor, type PhysicsSettings } from './config';
import { fmtMult } from './format';

// A real Matter.js simulation. Random spawn positions create variation; balls
// collide with pins and walls independently, as in the reference game.
// Payouts use the reference game's tables with a direct percentage luck adjustment.

// World units are pixels of a fixed 760×570 board; rendering scales it to fit.
const W = 760;
const H = 570;
const PAD_X = 52;
const PAD_TOP = 36;
const PAD_BOTTOM = 28;
const BUCKET_H = 26;
const WORLD_H = H + BUCKET_H + 6;
/**
 * Reference drag by row count, paired with 0.5 ball friction. Without both,
 * sideways momentum carries balls across several rows into the outer jackpots.
 * https://github.com/AnsonH/plinko-game/blob/main/src/lib/components/Plinko/PlinkoEngine.ts
 */
const AIR_FRICTION: Record<number, number> = {
  8: 0.0395,
  9: 0.041,
  10: 0.038,
  11: 0.0355,
  12: 0.0414,
  13: 0.0437,
  14: 0.0401,
  15: 0.0418,
  16: 0.0364,
};
/**
 * Bounciness above 1 can't be restitution (that adds energy every bounce and blows up),
 * so pins act like pinball bumpers instead: restitution stays at 1 and every pin hit
 * kicks the ball outward by this many px per 1/60 s for each 1.0 above 1.
 */
const BUMPER_KICK = 1.5;
/** Fixed tangential impulse for a charged Bouncy Peg, including grazing contacts. */
export const BOUNCY_PEG_KICK = 12;
/** Prestige Bouncy Balls spawn with 200% bounciness, whatever the Tuning slider says. */
export const BOUNCY_BALL_BOUNCE = 2;
const BOUNCY_BALL_STYLE = { color: '#f472b6', deep: '#9d174d' };
/** Seconds the Bucket Slider rests over each bucket. */
export const SLIDER_STEP = .45;
/** Speed limit in Matter's px per 1/60 s; each 120 Hz step travels at most 8 px. */
const MAX_SPEED = 16;
const STEP_MS = 1000 / 120;
/** Keep the timeout in simulation seconds, independent of the fixed step rate. */
const MAX_BALL_STEPS = Math.ceil(30_000 / STEP_MS);
const TRAIL = 6;
/** Pins in the top row; row r holds TOP_PINS + r pins, so there are rows + TOP_PINS - 2 buckets. */
export const TOP_PINS = 3;

const PIN = 0x1;
const BALL = 0x2;

interface Peg {
  body: Matter.Body;
  id: string;
  bouncy: number;
  split: number;
  row: number;
  flash: number;
}

interface Ball {
  body: Matter.Body;
  tier: number;
  wagerId: number;
  costShare: number;
  valueShare: number;
  /** radius it spawned with; the size slider only affects new balls */
  r: number;
  /** Extra pin impulse captured at spawn, just like restitution and size. */
  bumperKick: number;
  bouncy: boolean;
  /** Persistent pegs already used by this ball's lineage. */
  triggered: Set<string>;
  steps: number;
  previous: Matter.Vector;
  trail: number[];
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; color: string; size: number;
}

interface FloatText {
  x: number; y: number; vy: number;
  life: number; max: number; text: string; color: string; size: number;
}

export interface BoardHooks {
  onPegHit(row: number, tier: number): void;
  onLand(bucket: number, tier: number, wagerId: number, costShare: number, valueShare: number): void;
  onDuplicate?(wagerId: number, extraValueShare: number): boolean | void;
  onChargeUsed?(kind: 'bouncy' | 'split', pegId: string): void;
}

export class Board {
  fullValueSplits = false;
  /** Prestige pegs never run out; each affects a ball lineage once. */
  persistentPegs = false;
  skullZeroBuckets = false;
  sliderEnabled = false;
  /** Screen-space room below the board for developer payout buttons. */
  bucketControlHeight = 0;
  ballStyleOverride: { color: string; deep: string } | null = null;
  rows = 16;
  mults: number[] = [];
  private engine = Matter.Engine.create();
  private physics: PhysicsSettings = { ...DEFAULT_PHYSICS };
  private pegs: Peg[] = [];
  private pegById = new Map<number, Peg>();
  private lastRowX: number[] = [];
  private chuteHalfWidth = 0;
  private wallCos = 1;
  private bucketAnim: number[] = [];
  private luckyBuckets = new Set<string>();
  /** Beginner's Luck buckets and the hits they can still take. */
  private beginnerBuckets = new Map<number, number>();
  private sliderIndex = 0;
  private sliderDir = 1;
  private sliderTimer = 0;
  private sliderDraw = 0;
  private balls: Ball[] = [];
  private ballById = new Map<number, Ball>();
  /** Drops waiting to enter the board, oldest first. */
  private queue: { tier: number; wagerId: number; bouncy: boolean }[] = [];
  private spawnWait = 0;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private shake = 0;
  private acc = 0;
  private pinContacts: { ball: Ball; peg: Peg }[] = [];

  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private cw = 0;
  private ch = 0;

  constructor(private canvas: HTMLCanvasElement, private hooks: BoardHooks) {
    this.ctx = canvas.getContext('2d')!;
    Matter.Events.on(this.engine, 'collisionStart', ({ pairs }) => {
      for (const { bodyA, bodyB } of pairs) {
        const ball = this.ballById.get(bodyA.id) ?? this.ballById.get(bodyB.id);
        const other = ball?.body === bodyA ? bodyB : bodyA;
        if (!ball || !other.isStatic) continue;
        const peg = this.pegById.get(other.id);
        if (!peg) continue;
        peg.flash = 1;
        // collisionStart fires BEFORE Matter resolves velocity. Apply bumper impulses
        // after Engine.update so the solver cannot absorb or reverse the extra bounce.
        if (ball.bumperKick > 0 || peg.bouncy || peg.split) this.pinContacts.push({ ball, peg });
        this.hooks.onPegHit(peg.row, ball.tier);
      }
    });
  }

  /** Balls on the board or still waiting to spawn. */
  get active(): number {
    return this.balls.length + this.queue.length;
  }

  private get pinGap(): number {
    return (W - PAD_X * 2) / (this.rows + TOP_PINS - 2);
  }

  get buckets(): number {
    return this.rows + TOP_PINS - 2;
  }

  private get ballR(): number {
    return this.pinR * this.physics.ballSize;
  }

  /** Size and bounce apply to balls spawned from now on; weight applies to everything immediately. */
  setPhysics(p: PhysicsSettings): void {
    this.physics = { ...p };
    this.engine.gravity.scale = 0.001 * p.weight;
  }

  private get pinR(): number {
    return (24 - this.rows) / 2;
  }

  setLayout(rows: number, mults: number[]): void {
    this.rows = rows;
    this.mults = mults;
    this.luckyBuckets.clear();
    Matter.Composite.clear(this.engine.world, false);
    this.pegs = [];
    this.pegById.clear();
    this.lastRowX = [];
    this.balls = [];
    this.ballById.clear();
    this.queue = [];
    this.pinContacts = [];
    this.particles = [];
    this.texts = [];
    this.shake = 0;
    this.spawnWait = 0;
    this.acc = 0;
    Matter.Engine.clear(this.engine);

    const gap = this.pinGap;
    for (let r = 0; r < rows; r++) {
      const y = PAD_TOP + ((H - PAD_TOP - PAD_BOTTOM) / (rows - 1)) * r;
      const inset = PAD_X + ((rows - 1 - r) * gap) / 2;
      const n = r + TOP_PINS;
      for (let j = 0; j < n; j++) {
        const x = inset + ((W - inset * 2) / (n - 1)) * j;
        const body = Matter.Bodies.circle(x, y, this.pinR, {
          isStatic: true,
          collisionFilter: { category: PIN, mask: BALL },
        });
        const peg = { body, id: `${r}:${j}`, bouncy: 0, split: 0, row: r, flash: 0 };
        this.pegs.push(peg);
        this.pegById.set(body.id, peg);
        if (r === rows - 1) this.lastRowX.push(x);
      }
    }

    // Invisible slanted walls hugging the triangle so nothing escapes the board.
    const top = this.pegs[0].body.position.x;
    const angle = Math.atan2(top - this.lastRowX[0], H - PAD_TOP - PAD_BOTTOM);
    const wx = top - (top - this.lastRowX[0]) / 2 - gap * 0.25;
    this.chuteHalfWidth = W / 2 - wx - Math.tan(angle) * (H / 2);
    this.wallCos = Math.cos(angle);
    // Extended above the board along their slope, so bouncy balls launched upward can't sail over them.
    const extra = H * 0.6;
    const wall = (x: number, a: number) =>
      Matter.Bodies.rectangle(x + (Math.sin(a) * extra) / 2, H / 2 - (Math.cos(a) * extra) / 2, 10, H + extra, {
        isStatic: true,
        angle: a,
        collisionFilter: { category: PIN, mask: BALL },
      });

    Matter.Composite.add(this.engine.world, [...this.pegs.map((p) => p.body), wall(wx, angle), wall(W - wx, -angle)]);
    this.bucketAnim = new Array(this.buckets).fill(0);
  }

  /** Swap the payout table without disturbing balls in play. */
  setMults(mults: number[]): void {
    this.mults = mults;
  }

  setPegCharges(bouncyIds: readonly string[], splitIds: readonly string[]): void {
    const counts = (ids: readonly string[]) => ids.reduce((map, id) => map.set(id, (map.get(id) ?? 0) + 1), new Map<string, number>());
    const bouncy = counts(bouncyIds);
    const split = counts(splitIds);
    for (const peg of this.pegs) {
      peg.bouncy = bouncy.get(peg.id) ?? 0;
      peg.split = split.get(peg.id) ?? 0;
    }
  }

  setLuckyBuckets(ids: readonly string[]): void {
    this.luckyBuckets = new Set(ids);
  }

  setBeginnerBuckets(charges: ReadonlyMap<number, number>): void {
    this.beginnerBuckets = new Map([...charges].filter(([, left]) => left > 0));
  }

  /** The bucket currently doubled by the Bucket Slider, or -1. */
  get sliderBucket(): number {
    return this.sliderEnabled ? this.sliderIndex : -1;
  }

  /** Chips fly off a Beginner's Luck bucket; the final hit shatters it. */
  crackBucket(k: number, broken: boolean): void {
    const x = this.bucketX(k);
    const g = this.pinGap;
    for (let i = 0; i < (broken ? 34 : 10); i++) {
      const a = -Math.PI * Math.random();
      const speed = (broken ? 5 : 3) * g * (0.3 + Math.random());
      const life = 0.5 + Math.random() * 0.5;
      this.particles.push({ x: x + (Math.random() - .5) * g * .8, y: H + BUCKET_H / 2, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        life, max: life, color: Math.random() < .5 ? '#6ee7b7' : '#d1fae5', size: g * (broken ? .12 : .08) * (0.5 + Math.random()) });
    }
    this.bucketText(k, broken ? 'BROKEN' : 'CRACK', broken ? '#fca5a5' : '#a7f3d0', .38);
    if (broken) this.addShake(4);
  }

  drop(tier: number, wagerId = 0, bouncy = false): void {
    this.queue.push({ tier, wagerId, bouncy });
  }

  /** Spawns the next queued ball once the gap has passed and the chute is clear. */
  private spawnNext(dt: number): void {
    this.spawnWait = Math.max(0, this.spawnWait - dt);
    if (this.queue.length === 0 || this.spawnWait > 0) return;
    const r = this.ballR;
    // Keep the entire ball clear of the slanted walls at the mouth of the chute.
    // The extra 6 px covers half the wall thickness plus a little clearance.
    const spread = Math.max(0, Math.min(
      this.pinGap * ((TOP_PINS - 1) / 2) * 0.95,
      this.chuteHalfWidth - (r + 6) / this.wallCos,
    ));
    const x = W / 2 + (Math.random() * 2 - 1) * spread;
    const blocked = this.balls.some((b) => Math.hypot(b.body.position.x - x, b.body.position.y) < r + b.r + 2);
    if (blocked) return;
    const { tier, wagerId, bouncy } = this.queue.shift()!;
    this.spawnWait = SPAWN_GAP;
    const bounce = bouncy ? BOUNCY_BALL_BOUNCE : this.physics.bounce;
    const body = Matter.Bodies.circle(x, 0, r, {
      restitution: Math.min(1, bounce),
      friction: 0.5,
      frictionAir: AIR_FRICTION[this.rows],
      slop: 0.01,
      // Rapid tapping must not let other balls knock a drop toward a jackpot.
      collisionFilter: { category: BALL, mask: PIN },
    });
    Matter.Composite.add(this.engine.world, body);
    const ball: Ball = {
      body, tier, wagerId, costShare: 1, valueShare: 1, r, steps: 0, trail: [], previous: { ...body.position },
      bumperKick: BUMPER_KICK * Math.max(0, bounce - 1), bouncy, triggered: new Set(),
    };
    this.balls.push(ball);
    this.ballById.set(body.id, ball);
  }

  update(dt: number): void {
    this.acc += dt * 1000;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < 12) {
      this.acc -= STEP_MS;
      steps++;
      this.spawnNext(STEP_MS / 1000);
      for (const b of this.balls) Object.assign(b.previous, b.body.position);
      Matter.Engine.update(this.engine, STEP_MS);
      this.applyBumpers();
      this.limitSpeed();
      this.collectLanded();
    }
    if (steps >= 12) this.acc = 0;

    for (const b of this.balls) {
      const p = this.renderPosition(b);
      b.trail.push(p.x, p.y);
      if (b.trail.length > TRAIL * 2) b.trail.splice(0, 2);
    }
    this.updateSlider(dt);
    for (const p of this.pegs) p.flash = Math.max(0, p.flash - dt * 3.5);
    for (let i = 0; i < this.bucketAnim.length; i++) this.bucketAnim[i] = Math.max(0, this.bucketAnim[i] - dt * 4);
    this.shake = Math.max(0, this.shake - dt * 30);

    const g = this.pinGap;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += 14 * g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      if (t.life <= 0) { this.texts.splice(i, 1); continue; }
      t.y += t.vy * dt;
      t.vy *= 0.94;
    }
  }

  /** Hop one bucket at a time, bouncing back at either end. */
  private updateSlider(dt: number): void {
    if (!this.sliderEnabled || this.buckets < 2) return;
    this.sliderIndex = Math.min(this.sliderIndex, this.buckets - 1);
    this.sliderTimer += dt;
    while (this.sliderTimer >= SLIDER_STEP) {
      this.sliderTimer -= SLIDER_STEP;
      if (this.sliderIndex + this.sliderDir < 0 || this.sliderIndex + this.sliderDir >= this.buckets) this.sliderDir *= -1;
      this.sliderIndex += this.sliderDir;
    }
    this.sliderDraw += (this.sliderIndex - this.sliderDraw) * Math.min(1, dt * 18);
  }

  private applyBumpers(): void {
    for (const { ball, peg } of this.pinContacts) {
      // Persistent pegs affect each lineage once, so children cannot re-trigger on spawn.
      const fresh = !this.persistentPegs || !ball.triggered.has(peg.id);
      if (this.persistentPegs && (peg.bouncy || peg.split)) ball.triggered.add(peg.id);
      // Consume before processing the next contact, even if two balls hit in one step.
      // A stacked peg spends both charges on this impact.
      const bouncy = fresh ? peg.bouncy : 0;
      let split = 0;
      // Count accepted children before dividing shares. At capacity, keep unused charges.
      while (fresh && split < peg.split && this.hooks.onDuplicate?.(ball.wagerId, this.fullValueSplits ? ball.valueShare : 0) !== false) split++;
      if (!this.persistentPegs) {
        peg.bouncy = 0;
        peg.split -= split;
        for (let i = 0; i < bouncy; i++) this.hooks.onChargeUsed?.('bouncy', peg.id);
        for (let i = 0; i < split; i++) this.hooks.onChargeUsed?.('split', peg.id);
      }
      const dx = ball.body.position.x - peg.body.position.x;
      const dy = ball.body.position.y - peg.body.position.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = ball.body.velocity;
      // Choose the tangent aligned with travel; a head-on tie kicks toward that side.
      // The charged kick is fixed, independent of impact speed and incidence angle.
      const tx = -dy / d, ty = dx / d;
      const tangentSpeed = v.x * tx + v.y * ty;
      const direction = Math.abs(tangentSpeed) > 1e-8 ? Math.sign(tangentSpeed) : (dx < 0 ? -1 : 1);
      const launch = BOUNCY_PEG_KICK * bouncy * direction;
      Matter.Body.setVelocity(ball.body, {
        x: v.x + (dx / d) * ball.bumperKick + tx * launch,
        y: v.y + (dy / d) * ball.bumperKick + ty * launch,
      });
      if (split > 0) {
        // Prestige children each retain payout value, but still share the purchase cost.
        ball.costShare /= split + 1;
        if (!this.fullValueSplits) ball.valueShare /= split + 1;
        const position = { ...ball.body.position };
        const velocity = { ...ball.body.velocity };
        Matter.Body.setVelocity(ball.body, { x: velocity.x - .4 * split, y: velocity.y });
        for (let i = 0; i < split; i++) {
          const body = Matter.Bodies.circle(position.x, position.y, ball.r, {
            restitution: ball.body.restitution, friction: ball.body.friction,
            frictionAir: ball.body.frictionAir, slop: ball.body.slop,
            collisionFilter: { category: BALL, mask: PIN },
          });
          const child: Ball = { ...ball, body, previous: position, trail: [], triggered: new Set(ball.triggered) };
          Matter.Body.setVelocity(body, { x: velocity.x + .8 * (i + 1) - .4 * split, y: velocity.y });
          Matter.Composite.add(this.engine.world, body);
          this.balls.push(child);
          this.ballById.set(body.id, child);
        }
      }
    }
    this.pinContacts.length = 0;
  }

  private limitSpeed(): void {
    for (const b of this.balls) {
      b.steps++;
      const v = b.body.velocity;
      const sp = Math.hypot(v.x, v.y);
      if (sp > MAX_SPEED) Matter.Body.setVelocity(b.body, { x: (v.x * MAX_SPEED) / sp, y: (v.y * MAX_SPEED) / sp });
    }
  }

  private collectLanded(): void {
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const { body, tier, wagerId, r, steps, costShare, valueShare } = this.balls[i];
      if (body.position.y + r < H - 5 && steps < MAX_BALL_STEPS) continue;
      const x = body.position.x;
      const k = Math.max(0, Math.min(this.buckets - 1, this.lastRowX.findLastIndex((px) => px < x)));
      Matter.Composite.remove(this.engine.world, body);
      this.balls.splice(i, 1);
      this.ballById.delete(body.id);
      this.bucketAnim[k] = 1;
      this.hooks.onLand(k, tier, wagerId, costShare, valueShare);
    }
  }

  // ---- juice ----

  private bucketX(k: number): number {
    return this.lastRowX[k] + this.pinGap / 2;
  }

  bucketBurst(k: number, color: string, count: number): void {
    const g = this.pinGap;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 5 * g * (0.3 + Math.random());
      const life = 0.4 + Math.random() * 0.5;
      this.particles.push({
        x: this.bucketX(k), y: H + BUCKET_H / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 2.5 * g,
        life, max: life, color, size: g * (0.05 + Math.random() * 0.07),
      });
    }
  }

  bucketText(k: number, text: string, color: string, size = 0.5): void {
    const g = this.pinGap;
    this.texts.push({ x: this.bucketX(k), y: H - g * 0.6, vy: -2.4 * g, life: 1.2, max: 1.2, text, color, size: size * g });
  }

  addShake(n: number): void {
    this.shake = Math.min(18, this.shake + n);
  }

  // ---- rendering ----

  /** Smooth motion between fixed physics steps, including on high-refresh displays. */
  private renderPosition(ball: Ball): Matter.Vector {
    const alpha = this.acc / STEP_MS;
    return {
      x: ball.previous.x + (ball.body.position.x - ball.previous.x) * alpha,
      y: ball.previous.y + (ball.body.position.y - ball.previous.y) * alpha,
    };
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w !== this.cw || h !== this.ch || this.canvas.width !== Math.round(w * dpr)) {
      this.cw = w;
      this.ch = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const availableHeight = Math.max(1, h - this.bucketControlHeight);
    this.scale = Math.min(w / W, availableHeight / WORLD_H);
    this.ox = (w - W * this.scale) / 2;
    this.oy = (availableHeight - WORLD_H * this.scale) / 2;
  }

  /** Align HTML controls with the rendered buckets, including letterboxing on resize. */
  get bucketControlsLayout(): { left: number; top: number; width: number } {
    return { left: this.ox + this.lastRowX[0] * this.scale,
      top: this.oy + WORLD_H * this.scale + 4,
      width: this.pinGap * this.buckets * this.scale };
  }

  render(): void {
    this.resize();
    const { ctx, scale: s } = this;
    ctx.clearRect(0, 0, this.cw, this.ch);

    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    const X = (x: number) => this.ox + x * s;
    const Y = (y: number) => this.oy + y * s;
    const pinR = this.pinR;

    for (const p of this.pegs) {
      const px = X(p.body.position.x);
      const py = Y(p.body.position.y);
      if (p.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 * p.flash})`;
        ctx.beginPath();
        ctx.arc(px, py, pinR * (1.8 + 1.5 * (1 - p.flash)) * s, 0, Math.PI * 2);
        ctx.fill();
      }
      const pegColor = p.bouncy ? '#b593ff' : p.split ? '#38bdf8' : '#ffffff';
      if (p.bouncy || p.split) {
        ctx.strokeStyle = p.split ? '#38bdf8' : pegColor;
        ctx.lineWidth = Math.max(1, s);
        ctx.beginPath();
        ctx.arc(px, py, pinR * 1.7 * s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = pegColor;
      ctx.beginPath();
      ctx.arc(px, py, pinR * s, 0, Math.PI * 2);
      ctx.fill();
    }

    this.renderBuckets(X, Y);

    for (const b of this.balls) {
      const { color, deep } = b.bouncy ? BOUNCY_BALL_STYLE : this.ballStyleOverride ?? ballStyle(b.tier);
      for (let i = 0; i < b.trail.length - 2; i += 2) {
        const a = (i / 2 + 1) / (b.trail.length / 2);
        ctx.globalAlpha = a * 0.25;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(b.trail[i]), Y(b.trail[i + 1]), b.r * s * a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      const position = this.renderPosition(b);
      const bx = X(position.x);
      const by = Y(position.y);
      const r = b.r * s;
      const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.1, bx, by, r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.35, color);
      g.addColorStop(1, deep);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.bouncy) {
        ctx.strokeStyle = 'rgba(244,114,182,.55)';
        ctx.lineWidth = Math.max(1, s * 1.2);
        ctx.beginPath();
        ctx.arc(bx, by, r * 1.45, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      const sz = p.size * s;
      ctx.fillRect(X(p.x) - sz / 2, Y(p.y) - sz / 2, sz, sz);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.texts) {
      const k = t.life / t.max;
      const pop = k > 0.85 ? 1 + (k - 0.85) * 3 : 1;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `800 ${Math.round(t.size * s * pop)}px Rubik, system-ui, sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,10,18,0.85)';
      ctx.strokeText(t.text, X(t.x), Y(t.y));
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, X(t.x), Y(t.y));
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  private renderBuckets(X: (x: number) => number, Y: (y: number) => number): void {
    const { ctx, scale: s } = this;
    const w = this.pinGap * 0.9;
    const h = BUCKET_H;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < this.buckets; k++) {
      const skull = this.skullZeroBuckets && this.mults[k] === 0;
      const cx = this.bucketX(k);
      const bounce = this.bucketAnim[k];
      const x0 = X(cx - w / 2);
      const y0 = Y(H - 8 + bounce * 6);
      const r = Math.min(4, w * 0.12) * s;
      ctx.fillStyle = bucketColor(k, this.buckets, 1);
      roundRect(ctx, x0, y0 + 4 * s, w * s, h * s, r);
      ctx.fill();
      ctx.fillStyle = skull ? '#452436' : bucketColor(k, this.buckets);
      roundRect(ctx, x0, y0, w * s, h * s, r);
      ctx.fill();
      if (this.luckyBuckets.has(String(k))) {
        ctx.fillStyle = '#b8860b';
        ctx.fill();
        ctx.strokeStyle = '#fde68a';
        ctx.lineWidth = 2 * s;
        ctx.stroke();
      }
      const beginner = this.beginnerBuckets.get(k);
      if (beginner) {
        ctx.fillStyle = '#059669';
        ctx.fill();
        ctx.strokeStyle = '#a7f3d0';
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
        drawCracks(ctx, x0, y0, w * s, h * s, 3 - beginner, k);
      }
      if (bounce > 0) {
        ctx.fillStyle = `rgba(255,255,255,${0.35 * bounce})`;
        ctx.fill();
      }
      const label = skull ? '💀' : fmtMult(this.mults[k] ?? 0);
      const fs = (skull ? h * .75 : Math.min(h * 0.5, (w * 1.6) / Math.max(3, label.length))) * s;
      ctx.font = `800 ${Math.round(fs)}px Rubik, "Segoe UI Emoji", system-ui, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, X(cx), y0 + (h * s) / 2 + 1);
    }
    if (this.sliderEnabled) {
      // A frame around the doubled bucket, gliding between hops.
      const cx = this.lastRowX[0] + this.pinGap * (this.sliderDraw + .5);
      const y0 = Y(H - 16);
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2 * s;
      roundRect(ctx, X(cx - this.pinGap * .52), y0, this.pinGap * 1.04 * s, (BUCKET_H + 16) * s, 5 * s);
      ctx.stroke();
      ctx.fillStyle = '#facc15';
      roundRect(ctx, X(cx) - 11 * s, y0 - 7 * s, 22 * s, 12 * s, 4 * s);
      ctx.fill();
      ctx.fillStyle = '#1f2937';
      ctx.font = `800 ${Math.round(8 * s)}px Rubik, system-ui, sans-serif`;
      ctx.fillText('×2', X(cx), y0 - s);
    }
  }
}

/** Deterministic jagged cracks, one more per hit taken. */
function drawCracks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, count: number, seed: number): void {
  if (count <= 0) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(6,30,22,.85)';
  ctx.lineWidth = Math.max(1, w / 22);
  ctx.lineJoin = 'round';
  for (let c = 0; c < count; c++) {
    let n = (seed + 1) * 97 + c * 31;
    const rand = () => (n = (n * 1103515245 + 12345) % 2147483648) / 2147483648;
    let px = x + w * (c === 0 ? .3 + rand() * .15 : .55 + rand() * .15);
    ctx.beginPath();
    ctx.moveTo(px, y);
    for (let i = 1; i <= 4; i++) {
      px = Math.max(x + 1, Math.min(x + w - 1, px + (rand() - .5) * w * .35));
      ctx.lineTo(px, y + (h * i) / 4);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
