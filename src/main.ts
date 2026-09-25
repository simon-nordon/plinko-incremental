import './style.css';
import { Sfx } from './audio';
import { Board } from './board';
import {
  DEFAULT_LUCK,
  DEFAULT_PHYSICS,
  LUCK_RANGE,
  MAX_ROWS,
  MIN_ROWS,
  PHYSICS_RANGES,
  PHYSICS_VERSION,
  bucketColor,
  type PhysicsSettings,
  type Risk,
} from './config';
import { fmt, fmtChange, fmtMoney, fmtMult } from './format';
import { GameRun, startingBalance, type GameMode } from './game';
import { payoutTable } from './payouts';
import { affordableTiers, type BallTier } from './tiers';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  gameMode: $<HTMLInputElement>('gameMode'),
  balance: $('balance'),
  risk: $<HTMLSelectElement>('risk'),
  rows: $<HTMLSelectElement>('rows'),
  tiers: $('tiers'),
  dropStatus: $('dropStatus'),
  allIn: $<HTMLButtonElement>('allIn'),
  allInLabel: $('allInLabel'),
  allInAmount: $('allInAmount'),
  allInRules: $('allInRules'),
  mute: $<HTMLButtonElement>('mute'),
  reset: $<HTMLButtonElement>('reset'),
  luck: $<HTMLInputElement>('luck'),
  luckValue: $('luckValue'),
  luckNote: $('luckNote'),
  resetPhysics: $<HTMLButtonElement>('resetPhysics'),
  peak: $('peak'),
  history: $('history'),
  over: $('over'),
  overFinal: $('overFinal'),
  overMinimum: $('overMinimum'),
  overDrops: $('overDrops'),
  overPeak: $('overPeak'),
  restart: $<HTMLButtonElement>('restart'),
};

// Settings are a per-browser convenience; the run itself always starts fresh.
const PREFS_KEY = 'plinko-prefs';
function loadPrefs(): { mode: GameMode; risk: Risk; rows: number; muted: boolean; luck: number; physics: PhysicsSettings } {
  const def = { mode: 'classic' as GameMode, risk: 'medium' as Risk, rows: 16, muted: false, luck: DEFAULT_LUCK, physics: { ...DEFAULT_PHYSICS } };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { ...def, ...saved, mode: saved.mode === 'double' ? 'double' : 'classic', physics: saved.physicsVersion === PHYSICS_VERSION ? saved.physics : def.physics };
  } catch {
    return def;
  }
}
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, risk, rows, muted: sfx.muted, luck, physics, physicsVersion: PHYSICS_VERSION }));
  } catch {
    /* storage unavailable */
  }
}

const sfx = new Sfx();
let { mode, risk, rows, muted: startMuted, luck, physics } = loadPrefs();
physics = { ...DEFAULT_PHYSICS, ...physics };
sfx.muted = startMuted;

let run = new GameRun(mode);
let overTimer = 0;
let denyTimer = 0;
let resetArmed = 0;
let visibleTiers: BallTier[] = [];

const board = new Board($<HTMLCanvasElement>('board'), {
  onPegHit: (row, tier) => sfx.peg(row, 'normal', tier),
  onLand,
});
board.setPhysics(physics);

function applyLayout(): void {
  board.setLayout(rows, []);
  applyLuck();
}

/** Luck adjusts every reference multiplier by the same percentage. */
function applyLuck(): void {
  board.setMults(payoutTable(risk, rows, luck));
  el.luckValue.textContent = (luck > 0 ? '+' : luck < 0 ? '−' : '') + Math.abs(luck) + '%';
  el.luckNote.textContent = luck === 0
    ? 'Original reference payouts.'
    : `Every base payout × ${(1 + luck / 100).toFixed(2)}. A 2× bucket pays ${fmtMult(2 * (1 + luck / 100))}.`;
}

// ---- physics tuning ----

const physicsInputs = Object.keys(PHYSICS_RANGES).map((k) => {
  const key = k as keyof PhysicsSettings;
  const input = $<HTMLInputElement>(key);
  const [min, max, step] = PHYSICS_RANGES[key];
  Object.assign(input, { min: String(min), max: String(max), step: String(step) });
  input.addEventListener('input', () => {
    physics = { ...physics, [key]: Number(input.value) };
    board.setPhysics(physics);
    renderPhysics();
    savePrefs();
  });
  return [key, input] as const;
});

function renderPhysics(): void {
  for (const [key, input] of physicsInputs) {
    input.value = String(physics[key]);
    const v = physics[key];
    $(key + 'Value').textContent = key === 'ballSize' ? `${v.toFixed(1)}×` : `${Math.round(v * 100)}%`;
  }
}

el.resetPhysics.addEventListener('click', () => {
  physics = { ...DEFAULT_PHYSICS };
  board.setPhysics(physics);
  renderPhysics();
  savePrefs();
});

function drop(tier: number): boolean {
  const wager = run.drop(tier);
  if (!wager) return false;
  sfx.unlock();
  board.drop(wager.tier, wager.id);
  sfx.drop();
  if (wager.tier > 0) sfx.tierSpawn(wager.tier);
  render();
  return true;
}

function onLand(k: number, tier: number, wagerId: number): void {
  const mult = board.mults[k];
  const result = run.settle(wagerId, mult);
  if (!result) return;
  const { profit } = result;
  const color = bucketColor(k, board.buckets);

  sfx.land(mult, tier);
  board.bucketText(k, fmtChange(profit).replace(/\.00$/, ''), profit >= 0 ? '#4ade80' : '#f87171');
  if (mult >= 3) board.bucketBurst(k, color, Math.min(80, 10 + mult * 2));
  if (mult >= 10) board.addShake(Math.min(14, 3 + mult / 10));
  pushHistory(mult, profit, color);

  // The run ends only once nothing is left in play and the cheapest ball is out of reach.
  if (run.busted) bust();
  render();
}

function pushHistory(mult: number, profit: number, color: string): void {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.style.background = color;
  const multiplier = document.createElement('span');
  multiplier.textContent = fmtMult(mult);
  const change = document.createElement('span');
  change.className = 'chip-change';
  change.textContent = fmtChange(profit, true);
  chip.title = `${fmtChange(profit)} net · ${fmtMult(mult)}`;
  chip.setAttribute('aria-label', chip.title);
  chip.append(multiplier, change);
  el.history.prepend(chip);
  while (el.history.children.length > 6) el.history.lastChild!.remove();
}

function bust(): void {
  denyTimer = window.setTimeout(() => sfx.deny(), 250);
  el.overFinal.textContent = fmtMoney(run.balance);
  el.overMinimum.textContent = fmtMoney(run.minimumBet).replace('.00', '');
  el.overDrops.textContent = String(run.drops);
  el.overPeak.textContent = fmtMoney(run.peak);
  overTimer = window.setTimeout(() => (el.over.hidden = false), 700);
}

function restart(): void {
  window.clearTimeout(overTimer);
  window.clearTimeout(denyTimer);
  window.clearTimeout(resetArmed);
  overTimer = denyTimer = resetArmed = 0;
  el.reset.textContent = '↺ New Game';
  applyLayout(); // clears balls still in play so they can't pay into the new run
  run = new GameRun(mode);
  el.over.hidden = true;
  el.history.replaceChildren();
  render();
}

function pressTier(tier: number): void {
  if (!drop(tier)) sfx.deny();
}

// ---- tier buttons ----

const tierButtons = new Map<number, HTMLButtonElement>();

function renderTierButtons(): void {
  visibleTiers = mode === 'classic' ? affordableTiers(run.balance) : [];
  const visibleIds = new Set(visibleTiers.map(t => t.index));
  for (const [index, button] of tierButtons) {
    if (!visibleIds.has(index)) {
      button.remove();
      tierButtons.delete(index);
    }
  }
  visibleTiers.forEach((tier, slot) => {
    let button = tierButtons.get(tier.index);
    if (!button) {
      button = document.createElement('button');
      button.className = 'tier';
      button.dataset.tier = String(tier.index);
      button.style.setProperty('--tier', tier.color);
      button.title = `Bet ${fmtMoney(tier.cost)}`;
      button.innerHTML = `<span class="tier-cost">$${fmt(tier.cost)}</span><span class="tier-label">Drop Ball</span>`;
      button.addEventListener('click', () => pressTier(tier.index));
      tierButtons.set(tier.index, button);
    }
    // Keep existing buttons attached so clicking a ball does not steal keyboard focus.
    if (el.tiers.children[slot] !== button) el.tiers.insertBefore(button, el.tiers.children[slot] ?? null);
  });
}

function render(): void {
  const { balance, peak, busted } = run;
  const allInMode = mode === 'double';
  renderTierButtons();
  el.balance.textContent = fmtMoney(balance);
  el.peak.textContent = fmtMoney(peak);
  el.risk.disabled = el.rows.disabled = el.gameMode.disabled = run.active > 0;
  el.gameMode.checked = allInMode;
  el.tiers.hidden = allInMode;
  el.dropStatus.hidden = allInMode || balance >= run.minimumBet || run.active === 0;
  el.allIn.hidden = el.allInRules.hidden = !allInMode;
  el.allIn.disabled = busted || run.active > 0;
  el.allInLabel.textContent = run.active > 0 ? 'Ball in play' : 'Drop Ball · All In';
  el.allInAmount.textContent = fmtMoney(run.active > 0 ? run.inPlay : balance);
  el.reset.title = `Start over from ${fmtMoney(startingBalance(mode))}`;
  el.mute.textContent = sfx.muted ? '🔇' : '🔊';
}

// ---- wiring ----

el.gameMode.addEventListener('change', () => {
  if (run.active > 0) { render(); return; }
  mode = el.gameMode.checked ? 'double' : 'classic';
  restart();
  savePrefs();
});
el.allIn.addEventListener('click', () => pressTier(0));

for (let r = MIN_ROWS; r <= MAX_ROWS; r++) el.rows.add(new Option(String(r), String(r)));
el.rows.value = String(rows);
el.risk.value = risk;

el.risk.addEventListener('change', () => {
  risk = el.risk.value as Risk;
  applyLayout();
  savePrefs();
});
el.rows.addEventListener('change', () => {
  rows = Number(el.rows.value);
  applyLayout();
  savePrefs();
});
el.restart.addEventListener('click', restart);
el.luck.min = String(-LUCK_RANGE);
el.luck.max = String(LUCK_RANGE);
el.luck.value = String(luck);
el.luck.addEventListener('input', () => {
  luck = Number(el.luck.value);
  applyLuck();
  savePrefs();
});
// Two clicks, so a stray tap can't wipe a run.
el.reset.addEventListener('click', () => {
  if (resetArmed) {
    window.clearTimeout(resetArmed);
    resetArmed = 0;
    el.reset.textContent = '↺ New Game';
    restart();
    return;
  }
  el.reset.textContent = 'Click to confirm';
  resetArmed = window.setTimeout(() => {
    resetArmed = 0;
    el.reset.textContent = '↺ New Game';
  }, 2500);
});
el.mute.addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  sfx.unlock();
  savePrefs();
  render();
});
// Space drops the cheapest visible ball; 1–5 map to the current five buttons.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
  const slot = e.code === 'Space' ? 0 : /^Digit[1-5]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
  if (slot < 0 && e.code !== 'Enter') return;
  e.preventDefault();
  if (run.busted) {
    if (!el.over.hidden && !e.repeat) restart();
    return;
  }
  if (mode === 'double') {
    if (slot === 0 && !e.repeat) pressTier(0);
  } else if (visibleTiers[slot]) pressTier(visibleTiers[slot].index);
});

renderPhysics();
applyLayout();
render();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const wasActive = board.active > 0;
  board.update(dt);
  board.render();
  if (wasActive !== board.active > 0) render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
