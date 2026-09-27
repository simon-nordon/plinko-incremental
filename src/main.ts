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
  RISK_VERSION,
  bucketColor,
  type PhysicsSettings,
  type Risk,
} from './config';
import { fmt, fmtChange, fmtMoney, fmtMult } from './format';
import { GameRun, type GameMode } from './game';
import { IncrementalSkills, INCREMENTAL_SKILLS, type IncrementalKind } from './incremental';
import { payoutTable } from './payouts';
import { resetAllProgress } from './progress';
import { affordableTiers, type BallTier } from './tiers';
import { SkillTree, LifeSkills, SKILLS, startingDropAt, type SkillKind } from './skills';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  devMode: $<HTMLButtonElement>('devMode'),
  boardSettings: $('boardSettings'),
  tuningPanel: $('tuningPanel'),
  gameMode: $<HTMLSelectElement>('gameMode'),
  balance: $('balance'),
  lossThreshold: $('lossThreshold'),
  risk: $<HTMLSelectElement>('risk'),
  rows: $<HTMLSelectElement>('rows'),
  tiers: $('tiers'),
  dropStatus: $('dropStatus'),
  allIn: $<HTMLButtonElement>('allIn'),
  allInLabel: $('allInLabel'),
  allInAmount: $('allInAmount'),
  allInRules: $('allInRules'),
  oneBallStats: $('oneBallStats'),
  ballCapacity: $('ballCapacity'),
  ballValue: $('ballValue'),
  capacityFill: $('capacityFill'),
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
function loadPrefs(forMode?: GameMode): { mode: GameMode; risk: Risk; rows: number; muted: boolean; luck: number; physics: PhysicsSettings } {
  const def = { mode: forMode ?? 'double' as GameMode, risk: (forMode === 'oneball' ? 'low' : 'high') as Risk, rows: 16, muted: false, luck: DEFAULT_LUCK, physics: { ...DEFAULT_PHYSICS } };
  try {
    const shared = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    const selected: GameMode = forMode ?? (shared.mode === 'classic' || shared.mode === 'oneball' ? shared.mode : 'double');
    const saved = JSON.parse(localStorage.getItem(`${PREFS_KEY}-${selected}`) ?? (forMode ? '{}' : JSON.stringify(shared)));
    const savedRisk = saved.risk === 'high' && saved.riskVersion !== RISK_VERSION ? 'extreme' : saved.risk;
    return { ...def, ...saved, risk: savedRisk ?? def.risk, mode: selected, muted: shared.muted ?? false, physics: saved.physicsVersion === PHYSICS_VERSION ? saved.physics : def.physics };
  } catch {
    return def;
  }
}
function savePrefs(): void {
  try {
    const prefs = JSON.stringify({ mode, risk, riskVersion: RISK_VERSION, rows, muted: sfx.muted, luck, physics, physicsVersion: PHYSICS_VERSION });
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

let overTimer = 0;
let denyTimer = 0;
let resetArmed = 0;
let visibleTiers: BallTier[] = [];
let skills: SkillTree | null = null;
let incrementalSkills: IncrementalSkills | null = null;
let skillMessage = '';
type UpgradeKind = SkillKind | IncrementalKind;
const ALL_SKILLS: readonly UpgradeKind[] = [...SKILLS, 'capacity', 'value', 'cashback'];
let selectedSkill: UpgradeKind = 'bouncy';
function loadSkills(): void {
  skills = null;
  incrementalSkills = null;
  selectedSkill = mode === 'oneball' ? 'value' : 'bouncy';
  try {
    if (mode === 'oneball') incrementalSkills = new IncrementalSkills(localStorage);
    else skills = new SkillTree(mode, localStorage);
    skillMessage = '';
  } catch {
    skills = null;
    skillMessage = 'Could not load saved upgrades. Purchases are unavailable; your save has been left untouched.';
  }
}
loadSkills();
function currentChargeSkills() { return mode === 'oneball' ? incrementalSkills : skills; }
function freshRun(): GameRun { return new GameRun(mode, skills?.startingDrop ?? 10, incrementalSkills?.settings); }
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
  board.fullValueSplits = mode === 'oneball';
  board.setLayout(rows, []);
  applyPegCharges();
  applyLuck();
}

function applyLuck(): void {
  const payouts = payoutTable(risk, rows, mode === 'classic' ? luck : 0);
  board.setMults(lifeSkills.payouts(payouts));
  board.setLuckyBuckets(lifeSkills.remaining('bucket'));
  el.luckControls.hidden = mode !== 'classic';
  el.luckValue.textContent = (luck > 0 ? '+' : luck < 0 ? '−' : '') + Math.abs(luck) + '%';
  el.luckNote.textContent = luck === 0 ? 'Original reference payouts.'
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
  if (currentChargeSkills()) skillMessage = '';
  sfx.unlock();
  board.drop(wager.tier, wager.id);
  sfx.drop();
  if (wager.tier > 0) sfx.tierSpawn(wager.tier);
  render();
  return true;
}

function onLand(k: number, tier: number, wagerId: number, share: number, valueShare: number): void {
  const mult = board.mults[k];
  const result = run.settle(wagerId, mult, share, valueShare);
  if (!result) return;
  lifeSkills.consume('bucket', String(k));
  const { profit } = result;
  const color = bucketColor(k, board.buckets);

  sfx.land(mult, tier);
  board.bucketText(k, fmtChange(profit).replace(/\.00$/, ''), profit >= 0 ? '#4ade80' : '#f87171');
  if (mult >= 3) board.bucketBurst(k, color, Math.min(80, 10 + mult * 2));
  if (mult >= 10) board.addShake(Math.min(14, 3 + mult / 10));
  if (result.complete) pushHistory(result.totalPayout / result.wager.amount, result.totalProfit, color);

  if (mode === 'oneball' && run.active === 0) {
    lifeSkills = new LifeSkills(rows, incrementalSkills);
    applyPegCharges();
  }

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
  if (currentChargeSkills()) skillMessage = '';
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
  applyLuck();
  const { balance, peak, busted } = run;
  const allInMode = mode === 'double';
  const oneBallMode = mode === 'oneball';
  board.ballStyleOverride = allInMode ? { color: '#ef4444', deep: '#991b1b' }
    : oneBallMode ? { color: '#38bdf8', deep: '#0369a1' } : null;
  el.lossThreshold.hidden = !allInMode;
  el.lossThreshold.textContent = `Forced cash out: ${fmtMoney(run.minimumBet)}`;
  renderTierButtons();
  el.balance.textContent = fmtMoney(balance);
  el.peak.textContent = fmtMoney(peak);
  el.risk.disabled = el.gameMode.disabled = run.active > 0;
  el.rows.disabled = run.active > 0 || (mode !== 'classic' && run.drops > 0);
  el.rows.title = mode !== 'classic' && run.drops > 0 ? 'Rows are fixed until the next life.' : '';
  el.gameMode.value = mode;
  el.tiers.hidden = mode !== 'classic';
  el.dropStatus.hidden = mode !== 'classic' || balance >= run.minimumBet || run.active === 0;
  el.allIn.hidden = el.allInRules.hidden = mode === 'classic';
  el.allInRules.textContent = oneBallMode ? 'Start with $5. Every ball costs $1. Grow your payout value with permanent upgrades.' : 'Every drop bets your full balance.';
  el.allIn.disabled = busted || (oneBallMode ? balance < 1 || run.activeBalls >= run.maxBalls : run.active > 0);
  el.allInLabel.textContent = oneBallMode ? (run.activeBalls >= run.maxBalls ? 'Board full · Wait for a slot' : balance < 1 && run.active ? 'Waiting for payouts' : 'Drop 1 Ball')
    : run.houseDropAvailable ? 'Drop Ball · On the House'
    : run.active > 0 ? 'Drop in play' : 'Drop Ball · All In';
  el.allInAmount.textContent = oneBallMode ? '$1.00' : fmtMoney(run.houseDropAvailable ? run.houseStake : run.active > 0 ? run.inPlay : balance);
  el.oneBallStats.hidden = !oneBallMode;
  el.ballCapacity.textContent = `${run.activeBalls} / ${run.maxBalls}`;
  el.ballValue.textContent = fmtMoney(run.ballValue);
  el.capacityFill.style.width = `${run.activeBalls / run.maxBalls * 100}%`;
  el.houseNote.hidden = !run.houseDropAvailable;
  el.houseNote.textContent = `Your first ${fmtMoney(run.houseStake)} ball is on the house. Only its winnings can buy upgrades.`;
  el.reset.title = allInMode ? `New life with a ${fmtMoney(skills?.startingDrop ?? 10)} house ball` : 'Start over from $5';
  el.mute.textContent = sfx.muted ? '🔇' : '🔊';
  renderSkills();
}

const skillInfo: Record<SkillKind, { title: string; description: string }> = {
  bouncy: { title: 'Bouncy Peg', description: 'One random interior peg gives a strong, fixed kick along the tangent at contact—even on a grazing hit—then becomes ordinary. It can also be a Split Peg. Each level adds one charge per life.' },
  split: { title: 'Split Peg', description: 'One random interior peg splits a ball into two half-value balls. Stacked charges add more balls while preserving their combined value. The peg then becomes ordinary. It can also be Bouncy. Each level adds one charge per life.' },
  bucket: { title: 'Golden Bucket', description: 'One random gold bucket doubles its return: 0.3× → 0.6×, 110× → 220×. Only the first ball gets the bonus, then it returns to normal. Each level adds another golden bucket per life.' },
  starting: { title: 'More Starting Money', description: 'Increase the house-funded first ball: $10 → $20 → $50 → $100 → $150 → $250 → $500 → $1,000… with no level cap. Forced cash out starts at 10% of that amount, then rises to 5% of your highest balance. Purchases take effect next life.' },
};

function renderSkills(): void {
  el.openSkills.hidden = el.overSkills.hidden = mode === 'classic';
  const oneBallMode = mode === 'oneball';
  const modeTitle = oneBallMode ? '1 Ball · Incremental' : 'Double or Nothing';
  $('skillsMode').textContent = $('skillRoot').textContent = modeTitle;
  $('skillMap').setAttribute('aria-label', `${modeTitle} skill tree`);
  $('skillsIntro').textContent = oneBallMode
    ? 'Build up your $1 drops. Upgrades survive every new game; special pegs and buckets recharge whenever the board clears.'
    : 'Buy permanent unlocks with winnings. Peg and bucket charges refresh and move each life.';
  for (const kind of ALL_SKILLS) $('select' + kind).hidden = oneBallMode ? kind === 'starting' : !SKILLS.includes(kind as SkillKind);
  if (oneBallMode) { renderIncrementalSkills(); return; }
  el.skillCount.textContent = `${SKILLS.reduce((sum, kind) => sum + (skills?.level(kind) ?? 0), 0)} owned`;
  for (const kind of SKILLS) {
    $(kind + 'NodeLevel').textContent = `Level ${skills?.level(kind) ?? 0}`;
    $('select' + kind).setAttribute('aria-pressed', String(kind === selectedSkill));
  }
  const kind = selectedSkill as SkillKind;
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

const incrementalInfo: Record<IncrementalKind, { title: string; description: string }> = {
  capacity: { title: 'Max Balls', description: 'Add one more slot to the board, starting from five and growing to fifty. Purchased balls, queued balls and split children all use a slot. A slot opens as soon as a ball lands.' },
  value: { title: 'Ball Value', description: 'Increase each new ball’s payout value by 5%, compounded per level. A ball still costs only $1. Its value is multiplied by the bucket it lands in.' },
  bouncy: { title: 'Bouncy Peg', description: 'Add a charged purple peg that kicks a ball sideways on contact. Each level adds one charge. Charges recharge and move to fresh random positions when the board clears.' },
  split: { title: 'Split Peg', description: 'Add a charged blue peg that creates an extra ball with the same payout value, at no extra cost. Splits need a free ball slot; blocked charges stay ready. Each level adds one charge, recharged when the board clears.' },
  bucket: { title: 'Golden Bucket', description: 'Add a golden bucket that pays double to the first ball that lands there. Each level adds another bucket. All golden buckets recharge and move when the board clears.' },
  cashback: { title: 'Cashback', description: 'Return another 5¢ of each $1 purchase after that drop and all its split children land. This is added to your bucket winnings once per purchase, up to a full $1 refund at level 20.' },
};

function renderIncrementalSkills(): void {
  const tree = incrementalSkills;
  const kind = selectedSkill as IncrementalKind;
  const level = tree?.level(kind) ?? 0;
  const cost = tree?.cost(kind) ?? 0;
  const maxed = !!tree && level >= tree.maximum(kind, rows);
  el.skillCount.textContent = `${INCREMENTAL_SKILLS.reduce((sum, key) => sum + (tree?.level(key) ?? 0), 0)} owned`;
  for (const key of INCREMENTAL_SKILLS) {
    $(key + 'NodeLevel').textContent = `Level ${tree?.level(key) ?? 0}`;
    $('select' + key).setAttribute('aria-pressed', String(key === kind));
  }
  el.skillTitle.textContent = incrementalInfo[kind].title;
  el.skillDescription.textContent = incrementalInfo[kind].description;
  el.skillLevel.textContent = String(level);
  el.skillBalance.textContent = fmtMoney(run.balance);
  if (kind === 'capacity') {
    el.skillRemaining.textContent = `Capacity: ${run.maxBalls} balls, including split children.`;
    el.skillPriceNote.textContent = maxed ? 'Maximum capacity reached.' : `Next: ${run.maxBalls + 1} balls at once.`;
  } else if (kind === 'value') {
    el.skillRemaining.textContent = `Current payout value: ${fmtMoney(run.ballValue)} per ball. Purchase price: $1.`;
    el.skillPriceNote.textContent = `Next: ${fmtMoney(run.ballValue * 1.05)} payout value (+5%).`;
  } else if (kind === 'cashback') {
    el.skillRemaining.textContent = `Current refund: ${fmtMoney(level * .05)} per purchased ball.`;
    el.skillPriceNote.textContent = maxed ? 'Every purchased ball now refunds its $1 cost.' : `Next: ${fmtMoney((level + 1) * .05)} back after each drop settles.`;
  } else {
    el.skillRemaining.textContent = `${lifeSkills.remaining(kind).length} of ${Math.min(level, tree?.maximum(kind, rows) ?? level)} charges ready. Let every ball land to recharge.`;
    el.skillPriceNote.textContent = 'Adds one charge immediately and to every future recharge.';
  }
  el.buySkill.disabled = !tree?.canBuy(run, rows, kind);
  el.buySkill.textContent = maxed ? 'Maximum reached' : `Upgrade · ${fmtMoney(cost)}`;
  el.skillStatus.textContent = skillMessage || (run.active ? 'Wait for every ball to land before upgrading.'
    : run.busted ? 'Start a new game. Your upgrades are kept.'
    : maxed ? 'All available upgrades are owned.'
    : run.balance < cost ? `Need ${fmtMoney(cost - run.balance)} more.`
    : run.balance - cost < 1 ? 'Keep $1 for your next ball.'
    : 'Permanent upgrade. Applies immediately.');
}

// ---- wiring ----
el.devMode.addEventListener('click', () => {
  const enabled = el.devMode.getAttribute('aria-pressed') !== 'true';
  el.devMode.setAttribute('aria-pressed', String(enabled));
  el.boardSettings.hidden = el.tuningPanel.hidden = !enabled;
});

el.gameMode.addEventListener('change', () => {
  if (run.active > 0) { render(); return; }
  savePrefs();
  mode = el.gameMode.value as GameMode;
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
  if (mode === 'classic') return;
  if (currentChargeSkills()) skillMessage = '';
  renderSkills();
  el.skills.showModal();
});
el.closeSkills.addEventListener('click', () => el.skills.close());
for (const kind of ALL_SKILLS) {
  $('select' + kind).addEventListener('click', () => {
    selectedSkill = kind;
    if (currentChargeSkills()) skillMessage = '';
    renderSkills();
  });
}
el.buySkill.addEventListener('click', () => {
  try {
    if (mode === 'oneball') {
      if (!incrementalSkills?.buy(run, rows, selectedSkill as IncrementalKind)) return;
      skillMessage = 'Saved permanently. Your upgrade is active.';
    } else {
      if (!skills?.buy(run, rows, selectedSkill as SkillKind)) return;
      skillMessage = selectedSkill === 'starting'
        ? `Saved. Your next life's house ball will be ${fmtMoney(skills.startingDrop)}.`
        : 'Saved permanently. One new charge added to this life.';
    }
    lifeSkills.sync(currentChargeSkills());
    applyPegCharges();
    sfx.unlock();
    sfx.buy();
    if (run.busted) { el.skills.close(); bust(); }
  } catch { skillMessage = 'Could not save the upgrade. No money was spent. Please try again.'; }
  render();
});
el.allIn.addEventListener('click', () => pressTier(0));

for (let r = MIN_ROWS; r <= MAX_ROWS; r++) el.rows.add(new Option(String(r), String(r)));
el.rows.value = String(rows);
el.risk.value = risk;

el.risk.addEventListener('change', () => {
  if (run.active) { el.risk.value = risk; return; }
  risk = el.risk.value as Risk;
  applyLayout();
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
  if (el.skills.open) return;
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
  const slot = e.code === 'Space' ? 0 : /^Digit[1-5]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
  if (slot < 0 && e.code !== 'Enter') return;
  e.preventDefault();
  if (run.busted) {
    if (!el.over.hidden && !e.repeat) restart();
    return;
  }
  if (mode !== 'classic') {
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
  if (active !== board.active) render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
