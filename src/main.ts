import { wirePhysicsPanel } from './debug/physicsPanel';
import { loadPhysicsLibrary, type PresetStorage } from './debug/physicsPresets';
import { Music } from './audio/music';
import { Sfx } from './audio/sfx';
import {
  ACTIONS, PLAYERS, bindingOwner, defaultBindings, isAssignableCode, keyLabel,
  loadBindings, normalizeCode, saveBindings, toKeyBindings,
} from './input/bindings';
import { bindKeyboard } from './input/keyboard';
import { Interpolator } from './render/interp';
import { HUD_BAR, Renderer, type VisualStyle } from './render/renderer';
import { BEE_FLIGHT } from './sim/bees';
import { BALL, BODYTYPE, FPS, ITERATIONS, OPTIONS } from './sim/constants';
import type { ControlAction } from './sim/control';
import type { PointReason } from './sim/game';
import type { PlayerId } from './sim/player';
import { bodyTypeOf } from './sim/types';
import { GameWorld } from './sim/world';

type Screen = 'menu' | 'playing' | 'paused' | 'over';

/** One simulation frame per 1/30 s of wall clock, exactly like the SWF. */
const FRAME = 1 / FPS;
/** §3 — the menu ran the world at 0.04, never used in play. */
const MENU_TIME_STEP = 0.04;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('game') as HTMLCanvasElement;
const overlays = { menu: $('menu'), pause: $('pause'), over: $('over') };
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));

/** What each CPU level is like, for the menu. Follows BOT_LEVELS. */
const LEVELS: Record<number, { name: string; blurb: string }> = {
  1: { name: 'Rookie', blurb: 'Slow to react and loose with its aim.' },
  2: { name: 'Amateur', blurb: 'A little quicker, still forgiving.' },
  3: { name: 'Club', blurb: 'Starts lunging for balls out of reach.' },
  4: { name: 'Pro', blurb: 'Sharper aim and more smashes.' },
  5: { name: 'Elite', blurb: 'Near-instant reactions.' },
  6: { name: 'Champion', blurb: 'Reads the ball’s flight, aims away from its opponent and lines up its swing.' },
};

const backdrop = $('ambient-backdrop') as HTMLCanvasElement;
const renderer = new Renderer(canvas, backdrop);
const interp = new Interpolator();
const sfx = new Sfx();
const music = new Music();
/** Background music is disabled until replacement tracks are added. */
const MUSIC_ENABLED = false;

type Mode = '1p' | '2p' | 'cpu';
const VISUAL_STYLE_KEY = 'rackdoll-visual-style';
function loadVisualStyle(): VisualStyle {
  try {
    return localStorage.getItem(VISUAL_STYLE_KEY) === 'shaders' ? 'shaders' : 'people';
  } catch {
    return 'people';
  }
}
let physicsStorage: PresetStorage | undefined;
try { physicsStorage = localStorage; } catch { /* Tuning still works in memory. */ }
const physicsLibrary = loadPhysicsLibrary(physicsStorage);
const settings = {
  mode: '1p' as Mode,
  visualStyle: loadVisualStyle(),
  level: OPTIONS.currentLevel as number,
  /** Bot vs bot: the left CPU's level. */
  p1Level: OPTIONS.championLevel as number,
  hazards: true,
  bindings: loadBindings(),
};
let screen: Screen = 'menu';
let capturing: { player: PlayerId; action: ControlAction } | null = null;
let gw = createWorld(true);
let message: string | null = null;
/** Whose point the banner announces: their jersey colours it. */
let messageTone: PlayerId | 0 = 0;

// ---------------------------------------------------------------------------
// Global music mute — the M key toggles the background music on every screen;
// game sound effects always keep playing. M can never be assigned to an in-game
// control (isAssignableCode() in input/bindings.ts rejects 'KeyM', and
// loadBindings() discards any legacy config that tried to store it), so this
// key is always free for the mute.
const MUTE_KEY = 'rackdoll-muted';
let muted = false;
function applyMute(state: boolean): void {
  state = MUSIC_ENABLED ? state : true;
  muted = state;
  music.setMuted(state);         // suspend/resume the loop, keeping its position
  document.documentElement.classList.toggle('muted', state);
  document.querySelectorAll<HTMLButtonElement>('.js-sound').forEach((b) => {
    b.disabled = !MUSIC_ENABLED;
    b.setAttribute('aria-pressed', String(!state));
    b.title = !MUSIC_ENABLED ? 'Music temporarily disabled' : state ? 'Music off (M)' : 'Music on (M)';
  });
}
function toggleMute(): void {
  if (!MUSIC_ENABLED) return;
  applyMute(!muted);
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Mute still works for this session if storage is disabled.
  }
  showToast(muted ? 'Music off' : 'Music on', muted ? 'i-sound-off' : 'i-sound-on');
}
function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let toastTimer = 0;
function showToast(text: string, icon: string): void {
  const toast = $('toast');
  toast.innerHTML = `<svg aria-hidden="true"><use href="#${icon}" /></svg>`;
  toast.append(text);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1400);
}
// ---------------------------------------------------------------------------
// World lifecycle — one simulation frame per 1/30 s, exactly like the SWF.
// ---------------------------------------------------------------------------

function createWorld(demo = false): GameWorld {
  const w = new GameWorld({
    singlePlayer: demo ? true : settings.mode === '1p',
    botVsBot: !demo && settings.mode === 'cpu',
    level: settings.level,
    p1Level: settings.p1Level,
    hazards: settings.hazards,
    bindings: toKeyBindings(settings.bindings),
    physics: physicsLibrary.current,
    executerSeed: Math.floor(Math.random() * 0x100000000),
    events: {
      onPoint: (winner, reason) => onPoint(winner, reason),
      onNewRound: () => { message = null; },
      onMatchOver: (winner) => onMatchOver(winner),
    },
  });
  hookSounds(w);
  interp.reset();
  interp.commit(allBodies(w));
  return w;
}

function* allBodies(w: GameWorld) {
  for (let b = w.world.getBodyList(); b; b = b.getNext()) yield b;
}

function startMatch(): void {
  sfx.unlock();
  if (MUSIC_ENABLED) {
    music.unlock();
    music.pickNext();           // new game → a fresh, non-repeating random track
  }
  applyMute(muted);            // keep mute state consistent when starting a fresh match
  gw = createWorld();
  message = null;
  setScreen('playing');
}

// ---------------------------------------------------------------------------
// Sound hooks — read-only listeners, never change the simulation.
// ---------------------------------------------------------------------------

type HitKind = 'doll' | 'hard';
let pendingHit: { kind: HitKind; strength: number } | null = null;

function hookSounds(w: GameWorld): void {
  w.world.on('post-solve', (contact, impulse) => {
    if (!contact.isTouching()) return;
    const fa = contact.getFixtureA();
    const fb = contact.getFixtureB();
    const ballA = fa.getFriction() === BALL.friction;
    const ballB = fb.getFriction() === BALL.friction;
    if (ballA === ballB) return;
     // A held ball is being served, not hit: as the server moves it scrapes the
    // doll's own limbs and the walls or net into a bump we don't want. Only a
    // free ball makes the contact sound — serving stays quiet.
    if (w.ball.held) return;
    const other = ballA ? fb : fa;
    const type = bodyTypeOf(other.getBody());
    if (type === BODYTYPE.GROUND) return; // the floor gets its own thud
    const n = contact.getManifold().pointCount;
    let strength = 0;
    for (let i = 0; i < n; i++) strength = Math.max(strength, impulse.normalImpulses[i] ?? 0);
    if (strength < 0.12) return; // resting contact, e.g. the held ball on a shin
    const kind: HitKind = type === BODYTYPE.PLAYER ? 'doll' : 'hard';
    if (!pendingHit || strength > pendingHit.strength) pendingHit = { kind, strength };
  });
}

// ---------------------------------------------------------------------------
// Game events
// ---------------------------------------------------------------------------

function onPoint(winner: PlayerId, reason: PointReason): void {
  const single = gw.singlePlayer;
  const who = gw.botVsBot
    ? `${winner === 1 ? 'LEFT' : 'RIGHT'} CPU POINT`
    : single ? (winner === 1 ? 'POINT!' : 'CPU POINT') : `PLAYER ${winner} POINT`;
  const why = reason === 'touches' ? ' · 4 TOUCHES' : reason === 'serveClock' ? ' · TOO SLOW' : '';
  message = who + why;
  messageTone = winner;
  if (single && winner === 2) sfx.lose();
  else sfx.point();
}

function sideName(id: PlayerId): string {
  if (gw.isCpu(id)) return `CPU · ${LEVELS[gw.levelOf(id)]?.name ?? `Level ${gw.levelOf(id)}`}`;
  return gw.singlePlayer ? 'You' : `Player ${id}`;
}

function onMatchOver(winner: PlayerId): void {
  const g = gw.game;
  const single = gw.singlePlayer;
  $('over-s1').textContent = String(g.score[1]);
  $('over-s2').textContent = String(g.score[2]);
  $('over-n1').textContent = sideName(1);
  $('over-n2').textContent = sideName(2);
  $('over-card').style.setProperty('--win', `var(--p${winner})`);
  let showNext = false;
  if (single) {
    const won = winner === 1;
    const last = g.level >= OPTIONS.maxLevel;
    $('over-title').textContent = won ? (last ? 'Champion!' : 'You win!') : 'The CPU wins';
    $('over-sub').textContent = won
      ? last
        ? `You beat the champion. Campaign score ${g.campaignScore}.`
        : `${LEVELS[g.level]?.name ?? `Opponent ${g.level}`} down. Points this match: ${g.campaignScore}.`
      : `${LEVELS[g.level]?.name ?? `Opponent ${g.level}`} takes it. Have another go.`;
    showNext = won && !last;
  } else if (gw.botVsBot) {
    const name = (id: PlayerId) => (gw.levelOf(id) === OPTIONS.championLevel ? 'the champion' : `level ${gw.levelOf(id)}`);
    $('over-title').textContent = `${winner === 1 ? 'Left' : 'Right'} CPU wins`;
    $('over-sub').textContent = `${name(winner)} beat ${name(winner === 1 ? 2 : 1)}.`.replace(/^./, (c) => c.toUpperCase());
  } else {
    $('over-title').textContent = `Player ${winner} wins`;
    $('over-sub').textContent = `First to ${OPTIONS.gameSet}.`;
  }
  // With no next opponent, the rematch becomes the main action.
  $('over-next').hidden = !showNext;
  $('over-again').classList.toggle('btn-primary', !showNext);
  setScreen('over');
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function setScreen(s: Screen): void {
  if (s !== 'menu') {
    capturing = null;
    renderBindings();
  } else {
    selectTab($('tab-play'));
  }
  screen = s;
  document.body.dataset.screen = s;
  overlays.menu.classList.toggle('show', s === 'menu');
  overlays.pause.classList.toggle('show', s === 'paused');
  overlays.over.classList.toggle('show', s === 'over');
  // Only the open overlay can take focus or be read out.
  for (const [name, el] of Object.entries(overlays)) {
    el.inert = name !== (s === 'paused' ? 'pause' : s);
  }
  gw.control.clear();
  if (s === 'playing') focusGame();
  const focusTarget = s === 'menu' ? $('play')
    : s === 'paused' ? $('resume')
    : s === 'over' ? ($('over-next').hidden ? $('over-again') : $('over-next'))
    : null;
  focusTarget?.focus();
}

/** Keep keys going to the game, never to a button that was last clicked. */
function focusGame(): void {
  (document.activeElement as HTMLElement | null)?.blur();
  canvas.focus({ preventScroll: true });
}

function togglePause(): void {
  if (screen === 'playing') setScreen('paused');
  else if (screen === 'paused') setScreen('playing');
}

const actionNames: Record<ControlAction, string> = {
  left: 'Move left', right: 'Move right', jump: 'Jump', down: 'Down',
  serve: 'Serve / flip',
};

function selectTab(tab: HTMLElement, focus = false): void {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')!).hidden = !on;
  }
  if (capturing) {
    capturing = null;
    $('binding-status').textContent = 'Click a key to change it.';
    renderBindings();
  }
  if (focus) tab.focus();
}

/** The level pickers, their names and blurbs, from the settings. */
function syncLevels(): void {
  const show = (attr: string, prefix: string, level: number) => {
    document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset[attr]) === level));
    });
    const name = $(`${prefix}level-name`);
    name.textContent = `${LEVELS[level].name} · Lv ${level}`;
    name.classList.toggle('champ', level === OPTIONS.championLevel);
    $(`${prefix}level-desc`).textContent = LEVELS[level].blurb;
  };
  show('level', '', settings.level);
  show('p1level', 'p1-', settings.p1Level);
}

/** Who drives each side in the chosen mode. */
function isCpuSide(player: PlayerId): boolean {
  return settings.mode === 'cpu' || (settings.mode === '1p' && player === 2);
}

function renderBindings(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-binding-player]').forEach((button) => {
    const player = Number(button.dataset.bindingPlayer) as PlayerId;
    const action = button.dataset.bindingAction as ControlAction;
    const waiting = capturing?.player === player && capturing.action === action;
    const label = keyLabel(settings.bindings[player][action]);
    button.textContent = waiting ? 'Press a key…' : label;
    button.classList.toggle('capturing', waiting);
    button.setAttribute('aria-label', `Player ${player}, ${actionNames[action]}: ${label}. Click to change.`);
  });
  document.querySelectorAll<HTMLElement>('[data-bind-card]').forEach((card) => {
    const cpu = isCpuSide(Number(card.dataset.bindCard) as PlayerId);
    card.classList.toggle('is-cpu', cpu);
    card.querySelector<HTMLElement>('.badge')!.hidden = !cpu;
  });
  // Player 1's keys, wherever the help text names them.
  document.querySelectorAll<HTMLElement>('[data-keyof]').forEach((el) => {
    el.textContent = keyLabel(settings.bindings[1][el.dataset.keyof as ControlAction]);
  });
}

function wireBindings(): void {
  const grid = $('binding-grid');
  const status = $('binding-status');
  for (const player of PLAYERS) {
    const card = document.createElement('div');
    card.className = 'bind-card';
    card.dataset.bindCard = String(player);
    card.style.setProperty('--pc', `var(--p${player})`);
    const head = document.createElement('div');
    head.className = 'bind-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const heading = document.createElement('strong');
    heading.textContent = `Player ${player}`;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'CPU';
    badge.title = 'The CPU plays this side in the chosen mode.';
    head.append(dot, heading, badge);
    card.append(head);
    for (const action of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'bind-row';
      const label = document.createElement('span');
      label.textContent = actionNames[action];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'keycap';
      button.dataset.bindingPlayer = String(player);
      button.dataset.bindingAction = action;
      button.addEventListener('click', () => {
        capturing = { player, action };
        status.textContent = `Press a key for Player ${player} · ${actionNames[action]}. Esc cancels.`;
        renderBindings();
      });
      button.addEventListener('focusout', () => {
        if (capturing?.player === player && capturing.action === action) {
          capturing = null;
          status.textContent = 'Click a key to change it.';
          renderBindings();
        }
      });
      row.append(label, button);
      card.append(row);
    }
    grid.append(card);
  }
  renderBindings();

  $('reset-bindings').addEventListener('click', () => {
    capturing = null;
    settings.bindings = defaultBindings();
    saveBindings(settings.bindings);
    status.textContent = 'Default keys restored.';
    renderBindings();
  });

  window.addEventListener('keydown', (e) => {
    if (!capturing || e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') {
      capturing = null;
      status.textContent = 'Key change cancelled.';
      renderBindings();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || !isAssignableCode(e.code)) {
      status.textContent = 'Choose a letter, number, arrow or common key. P and M are game shortcuts.';
      return;
    }
    const code = normalizeCode(e.code);
    const owner = bindingOwner(settings.bindings, code);
    if (owner && (owner.player !== capturing.player || owner.action !== capturing.action)) {
      status.textContent = `${keyLabel(code)} is used by Player ${owner.player} · ${actionNames[owner.action]}. Choose another key.`;
      return;
    }
    settings.bindings[capturing.player][capturing.action] = code;
    saveBindings(settings.bindings);
    status.textContent = `Player ${capturing.player} · ${actionNames[capturing.action]}: ${keyLabel(code)}.`;
    capturing = null;
    renderBindings();
  }, true);
  window.addEventListener('blur', () => {
    if (capturing) {
      capturing = null;
      status.textContent = '';
      renderBindings();
    }
  });
}

function wireMenu(): void {
  wireBindings();
  const group = (attr: string, apply: (v: string) => void) => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));
    for (const b of buttons) {
      b.addEventListener('click', () => {
        for (const o of buttons) o.setAttribute('aria-pressed', String(o === b));
        apply(b.getAttribute(`data-${attr}`)!);
      });
    }
  };
  const applyVisualStyle = (style: VisualStyle) => {
    settings.visualStyle = style;
    renderer.setVisualStyle(style);
    document.body.dataset.visualStyle = style;
    document.querySelectorAll<HTMLButtonElement>('[data-visual-style]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.visualStyle === style));
    });
    $('visual-style-description').textContent = style === 'people'
      ? 'Textured people in the original indoor arena.'
      : 'Glass and chrome players with flowing light across the entire screen.';
  };
  applyVisualStyle(settings.visualStyle);
  group('visual-style', (value) => {
    const style: VisualStyle = value === 'shaders' ? 'shaders' : 'people';
    applyVisualStyle(style);
    try {
      localStorage.setItem(VISUAL_STYLE_KEY, style);
    } catch {
      // The selected graphics still work when browser storage is unavailable.
    }
  });
  group('mode', (v) => {
    settings.mode = v as Mode;
    $('level-field').hidden = v === '2p';
    $('p1-level-field').hidden = v !== 'cpu';
    $('levels').classList.toggle('two', v === 'cpu');
    $('level-label').textContent = v === 'cpu' ? 'Right CPU' : 'Opponent';
    renderBindings();
  });
  group('level', (v) => { settings.level = Number(v); syncLevels(); });
  group('p1level', (v) => { settings.p1Level = Number(v); syncLevels(); });
  syncLevels();

  const hazards = $('hazards');
  hazards.addEventListener('click', () => {
    settings.hazards = !settings.hazards;
    hazards.setAttribute('aria-checked', String(settings.hazards));
  });

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      selectTab(tabs[(i + step + tabs.length) % tabs.length], true);
    });
  });

  $('play').addEventListener('click', startMatch);
  $('resume').addEventListener('click', () => setScreen('playing'));
  $('restart').addEventListener('click', startMatch);
  $('quit').addEventListener('click', () => { gw = createWorld(true); setScreen('menu'); });
  $('over-again').addEventListener('click', startMatch);
  $('over-menu').addEventListener('click', () => { gw = createWorld(true); setScreen('menu'); });
  $('over-next').addEventListener('click', () => {
    settings.level = Math.min(OPTIONS.maxLevel, settings.level + 1);
    syncLevels();
    startMatch();
  });

  // The controls in the HUD's top bar, laid out where the renderer leaves
  // room for them. Clicks there must not leave focus on a button the serve
  // key (Space) would press again.
  const bar = $('hud-controls');
  bar.style.setProperty('--x', String(HUD_BAR.midX));
  bar.style.setProperty('--y', String(HUD_BAR.y));
  bar.style.setProperty('--w', String(HUD_BAR.controlsW));
  bar.style.setProperty('--h', String(HUD_BAR.h));
  $('btn-pause').addEventListener('click', togglePause);
  document.querySelectorAll<HTMLButtonElement>('.js-sound').forEach((b) => {
    b.addEventListener('click', () => {
      toggleMute();
      if (screen === 'playing') focusGame();
    });
  });
  const fullscreen = $('btn-fullscreen');
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
    if (screen === 'playing') focusGame();
  });
  document.addEventListener('fullscreenchange', () => {
    const on = Boolean(document.fullscreenElement);
    document.documentElement.classList.toggle('is-fullscreen', on);
    fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
    fullscreen.title = on ? 'Exit fullscreen' : 'Fullscreen';
  });

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'Escape' && physicsPanel.open) {
      e.preventDefault();
      physicsPanel.close();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (screen === 'playing' || screen === 'paused') {
        e.preventDefault();
        togglePause();
      }
    } else if (e.code === 'KeyM') {
      toggleMute();              // M is reserved for mute — never assignable to a control
    } else if (e.code === 'Enter' && screen === 'menu' && (e.target === document.body || e.target === canvas)) {
      startMatch();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'playing') setScreen('paused');
  });
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

let acc = 0;
let last = performance.now();

function simFrame(): void {
  const wasDown = gw.flags.onBallDown;
  const executers = gw.executers.length;
  const hazardHits = new Map(gw.executers.map((e) => [e, { hits: e.hits, snaps: e.snaps }]));
  const buttons = gw.ground.prizeButtons.map((b) => [b.pressedAt, b.releasedAt]);
  const opponentHits = { 1: gw.opponentHitEffects[1].frame, 2: gw.opponentHitEffects[2].frame };
  const perfects = { 1: gw.perfectEffects[1].frame, 2: gw.perfectEffects[2].frame };
  const counter = gw.counterEffect.frame;
  const powers = { 1: gw.powerUps.active[1], 2: gw.powerUps.active[2] };
  const beeLaunches = gw.bees.launches;
  pendingHit = null;

  gw.step();
  gw.reap();
  interp.commit(allBodies(gw));

  gw.ground.prizeButtons.forEach((b, i) => {
    const [pressed, released] = buttons[i];
    if (b.pressedAt !== pressed) sfx.button();
    if (b.releasedAt !== released) sfx.buttonRearm();
  });

  if (!wasDown && gw.flags.onBallDown) sfx.thud(gw.game.phase === 'goal');
  if (gw.executers.length > executers) sfx.executer();
  for (const [e, { hits, snaps }] of hazardHits) {
    if (e.hits > hits && e.lastImpact) {
      if (e.variant.id === 'slime') sfx.splat();
      else sfx.bump(0.4 + 1.4 * e.lastImpact.power);
    }
    if (e.snaps > snaps) sfx.splat(true);
  }
  let perfectSound = false;
  for (const id of [1, 2] as const) {
    const effect = gw.opponentHitEffects[id];
    if (effect.frame !== opponentHits[id]) sfx.bump(0.4 + 1.1 * effect.power);
    if (gw.perfectEffects[id].frame !== perfects[id]) {
      sfx.perfect();
      perfectSound = true;
    }
  }
  const counterSound = gw.counterEffect.frame !== counter;
  if (counterSound) sfx.counter();
  const newestBee = gw.bees.bees.at(-1);
  if (gw.bees.launches > beeLaunches && newestBee) sfx.beeBuzz(BEE_FLIGHT[newestBee.kind].scale);
  for (const id of [1, 2] as const) {
    const power = gw.powerUps.active[id];
    if (power && power !== powers[id]) sfx.giftPickup();
  }
  const hit = pendingHit as { kind: HitKind; strength: number } | null;
  if (hit && !perfectSound && !counterSound) {
    (hit.kind === 'doll' ? sfx.bump(hit.strength) : sfx.clack(hit.strength));
  }
}

/** The menu backdrop: the physics at the menu time step, no rules running. */
function menuFrame(): void {
  gw.applyAir();
  gw.world.step(MENU_TIME_STEP, ITERATIONS, ITERATIONS);
  interp.commit(allBodies(gw));
}

function tick(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  const running = screen === 'playing' || screen === 'menu';
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= FRAME && n < 5) {
      if (screen === 'playing') simFrame();
      else menuFrame();
      acc -= FRAME;
      n++;
    }
    if (n === 5) acc = 0; // too far behind (tab stalled): drop, don't spiral
  }

  renderer.draw(gw, interp, running ? acc / FRAME : 1, {
    singlePlayer: gw.singlePlayer,
    paused: !running,
    message: screen === 'playing' || screen === 'paused' ? message : null,
    messageTone,
  });
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------

// The control table belongs to whichever world is live, so route through it.
bindKeyboard(
  window,
  {
    press: (c) => gw.control.press(c),
    release: (c) => gw.control.release(c),
    clear: () => gw.control.clear(),
    uses: (c) => gw.control.uses(c),
  },
  () => screen === 'playing' && !document.getElementById('debug-panel')!.contains(document.activeElement),
);

wireMenu();
$('debug-launch').addEventListener('click', () => {
  gw.control.clear();
  if (capturing) {
    capturing = null;
    $('binding-status').textContent = 'Key change cancelled.';
    renderBindings();
  }
});
const physicsPanel = wirePhysicsPanel(physicsLibrary, physicsStorage, settings => {
  gw.setPhysics(settings);
  gw.control.clear();
}, () => {
  if (screen === 'playing') focusGame();
  else $('debug-launch').focus();
});
applyMute(loadMuted());
setScreen('menu');
new ResizeObserver(() => renderer.resize()).observe(canvas);
new ResizeObserver(() => renderer.resize()).observe(backdrop);
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  // Debug hooks. advance() steps the game and draws without waiting for
  // requestAnimationFrame, which a hidden tab throttles.
  (window as unknown as { __rv: unknown }).__rv = {
    get gw() { return gw; },
    renderer,
    settings,
    physicsLibrary,
    sfx,
    advance(frames = 1, alpha = 1) {
      for (let i = 0; i < frames; i++) simFrame();
      renderer.draw(gw, interp, alpha, {
        singlePlayer: gw.singlePlayer,
        message,
        messageTone,
      });
      return gw.frame;
    },
  };
}
