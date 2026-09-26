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
import { SkillTree, pegIds } from './skills';

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
  openSkills: $<HTMLButtonElement>('openSkills'),
  skills: $<HTMLDialogElement>('skills'),
  closeSkills: $<HTMLButtonElement>('closeSkills'),
  buyBouncy: $<HTMLButtonElement>('buyBouncy'),
  selectBouncy: $<HTMLButtonElement>('selectBouncy'),
  selectReturn: $<HTMLButtonElement>('selectReturn'),
  bouncyDetail: $('bouncyDetail'),
  returnDetail: $('returnDetail'),
  returnNodeLevel: $('returnNodeLevel'),
  returnBonus: $('returnBonus'),
  returnBalance: $('returnBalance'),
  returnNext: $('returnNext'),
  returnStatus: $('returnStatus'),
  buyReturn: $<HTMLButtonElement>('buyReturn'),
  skillCount: $('skillCount'),
  nodeLevel: $('nodeLevel'),
  pegCount: $('pegCount'),
  skillBalance: $('skillBalance'),
  pegCoverage: $('pegCoverage'),
  skillStatus: $('skillStatus'),
  overSkills: $('overSkills'),
};

// Settings are a per-browser convenience; the run itself always starts fresh.
const PREFS_KEY = 'plinko-prefs';
function loadPrefs(forMode?: GameMode): { mode: GameMode; risk: Risk; rows: number; muted: boolean; luck: number; physics: PhysicsSettings } {
  const def = { mode: forMode ?? 'classic' as GameMode, risk: 'medium' as Risk, rows: 16, muted: false, luck: DEFAULT_LUCK, physics: { ...DEFAULT_PHYSICS } };
  try {
    const shared = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    const selected: GameMode = forMode ?? (shared.mode === 'double' ? 'double' : 'classic');
    const saved = JSON.parse(localStorage.getItem(`${PREFS_KEY}-${selected}`) ?? (forMode ? '{}' : JSON.stringify(shared)));
    return { ...def, ...saved, mode: selected, muted: shared.muted ?? false, physics: saved.physicsVersion === PHYSICS_VERSION ? saved.physics : def.physics };
  } catch {
    return def;
  }
}
function savePrefs(): void {
  try {
    const prefs = JSON.stringify({ mode, risk, rows, muted: sfx.muted, luck, physics, physicsVersion: PHYSICS_VERSION });
    localStorage.setItem(`${PREFS_KEY}-${mode}`, prefs);
    localStorage.setItem(PREFS_KEY, prefs);
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
let skills: SkillTree | null = null;
let skillMessage = '';
function loadSkills(): void {
  try {
    skills = new SkillTree(mode, localStorage);
    skillMessage = '';
  } catch {
    skills = null;
    skillMessage = 'Could not load saved upgrades. Purchases are unavailable; your save has been left untouched.';
  }
}
loadSkills();

const board = new Board($<HTMLCanvasElement>('board'), {
  onPegHit: (row, tier) => sfx.peg(row, 'normal', tier),
  onLand,
});
board.setPhysics(physics);

function applyLayout(): void {
  board.setLayout(rows, []);
  board.setBouncyPegs(skills?.bouncyPegs ?? []);
  applyLuck();
}

/** Luck adjusts every reference multiplier by the same percentage. */
function applyLuck(): void {
  const payouts = payoutTable(risk, rows, luck);
  board.setMults(skills?.improvePayouts(payouts) ?? payouts);
  el.luckValue.textContent = (luck > 0 ? '+' : luck < 0 ? '−' : '') + Math.abs(luck) + '%';
  el.luckNote.textContent = luck === 0
    ? 'Original reference payouts.'
      : `Every base payout × ${(1 + luck / 100).toFixed(2)}. A 2× bucket pays ${fmtMult(2 * (1 + luck / 100))}.`;
  if (skills?.returnLevel) el.luckNote.textContent += ` Bucket Return adds another +${skills.returnLevel * 5}% (×${skills.returnMultiplier.toFixed(2)}) to these payouts.`;
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
  if (skills) skillMessage = '';
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
  if (skills) skillMessage = '';
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
  renderSkills();
}

function renderSkills(): void {
  el.openSkills.hidden = el.overSkills.hidden = mode !== 'double';
  const level = skills?.level ?? 0;
  const available = skills?.available(rows).length ?? 0;
  const active = pegIds(rows).length - available;
  el.skillCount.textContent = `${level + (skills?.returnLevel ?? 0)} owned`;
  el.nodeLevel.textContent = `Level ${level}`;
  el.pegCount.textContent = String(level);
  el.skillBalance.textContent = fmtMoney(run.balance);
  el.pegCoverage.textContent = skills ? `${active} of ${pegIds(rows).length} pegs upgraded on this board.`
    + (level > active ? ` ${level - active} on hidden rows will return when you add those rows back.` : '') : '';
  el.buyBouncy.disabled = !skills?.canBuy(run, rows);
  el.buyBouncy.textContent = available === 0 && skills ? 'All visible pegs upgraded' : `Upgrade · ${fmtMoney(skills?.cost ?? 50)}`;
  el.skillStatus.textContent = skillMessage || (run.active > 0 ? 'Wait for your ball to land.'
    : run.busted ? 'Start a new run to earn more money.'
    : available === 0 ? (rows < MAX_ROWS ? 'Add more rows to upgrade more pegs.' : 'Every peg is permanently upgraded.')
    : run.balance < (skills?.cost ?? 50) ? `Need ${fmtMoney((skills?.cost ?? 50) - run.balance)} more.`
    : run.balance - (skills?.cost ?? 50) < run.minimumBet ? 'Buying this ends your run. The upgrade is kept.' : 'Paid from your current balance.');
  const returnLevel = skills?.returnLevel ?? 0;
  const returnCost = skills?.returnCost ?? 50;
  el.returnNodeLevel.textContent = `Level ${returnLevel}`;
  el.returnBonus.textContent = `+${returnLevel * 5}%`;
  el.returnNext.textContent = `Next level: +${(returnLevel + 1) * 5}% to every bucket. A base 2× bucket becomes ${fmtMult(2 * (1 + (returnLevel + 1) * .05))} before Luck.`;
  el.returnBalance.textContent = fmtMoney(run.balance);
  el.buyReturn.disabled = !skills?.canBuyReturn(run);
  el.buyReturn.textContent = Number.isFinite(returnCost) ? `Upgrade · ${fmtMoney(returnCost)}` : 'Maximum level reached';
  el.returnStatus.textContent = skillMessage || (run.active ? 'Wait for your ball to land.'
    : run.busted ? 'Start a new run to earn more money.'
    : run.balance < returnCost ? `Need ${fmtMoney(returnCost - run.balance)} more.`
    : run.balance - returnCost < run.minimumBet ? 'Buying this ends your run. The upgrade is kept.' : 'Paid from your current balance.');
}

// ---- wiring ----

el.gameMode.addEventListener('change', () => {
  if (run.active > 0) { render(); return; }
  savePrefs();
  mode = el.gameMode.checked ? 'double' : 'classic';
  ({ risk, rows, luck, physics } = loadPrefs(mode));
  el.risk.value = risk;
  el.rows.value = String(rows);
  el.luck.value = String(luck);
  board.setPhysics(physics);
  renderPhysics();
  loadSkills();
  restart();
  savePrefs();
});
el.openSkills.addEventListener('click', () => {
  if (mode !== 'double') return;
  if (skills) skillMessage = '';
  renderSkills();
  el.skills.showModal();
});
el.closeSkills.addEventListener('click', () => el.skills.close());
function selectSkill(bucketReturn: boolean): void {
  el.bouncyDetail.hidden = bucketReturn;
  el.returnDetail.hidden = !bucketReturn;
  el.selectBouncy.setAttribute('aria-pressed', String(!bucketReturn));
  el.selectReturn.setAttribute('aria-pressed', String(bucketReturn));
  if (skills) skillMessage = '';
  renderSkills();
}
el.selectBouncy.addEventListener('click', () => selectSkill(false));
el.selectReturn.addEventListener('click', () => selectSkill(true));
el.buyReturn.addEventListener('click', () => {
  try {
    if (!skills?.buyReturn(run)) return;
    applyLuck();
    sfx.unlock();
    sfx.buy();
    skillMessage = `Bucket Return upgraded to +${skills.returnLevel * 5}%. Permanently saved.`;
    if (run.busted) { el.skills.close(); bust(); }
  } catch {
    skillMessage = 'Could not save the upgrade. No money was spent. Please try again.';
  }
  render();
});
el.buyBouncy.addEventListener('click', () => {
  try {
    const id = skills?.buy(run, rows);
    if (!id) return;
    board.setBouncyPegs(skills!.bouncyPegs);
    sfx.unlock();
    sfx.buy();
    const [row, column] = id.split(':').map(Number);
    skillMessage = `Peg upgraded: row ${row + 1}, peg ${column + 1}. Permanently saved.`;
    if (run.busted) { el.skills.close(); bust(); }
  } catch {
    skillMessage = 'Could not save the upgrade. No money was spent. Please try again.';
  }
  render();
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
  if (el.skills.open) return;
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
