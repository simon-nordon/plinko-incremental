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
  RISKS,
  RISK_VERSION,
  ballStyle,
  bucketColor,
  type PhysicsSettings,
  type Risk,
} from './config';
import { fmt, fmtChange, fmtMoney, fmtMult } from './format';
import { GAME_MODES, GameRun, prestigeStake, type GameMode } from './game';
import { adjustBucket, bucketPayouts, loadRiskBucketTuning, type RiskBucketTuning } from './payouts';
import {
  BEGINNER_HITS, BOUNCY_BALL_CHANCE, BRANCHES, CASH_OUT_AT, DEBTS, PRESTIGE_SKILLS, PrestigeProgress,
  beginnerCharges, centerBuckets, describeSkill, landingFactor, prestigePayouts,
} from './prestige';
import { PrestigeTree, TREE_COLORS, iconSvg, type TreeSelection } from './prestige-tree';
import { resetAllProgress } from './progress';
import { affordableTiers, MAX_VISIBLE_TIERS, type BallTier } from './tiers';
import { SkillTree, LifeSkills, SKILLS, startingDropAt, type SkillKind } from './skills';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  devMode: $<HTMLButtonElement>('devMode'),
  tuningPanel: $('tuningPanel'),
  bucketControls: $('bucketControls'),
  bucketTuningNote: $('bucketTuningNote'),
  resetPayouts: $<HTMLButtonElement>('resetPayouts'),
  gameMode: $<HTMLSelectElement>('gameMode'),
  balance: $('balance'),
  lossThreshold: $('lossThreshold'),
  rows: $<HTMLSelectElement>('rows'),
  risk: $<HTMLSelectElement>('risk'),
  tiers: $('tiers'),
  dropStatus: $('dropStatus'),
  allIn: $<HTMLButtonElement>('allIn'),
  allInLabel: $('allInLabel'),
  allInAmount: $('allInAmount'),
  allInRules: $('allInRules'),
  cashOut: $<HTMLButtonElement>('cashOut'),
  cashOutAmount: $('cashOutAmount'),
  cashOutNote: $('cashOutNote'),
  prestigeGoal: $('prestigeGoal'),
  prestigeGoalTitle: $('prestigeGoalTitle'),
  prestigeGoalFill: $('prestigeGoalFill'),
  prestigeGoalNote: $('prestigeGoalNote'),
  prestige: $<HTMLDialogElement>('prestige'),
  prestigeMap: $('prestigeMap'),
  prestigeMessage: $('prestigeMessage'),
  walletAmount: $('walletAmount'),
  closePrestige: $<HTMLButtonElement>('closePrestige'),
  startRun: $<HTMLButtonElement>('startRun'),
  buyPrestige: $<HTMLButtonElement>('buyPrestige'),
  mute: $<HTMLButtonElement>('mute'),
  reset: $<HTMLButtonElement>('reset'),
  luck: $<HTMLInputElement>('luck'),
  luckValue: $('luckValue'),
  luckNote: $('luckNote'),
  resetPhysics: $<HTMLButtonElement>('resetPhysics'),
  resetProgress: $<HTMLButtonElement>('resetProgress'),
  resetProgressStatus: $('resetProgressStatus'),
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
  houseNote: $('houseNote'),
  luckControls: $('luckControls'),
  skillCount: $('skillCount'),
  skillTitle: $('skillTitle'),
  skillDescription: $('skillDescription'),
  skillLevel: $('skillLevel'),
  skillBalance: $('skillBalance'),
  skillRemaining: $('skillRemaining'),
  skillPriceNote: $('skillPriceNote'),
  skillStatus: $('skillStatus'),
  buySkill: $<HTMLButtonElement>('buySkill'),
  overSkills: $('overSkills'),
};

// Settings are a per-browser convenience; the run itself always starts fresh.
const PREFS_KEY = 'plinko-prefs';
function loadPrefs(forMode?: GameMode): { mode: GameMode; risk: Risk; rows: number; muted: boolean; luck: number; physics: PhysicsSettings; bucketTuningByRisk: RiskBucketTuning } {
  // Prestige starts on the plain reference table, so the High center shows 0.1×.
  const defaults = (mode: GameMode) => ({ mode, risk: 'high' as Risk, rows: 16, muted: false, luck: mode === 'prestige' ? 0 : DEFAULT_LUCK,
    physics: { ...DEFAULT_PHYSICS }, bucketTuningByRisk: {} });
  let def = defaults(forMode ?? 'prestige');
  try {
    const shared = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    // The retired 1 Ball mode hands over to Prestige.
    const selected: GameMode = forMode ?? (GAME_MODES.includes(shared.mode) ? shared.mode : 'prestige');
    def = defaults(selected);
    if (!forMode && shared.mode !== selected) return { ...def, muted: shared.muted ?? false };
    const saved = JSON.parse(localStorage.getItem(`${PREFS_KEY}-${selected}`) ?? (forMode ? '{}' : JSON.stringify(shared)));
    const savedRisk = saved.risk === 'high' && saved.riskVersion !== RISK_VERSION ? 'extreme' : saved.risk;
    return { ...def, ...saved, mode: selected, risk: RISKS.includes(savedRisk) ? savedRisk : def.risk, muted: shared.muted ?? false,
      physics: saved.physicsVersion === PHYSICS_VERSION ? saved.physics : def.physics,
      bucketTuningByRisk: loadRiskBucketTuning(saved.bucketTuningByRisk, saved.bucketTuning) };
  } catch {
    return def;
  }
}
function savePrefs(): void {
  try {
    const prefs = JSON.stringify({ mode, risk, riskVersion: RISK_VERSION, rows, muted: sfx.muted, luck, physics, physicsVersion: PHYSICS_VERSION, bucketTuningByRisk });
    localStorage.setItem(`${PREFS_KEY}-${mode}`, prefs);
    localStorage.setItem(PREFS_KEY, prefs);
  } catch {
    /* storage unavailable */
  }
}

const sfx = new Sfx();
let { mode, risk, rows, muted: startMuted, luck, physics, bucketTuningByRisk } = loadPrefs();
physics = { ...DEFAULT_PHYSICS, ...physics };
sfx.muted = startMuted;

let overTimer = 0;
let denyTimer = 0;
let resetArmed = 0;
let visibleTiers: BallTier[] = [];
let skills: SkillTree | null = null;
let prestige: PrestigeProgress | null = null;
let skillMessage = '';
let selectedSkill: SkillKind = 'bouncy';
let selectedPrestige: TreeSelection = 'beginnersLuck';
let prestigeMessage = '';
/** Beginner's Luck hits taken this run, by center bucket. */
let beginnerHits = new Map<number, number>();
function loadSkills(): void {
  skills = null;
  prestige = null;
  selectedSkill = 'bouncy';
  try {
    if (mode === 'prestige') prestige = new PrestigeProgress(localStorage);
    else skills = new SkillTree(mode, localStorage);
    skillMessage = prestigeMessage = '';
  } catch {
    skills = prestige = null;
    skillMessage = prestigeMessage = 'Could not load saved upgrades. Purchases are unavailable; your save has been left untouched.';
  }
}
loadSkills();
function currentChargeSkills() { return mode === 'prestige' ? prestige?.pegSkills ?? null : skills; }
function freshRun(): GameRun {
  return new GameRun(mode, skills?.startingDrop ?? 10,
    prestige ? { maxTier: prestige.maxTier, startingMoney: prestige.startingMoney } : undefined);
}
let run = freshRun();
let lifeSkills = new LifeSkills(rows, currentChargeSkills());

const board = new Board($<HTMLCanvasElement>('board'), {
  onPegHit: (row, tier) => sfx.peg(row, 'normal', tier),
  onLand,
  onDuplicate: (id, extraValue) => run.duplicate(id, extraValue),
  onChargeUsed: (kind, id) => {
    lifeSkills.consume(kind, id);
    renderSkills();
  },
});
board.setPhysics(physics);

function applyPegCharges(): void {
  board.setPegCharges(lifeSkills.remaining('bouncy'), lifeSkills.remaining('split'));
}

function applyLayout(): void {
  board.fullValueSplits = board.persistentPegs = mode === 'prestige';
  board.setLayout(rows, []);
  applyPegCharges();
  applyLuck();
}

function applyLuck(): void {
  const payouts = bucketPayouts(mode, rows, luck, bucketTuningByRisk[risk], risk);
  board.skullZeroBuckets = !!prestige?.level('jackpotEdges');
  board.sliderEnabled = !!prestige?.level('bucketSlider');
  if (prestige) {
    const progress = prestige;
    board.setMults(prestigePayouts(payouts, progress, beginnerHits));
    board.setBeginnerBuckets(new Map(centerBuckets(rows).map(k => [k, beginnerCharges(progress, beginnerHits, rows, k)])));
  } else {
    board.setMults(lifeSkills.payouts(payouts));
    board.setBeginnerBuckets(new Map());
  }
  board.setLuckyBuckets(lifeSkills.remaining('bucket'));
  $('board').setAttribute('aria-label', `Plinko board. Bucket payouts from left to right: ${board.mults.map(value =>
    board.skullZeroBuckets && value === 0 ? 'Skull, 0×' : fmtMult(value)).join(', ')}.`);
  renderBucketControls(payouts);
  el.luckControls.hidden = mode === 'double';
  el.luckValue.textContent = (luck > 0 ? '+' : luck < 0 ? '−' : '') + Math.abs(luck) + '%';
  el.luckNote.textContent = luck === 0 ? 'Base payouts, plus any bucket tuning.'
    : `Base payouts × ${(1 + luck / 100).toFixed(2)}, then individual bucket adjustments.`;
}

function renderBucketControls(payouts: number[]): void {
  if (el.bucketControls.children.length !== payouts.length) {
    el.bucketControls.replaceChildren();
    el.bucketControls.style.gridTemplateColumns = `repeat(${payouts.length}, minmax(0, 1fr))`;
    payouts.forEach((_value, bucket) => {
      const group = document.createElement('div');
      group.className = 'bucket-control';
      group.setAttribute('role', 'group');
      for (const step of [1, -1] as const) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = step > 0 ? '+' : '−';
        button.setAttribute('aria-label', `${step > 0 ? 'Increase' : 'Decrease'} bucket ${bucket + 1} payout by 0.1×`);
        button.addEventListener('click', () => {
          if (el.bucketControls.hidden || run.active) return;
          bucketTuningByRisk[risk] = adjustBucket(bucketTuningByRisk[risk] ?? {}, mode, rows, luck, bucket, step, risk);
          render();
          savePrefs();
        });
        group.append(button);
      }
      el.bucketControls.append(group);
    });
  }
  payouts.forEach((value, bucket) => {
    const group = el.bucketControls.children[bucket] as HTMLElement;
    group.setAttribute('aria-label', `Bucket ${bucket + 1}: ${fmtMult(value)} base payout`);
    const [plus, minus] = Array.from(group.children) as HTMLButtonElement[];
    plus.disabled = run.active > 0;
    minus.disabled = run.active > 0 || value === 0;
    plus.title = minus.title = `Bucket ${bucket + 1} · Base payout ${fmtMult(value)}`;
  });
  el.resetPayouts.disabled = run.active > 0 || !bucketTuningByRisk[risk]?.[rows];
  el.resetPayouts.textContent = `Reset to ${risk[0].toUpperCase() + risk.slice(1)} defaults`;
  el.bucketTuningNote.textContent = run.active
    ? 'Wait for every ball to land before editing payouts.'
    : 'Use + / − below each bucket to change its base payout by 0.1×. Saved per mode, risk and row count. Reset restores this risk’s defaults. Golden buckets and Prestige skills apply on top.';
}

let bucketControlPosition = '';
function positionBucketControls(): void {
  if (el.bucketControls.hidden) return;
  const { left, top, width } = board.bucketControlsLayout;
  const position = `${left}:${top}:${width}`;
  if (position === bucketControlPosition) return;
  bucketControlPosition = position;
  const style = el.bucketControls.style;
  style.left = `${left}px`;
  style.top = `${top}px`;
  style.width = `${width}px`;
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
  const bouncy = !!prestige && Math.random() < BOUNCY_BALL_CHANCE * prestige.level('bouncyBalls');
  board.drop(wager.tier, wager.id, bouncy);
  sfx.drop();
  if (wager.tier > 0) sfx.tierSpawn(wager.tier);
  render();
  return true;
}

function onLand(k: number, tier: number, wagerId: number, share: number, valueShare: number): void {
  const mult = prestige ? board.mults[k] * landingFactor(prestige, tier, run.balance, board.sliderBucket === k) : board.mults[k];
  const result = run.settle(wagerId, mult, share, valueShare);
  if (!result) return;
  lifeSkills.consume('bucket', String(k));
  if (prestige && beginnerCharges(prestige, beginnerHits, rows, k) > 0) {
    const hits = (beginnerHits.get(k) ?? 0) + 1;
    beginnerHits.set(k, hits);
    board.crackBucket(k, hits >= BEGINNER_HITS);
  }
  const { profit } = result;
  const color = bucketColor(k, board.buckets);

  sfx.land(mult, tier);
  board.bucketText(k, fmtChange(profit).replace(/\.00$/, ''), profit >= 0 ? '#4ade80' : '#f87171');
  if (mult >= 3) board.bucketBurst(k, color, Math.min(80, 10 + mult * 2));
  if (mult >= 10) board.addShake(Math.min(14, 3 + mult / 10));
  if (result.complete) pushHistory(result.totalPayout / result.wager.amount, result.totalProfit, color);

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
  beginnerHits = new Map();
  window.clearTimeout(overTimer);
  window.clearTimeout(denyTimer);
  window.clearTimeout(resetArmed);
  overTimer = denyTimer = resetArmed = 0;
  el.reset.textContent = '↺ New Game';
  run = freshRun();
  lifeSkills = new LifeSkills(rows, currentChargeSkills());
  applyLayout(); // Clear old balls and deal fresh charges for this life.
  el.over.hidden = true;
  el.history.replaceChildren();
  render();
}

function pressTier(tier: number): void {
  if (!drop(tier)) sfx.deny();
}

// ---- tier buttons ----

const tierButtons = new Map<number, HTMLButtonElement>();

/** Prestige tiers are powers of ten, unlocked by paying debts. */
function prestigeTiers(): BallTier[] {
  const tiers: BallTier[] = [];
  for (let index = 0; index <= run.maxTier && prestigeStake(index) <= run.balance; index++) {
    tiers.push({ index, cost: prestigeStake(index), ...ballStyle(index) });
  }
  return tiers.slice(-MAX_VISIBLE_TIERS);
}

function renderTierButtons(): void {
  visibleTiers = mode === 'classic' ? affordableTiers(run.balance) : mode === 'prestige' ? prestigeTiers() : [];
  // Normal and Prestige use different stakes for the same index.
  if (el.tiers.dataset.mode !== mode) {
    for (const button of tierButtons.values()) button.remove();
    tierButtons.clear();
    el.tiers.dataset.mode = mode;
  }
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
  applyLuck();
  const { balance, peak, busted } = run;
  const allInMode = mode === 'double';
  if (prestige && !prestige.revealed && balance >= CASH_OUT_AT) savePrestige(() => prestige!.reveal());
  board.ballStyleOverride = allInMode ? { color: '#ef4444', deep: '#991b1b' } : null;
  el.lossThreshold.hidden = !allInMode;
  el.lossThreshold.textContent = `Forced cash out: ${fmtMoney(run.minimumBet)}`;
  renderTierButtons();
  el.balance.textContent = fmtMoney(balance);
  el.peak.textContent = fmtMoney(peak);
  el.risk.disabled = el.gameMode.disabled = run.active > 0;
  el.rows.disabled = run.active > 0 || (mode !== 'classic' && run.drops > 0);
  el.rows.title = mode !== 'classic' && run.drops > 0 ? 'Rows are fixed until the next life.' : '';
  el.gameMode.value = mode;
  el.tiers.hidden = allInMode;
  el.dropStatus.hidden = allInMode || balance >= run.minimumBet || run.active === 0;
  el.allIn.hidden = el.allInRules.hidden = !allInMode;
  el.allIn.disabled = busted || run.active > 0;
  el.allInLabel.textContent = run.houseDropAvailable ? 'Drop Ball · On the House'
    : run.active > 0 ? 'Drop in play' : 'Drop Ball · All In';
  el.allInAmount.textContent = fmtMoney(run.houseDropAvailable ? run.houseStake : run.active > 0 ? run.inPlay : balance);
  el.houseNote.hidden = !run.houseDropAvailable;
  el.houseNote.textContent = `Your first ${fmtMoney(run.houseStake)} ball is on the house. Only its winnings can buy upgrades.`;
  el.reset.title = allInMode ? `New life with a ${fmtMoney(skills?.startingDrop ?? 10)} house ball`
    : `Start over from ${fmtMoney(prestige?.startingMoney ?? 5)}`;
  el.mute.textContent = sfx.muted ? '🔇' : '🔊';
  renderPrestigeSidebar();
  renderSkills();
  if (el.prestige.open) renderPrestige();
}

const skillInfo: Record<SkillKind, { title: string; description: string }> = {
  bouncy: { title: 'Bouncy Peg', description: 'One random interior peg gives a strong, fixed kick along the tangent at contact—even on a grazing hit—then becomes ordinary. It can also be a Split Peg. Each level adds one charge per life.' },
  split: { title: 'Split Peg', description: 'One random interior peg splits a ball into two half-value balls. Stacked charges add more balls while preserving their combined value. The peg then becomes ordinary. It can also be Bouncy. Each level adds one charge per life.' },
  bucket: { title: 'Golden Bucket', description: 'One random gold bucket doubles its return: 0.3× → 0.6×, 110× → 220×. Only the first ball gets the bonus, then it returns to normal. Each level adds another golden bucket per life.' },
  starting: { title: 'More Starting Money', description: 'Increase the house-funded first ball: $10 → $20 → $50 → $100 → $150 → $250 → $500 → $1,000… with no level cap. Forced cash out starts at 10% of that amount, then rises to 5% of your highest balance. Purchases take effect next life.' },
};

function renderSkills(): void {
  el.openSkills.hidden = mode === 'classic' || (mode === 'prestige' && !prestige?.revealed);
  el.overSkills.hidden = mode === 'classic';
  el.overSkills.textContent = mode === 'prestige' ? 'Your skills, debts paid and banked cash are kept.' : 'Your permanent upgrades are kept.';
  if (mode === 'prestige') {
    el.skillCount.textContent = `${fmtMoney(prestige?.wallet ?? 0)} banked`;
    return;
  }
  el.skillCount.textContent = `${SKILLS.reduce((sum, kind) => sum + (skills?.level(kind) ?? 0), 0)} owned`;
  for (const kind of SKILLS) {
    $(kind + 'NodeLevel').textContent = `Level ${skills?.level(kind) ?? 0}`;
    $('select' + kind).setAttribute('aria-pressed', String(kind === selectedSkill));
  }
  const kind = selectedSkill;
  const level = skills?.level(kind) ?? 0;
  const cost = skills?.cost(kind) ?? (kind === 'starting' ? 500 : 25);
  const maxed = !!skills && level >= skills.maximum(kind, rows);
  el.skillTitle.textContent = skillInfo[kind].title;
  el.skillDescription.textContent = skillInfo[kind].description;
  el.skillLevel.textContent = String(level);
  el.skillBalance.textContent = fmtMoney(run.balance);
  el.skillRemaining.textContent = kind === 'starting'
    ? `This life's house ball: ${fmtMoney(run.houseStake)}. Next life: ${fmtMoney(skills?.startingDrop ?? 10)}.`
    : `${lifeSkills.remaining(kind).length} of ${level} charges remaining this life. Fresh random positions each life; spent charges stay spent until then.`;
  el.skillPriceNote.textContent = kind === 'starting'
    ? `Next: ${fmtMoney(startingDropAt(level + 1))} per life. Costs 10× that amount.`
    : 'Each purchase adds one charge now and every future life. Prices: $10, $20, $40…';
  el.buySkill.disabled = !skills?.canBuy(run, rows, kind);
  el.buySkill.textContent = maxed ? 'Maximum on this board' : `Upgrade · ${fmtMoney(cost)}`;
  el.skillStatus.textContent = skillMessage || (run.houseDropAvailable
    ? 'Drop the house-funded ball first. Only its winnings can buy upgrades.'
    : run.active ? 'Wait for every ball to land.'
    : run.busted ? 'Start a new life to earn more money.'
    : maxed ? 'All available upgrades are owned.'
    : run.balance < cost ? `Need ${fmtMoney(cost - run.balance)} more.`
    : run.balance - cost < run.minimumBet ? `Keep at least ${fmtMoney(run.minimumBet)} to afford your next ball.`
    : 'Paid from your earned balance.');
}

// ---- prestige ----

const compactMoney = (value: number): string => '$' + fmt(value);
const percent = (value: number): string => `${Math.round(value * 100)}%`;

/** Storage can fail; progress stays unchanged and the player is told. */
function savePrestige(action: () => void, failure = 'Could not save. No money was spent. Please try again.'): boolean {
  try {
    action();
    return true;
  } catch {
    prestigeMessage = failure;
    return false;
  }
}

function renderPrestigeSidebar(): void {
  el.prestigeGoal.hidden = !prestige;
  el.cashOut.hidden = !prestige?.revealed;
  if (!prestige) return;
  const debt = prestige.nextDebt;
  $('prestigeGoalLabel').textContent = prestige.revealed ? 'Next debt' : 'First goal';
  if (!prestige.revealed) {
    el.prestigeGoalTitle.textContent = `Reach ${fmtMoney(CASH_OUT_AT)} to cash out`;
    el.prestigeGoalFill.style.width = `${Math.min(100, run.balance / CASH_OUT_AT * 100)}%`;
    el.prestigeGoalNote.textContent = 'Cashing out banks your balance for permanent skills.';
  } else if (debt) {
    el.prestigeGoalTitle.textContent = debt.title;
    el.prestigeGoalFill.style.width = `${Math.min(100, prestige.wallet / debt.cost * 100)}%`;
    el.prestigeGoalNote.textContent = `${fmtMoney(prestige.wallet)} banked of ${compactMoney(debt.cost)}. Unlocks ${compactMoney(prestigeStake(prestige.debtsPaid + 1))} balls.`;
  } else {
    el.prestigeGoalTitle.textContent = 'Debt free!';
    el.prestigeGoalFill.style.width = '100%';
    el.prestigeGoalNote.textContent = 'Every debt is paid. Ted is very proud of you.';
  }
  const kept = Math.round(run.balance * prestige.keepRate * 100) / 100;
  el.cashOut.disabled = run.active > 0 || run.balance <= 0;
  el.cashOutAmount.textContent = fmtMoney(kept);
  el.cashOutNote.textContent = run.active > 0 ? 'Wait for every ball to land'
    : prestige.keepRate < 1 ? `Greed keeps ${percent(prestige.keepRate)} of ${fmtMoney(run.balance)}`
    : 'Bank it and visit the skill tree';
}

const tree = new PrestigeTree($('treeViewport'), el.prestigeMap, selection => {
  selectedPrestige = selection;
  renderPrestige();
}, () => {
  // Keep fitted nodes clear of the detail card (side panel on desktop, sheet on phones).
  const detail = $('treeDetail').getBoundingClientRect();
  const sheet = window.innerWidth <= 760;
  return { top: sheet ? 64 : 80, right: sheet ? 0 : detail.width + 24, bottom: sheet ? detail.height : 0 };
});
$('treeZoomIn').addEventListener('click', () => tree.zoomBy(1.25));
$('treeZoomOut').addEventListener('click', () => tree.zoomBy(.8));
$('treeFit').addEventListener('click', () => tree.fit());

let shownToast = '';
function renderPrestige(): void {
  const progress = prestige;
  el.walletAmount.textContent = fmtMoney(progress?.wallet ?? 0);
  const debtsPaid = progress?.debtsPaid ?? 0;
  if (typeof selectedPrestige === 'number' && selectedPrestige > Math.min(debtsPaid, DEBTS.length - 1)) selectedPrestige = debtsPaid;
  // Replaying the animation announces each new message without a stack of toasts.
  if (prestigeMessage !== shownToast) {
    shownToast = prestigeMessage;
    el.prestigeMessage.hidden = !prestigeMessage;
    el.prestigeMessage.textContent = prestigeMessage;
    el.prestigeMessage.classList.remove('is-shown');
    void el.prestigeMessage.offsetWidth;
    el.prestigeMessage.classList.add('is-shown');
  }
  tree.render(progress, selectedPrestige);
  renderPrestigeDetail();
}

function renderPrestigeDetail(): void {
  const progress = prestige;
  const wallet = progress?.wallet ?? 0;
  const detail = $('treeDetail');
  const pips = $('prestigePips');
  $('prestigeSkillWallet').textContent = fmtMoney(wallet);
  const status = $('prestigeStatus');
  if (typeof selectedPrestige === 'number') {
    const i = selectedPrestige;
    const debt = DEBTS[i];
    const paid = i < (progress?.debtsPaid ?? 0);
    detail.style.setProperty('--c', TREE_COLORS.trunk);
    $('prestigeSkillIcon').innerHTML = iconSvg(paid ? 'check' : 'debt');
    $('prestigeSkillBranch').textContent = `Debt ${i + 1} of ${DEBTS.length}`;
    $('prestigeSkillTitle').textContent = debt.title;
    $('prestigeSkillDescription').textContent = debt.flavor;
    $('prestigeLevelLabel').textContent = 'Unlocks';
    $('prestigeSkillLevel').textContent = `${compactMoney(prestigeStake(i + 1))} balls`;
    // Debts show how close the wallet is instead of level pips.
    const share = paid ? 1 : Math.min(1, wallet / debt.cost);
    pips.replaceChildren();
    pips.className = 'detail-pips is-meter';
    pips.style.setProperty('--fill', `${share * 100}%`);
    $('prestigeSkillCurrent').textContent = paid ? 'Paid off. Ted says thanks.' : `${fmtMoney(Math.min(wallet, debt.cost))} of ${fmtMoney(debt.cost)} saved.`;
    $('prestigeSkillNext').textContent = paid ? '' : `Paying it off unlocks ${compactMoney(prestigeStake(i + 1))} balls in every run.`;
    el.buyPrestige.disabled = paid || !progress?.canPayDebt();
    el.buyPrestige.textContent = paid ? 'Paid off' : `Pay off · ${compactMoney(debt.cost)}`;
    status.textContent = paid ? ''
      : !progress ? 'Purchases are unavailable.'
      : wallet < debt.cost ? `Need ${fmtMoney(debt.cost - wallet)} more. Cash out to bank more.`
      : '';
    return;
  }
  const id = selectedPrestige;
  const def = PRESTIGE_SKILLS[id];
  const level = progress?.level(id) ?? 0;
  const copy = describeSkill(id, level);
  const cost = progress?.cost(id) ?? def.price[0];
  const locked = !progress || progress.locked(id);
  const maxed = level >= def.max;
  detail.style.setProperty('--c', TREE_COLORS[def.branch]);
  $('prestigeSkillIcon').innerHTML = iconSvg(id);
  $('prestigeSkillBranch').textContent = `${BRANCHES.find(branch => branch.id === def.branch)!.title} branch`;
  $('prestigeSkillTitle').textContent = def.title;
  $('prestigeSkillDescription').textContent = copy.description;
  $('prestigeLevelLabel').textContent = 'Level';
  $('prestigeSkillLevel').textContent = `${level} / ${def.max}`;
  pips.className = 'detail-pips';
  pips.replaceChildren(...Array.from({ length: def.max }, (_, pip) => {
    const span = document.createElement('span');
    span.classList.toggle('is-on', pip < level);
    return span;
  }));
  $('prestigeSkillCurrent').textContent = copy.current;
  $('prestigeSkillNext').textContent = copy.next;
  el.buyPrestige.disabled = !progress?.canBuy(id);
  el.buyPrestige.textContent = maxed ? (def.max > 1 ? 'Maxed out' : 'Owned')
    : locked && def.requires ? `Requires ${PRESTIGE_SKILLS[def.requires].title}` : `${level ? 'Upgrade' : 'Unlock'} · ${compactMoney(cost)}`;
  status.textContent = !progress ? 'Purchases are unavailable.'
    : maxed ? ''
    : locked && def.requires ? `Unlock ${PRESTIGE_SKILLS[def.requires].title} first.`
    : wallet < cost ? `Need ${fmtMoney(cost - wallet)} more. Cash out to bank more.`
    : id === 'startingMoney' ? 'Applies from your next run.'
    : '';
}

function openPrestige(closeLabel: string): void {
  if (!prestige) return;
  el.startRun.textContent = closeLabel;
  renderPrestige();
  if (el.prestige.open) return;
  el.prestige.showModal();
  requestAnimationFrame(() => tree.fit());
}

// ---- wiring ----
el.devMode.addEventListener('click', () => {
  const enabled = el.devMode.getAttribute('aria-pressed') !== 'true';
  el.devMode.setAttribute('aria-pressed', String(enabled));
  el.bucketControls.hidden = el.tuningPanel.hidden = !enabled;
  el.bucketControls.parentElement!.classList.toggle('dev-tuning', enabled);
  board.bucketControlHeight = enabled ? 64 : 0;
});

el.resetPayouts.addEventListener('click', () => {
  if (run.active) return;
  delete bucketTuningByRisk[risk]?.[rows];
  render();
  savePrefs();
});

el.gameMode.addEventListener('change', () => {
  if (run.active > 0) { render(); return; }
  savePrefs();
  mode = el.gameMode.value as GameMode;
  ({ risk, rows, luck, physics, bucketTuningByRisk } = loadPrefs(mode));
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
  if (mode === 'prestige') {
    prestigeMessage = '';
    openPrestige('Back to the board');
    return;
  }
  if (mode === 'classic') return;
  skillMessage = '';
  renderSkills();
  el.skills.showModal();
});
el.closeSkills.addEventListener('click', () => el.skills.close());
for (const kind of SKILLS) {
  $('select' + kind).addEventListener('click', () => {
    selectedSkill = kind;
    skillMessage = '';
    renderSkills();
  });
}
el.buySkill.addEventListener('click', () => {
  try {
    if (!skills?.buy(run, rows, selectedSkill)) return;
    skillMessage = selectedSkill === 'starting'
      ? `Saved. Your next life's house ball will be ${fmtMoney(skills.startingDrop)}.`
      : 'Saved permanently. One new charge added to this life.';
    lifeSkills.sync(currentChargeSkills());
    applyPegCharges();
    sfx.unlock();
    sfx.buy();
    if (run.busted) { el.skills.close(); bust(); }
  } catch { skillMessage = 'Could not save the upgrade. No money was spent. Please try again.'; }
  render();
});
el.allIn.addEventListener('click', () => pressTier(0));

el.cashOut.addEventListener('click', () => {
  const progress = prestige;
  if (!progress || run.active > 0 || run.balance <= 0) return;
  const balance = run.balance;
  let banked = 0;
  if (!savePrestige(() => { banked = progress.cashOut(balance); }, 'Could not save your cash out. Your run continues.')) {
    render();
    return;
  }
  sfx.unlock();
  sfx.buy();
  restart();
  prestigeMessage = `Cashed out ${fmtMoney(banked)}${banked < balance ? ` (Greed took ${fmtMoney(balance - banked)})` : ''}. Your next run starts with ${fmtMoney(run.balance)}.`;
  openPrestige('Start new run');
});
el.buyPrestige.addEventListener('click', () => {
  const progress = prestige;
  if (!progress) return;
  const selection = selectedPrestige;
  if (typeof selection === 'number') {
    if (selection !== progress.debtsPaid || !progress.canPayDebt() || !savePrestige(() => progress.payDebt())) {
      render();
      return;
    }
    run.setMaxTier(progress.maxTier);
    tree.celebrate(selection);
    prestigeMessage = `Paid! ${compactMoney(prestigeStake(progress.maxTier))} balls are unlocked.`
      + (progress.nextDebt ? ' The next debt awaits.' : ' You are completely debt free!');
    selectedPrestige = Math.min(progress.debtsPaid, DEBTS.length - 1);
  } else {
    if (!progress.canBuy(selection) || !savePrestige(() => progress.buy(selection))) {
      render();
      return;
    }
    tree.celebrate(selection);
    prestigeMessage = `${PRESTIGE_SKILLS[selection].title} ${PRESTIGE_SKILLS[selection].max > 1 ? `is now level ${progress.level(selection)}` : 'unlocked'}!`;
    lifeSkills.sync(progress.pegSkills);
    applyPegCharges();
  }
  sfx.unlock();
  sfx.buy();
  render();
});
el.closePrestige.addEventListener('click', () => el.prestige.close());
el.startRun.addEventListener('click', () => el.prestige.close());

for (let r = MIN_ROWS; r <= MAX_ROWS; r++) el.rows.add(new Option(String(r), String(r)));
el.rows.value = String(rows);
el.risk.value = risk;
el.risk.addEventListener('change', () => {
  if (run.active) { el.risk.value = risk; return; }
  risk = el.risk.value as Risk;
  render();
  savePrefs();
});
el.rows.addEventListener('change', () => {
  if (run.active || (mode !== 'classic' && run.drops > 0)) { el.rows.value = String(rows); return; }
  rows = Number(el.rows.value);
  lifeSkills = new LifeSkills(rows, currentChargeSkills());
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
let progressResetArmed = 0;
el.resetProgress.addEventListener('click', () => {
  if (!progressResetArmed) {
    el.resetProgress.textContent = 'Confirm reset all progress';
    el.resetProgressStatus.textContent = 'Tap again within 5 seconds to erase all modes, all upgrades and settings.';
    progressResetArmed = window.setTimeout(() => {
      progressResetArmed = 0;
      el.resetProgress.textContent = 'Reset all progress';
      el.resetProgressStatus.textContent = 'Dev tool: clears all modes, upgrades and settings in this browser.';
    }, 5000);
    return;
  }
  window.clearTimeout(progressResetArmed);
  progressResetArmed = 0;
  el.resetProgress.textContent = 'Reset all progress';
  try {
    resetAllProgress(localStorage);
    window.location.reload();
  } catch {
    el.resetProgressStatus.textContent = 'Could not reset saved progress. Please try again.';
  }
});
// Space drops the cheapest visible ball; 1–5 map to the current five buttons.
window.addEventListener('keydown', (e) => {
  if (el.skills.open || el.prestige.open) return;
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
  const active = board.active;
  board.update(dt);
  board.render();
  positionBucketControls();
  if (active !== board.active) render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
