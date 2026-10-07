import { Music } from './audio/music';
import { Sfx } from './audio/sfx';
import {
  ACTIONS, PLAYERS, bindingOwner, defaultBindings, isAssignableCode, keyLabel,
  loadBindings, normalizeCode, saveBindings, toKeyBindings,
} from './input/bindings';
import { bindKeyboard } from './input/keyboard';
import { Interpolator } from './render/interp';
import { Renderer } from './render/renderer';
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

const renderer = new Renderer(canvas);
const interp = new Interpolator();
const sfx = new Sfx();
const music = new Music();

type Mode = '1p' | '2p' | 'cpu';
const settings = {
  mode: '1p' as Mode,
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
let servesSeen = 0;

// ---------------------------------------------------------------------------
// Global mute — the M key toggles SFX and background music together, on every
// screen. M can never be assigned to an in-game control (isAssignableCode() in
// input/bindings.ts rejects 'KeyM', and loadBindings() discards any legacy
// config that tried to store it), so this key is always free for the mute.
let muted = false;
function applyMute(state: boolean): void {
   muted = state;
   sfx.enabled = !state;          // stop new one-shot effects, let tails ring out
   music.setMuted(state);         // suspend/resume the loop, keeping its position
    }
function toggleMute(): void {
   applyMute(!muted);
   console.info('[rackdoll] sound', muted ? 'OFF (press M to re-enable)' : 'ON');
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
  music.unlock();
  music.pickNext();             // new game → a fresh, non-repeating random track
  applyMute(muted);            // keep mute state consistent when starting a fresh match
  servesSeen = 0;
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
  if (single && winner === 2) sfx.lose();
  else sfx.point();
}

function onMatchOver(winner: PlayerId): void {
  const g = gw.game;
  const single = gw.singlePlayer;
  $('over-score').textContent = `${g.score[1]} – ${g.score[2]}`;
  const next = $<HTMLButtonElement>('over-next');
  if (single) {
    const won = winner === 1;
    const last = g.level >= OPTIONS.maxLevel;
    $('over-title').textContent = won ? (last ? 'Champion!' : 'You win!') : 'The CPU wins';
    $('over-sub').textContent = won
      ? last
        ? `You beat the champion. Campaign score ${g.campaignScore}.`
        : `Opponent ${g.level} down. Points this match: ${g.campaignScore}.`
      : `Opponent ${g.level} takes it. Have another go.`;
    next.style.display = won && !last ? '' : 'none';
  } else if (gw.botVsBot) {
    const name = (id: PlayerId) => (gw.levelOf(id) === OPTIONS.championLevel ? 'the champion' : `level ${gw.levelOf(id)}`);
    $('over-title').textContent = `${winner === 1 ? 'Left' : 'Right'} CPU wins`;
    $('over-sub').textContent = `${name(winner)} beat ${name(winner === 1 ? 2 : 1)}.`.replace(/^./, (c) => c.toUpperCase());
    next.style.display = 'none';
  } else {
    $('over-title').textContent = `Player ${winner} wins`;
    $('over-sub').textContent = 'First to 10.';
    next.style.display = 'none';
  }
  setScreen('over');
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function setScreen(s: Screen): void {
  if (s !== 'menu') {
    capturing = null;
    renderBindings();
  }
  screen = s;
  overlays.menu.classList.toggle('show', s === 'menu');
  overlays.pause.classList.toggle('show', s === 'paused');
  overlays.over.classList.toggle('show', s === 'over');
  gw.control.clear();
  if (s === 'playing') canvas.focus();
  const focusTarget = s === 'menu' ? $('play') : s === 'paused' ? $('resume') : s === 'over' ? $('over-again') : null;
  focusTarget?.focus();
}

function togglePause(): void {
  if (screen === 'playing') setScreen('paused');
  else if (screen === 'paused') setScreen('playing');
}

const actionNames: Record<ControlAction, string> = {
  left: 'Move left', right: 'Move right', jump: 'Jump', down: 'Down',
  serve: 'Serve / flip',
};

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
}

function wireBindings(): void {
  const grid = $('binding-grid');
  const status = $('binding-status');
  for (const player of PLAYERS) {
    const card = document.createElement('div');
    card.className = 'binding-player';
    const heading = document.createElement('strong');
    heading.textContent = `Player ${player}${player === 2 ? ' · CPU in 1 player mode' : ''}`;
    card.append(heading);
    for (const action of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      const label = document.createElement('span');
      label.textContent = actionNames[action];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'binding-key';
      button.dataset.bindingPlayer = String(player);
      button.dataset.bindingAction = action;
      button.addEventListener('click', () => {
        capturing = { player, action };
        status.textContent = `Press a key for Player ${player} · ${actionNames[action]}. Esc cancels.`;
        renderBindings();
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
        apply(b.dataset[attr]!);
      });
    }
  };
  group('mode', (v) => {
    settings.mode = v as Mode;
    $('level-field').style.display = v === '2p' ? 'none' : '';
    $('p1-level-field').style.display = v === 'cpu' ? '' : 'none';
    $('level-label').textContent = v === 'cpu' ? 'Right CPU' : 'Opponent';
  });
  group('level', (v) => { settings.level = Number(v); });
  group('p1level', (v) => { settings.p1Level = Number(v); });
  group('hazards', (v) => { settings.hazards = v === 'on'; });

  $('play').addEventListener('click', startMatch);
  $('resume').addEventListener('click', () => setScreen('playing'));
  $('quit').addEventListener('click', () => { gw = createWorld(true); setScreen('menu'); });
  $('over-again').addEventListener('click', startMatch);
  $('over-menu').addEventListener('click', () => { gw = createWorld(true); setScreen('menu'); });
  $('over-next').addEventListener('click', () => {
    settings.level = Math.min(OPTIONS.maxLevel, settings.level + 1);
    document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.level) === settings.level));
    });
    startMatch();
  });

  window.addEventListener('keydown', (e) => {
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
  const wasHeld = gw.ball.held;
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

  if (wasHeld && !gw.ball.held && gw.game.phase === 'play') {
    servesSeen++;
  }
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
    message: screen === 'playing' || screen === 'paused' ? message : null,
    showControlsHint: screen === 'playing' && servesSeen < 2 && !gw.isCpu(1),
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
  () => screen === 'playing',
);

wireMenu();
new ResizeObserver(() => renderer.resize()).observe(canvas);
requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  // Debug hooks. advance() steps the game and draws without waiting for
  // requestAnimationFrame, which a hidden tab throttles.
  (window as unknown as { __rv: unknown }).__rv = {
    get gw() { return gw; },
    settings,
    sfx,
    advance(frames = 1, alpha = 1) {
      for (let i = 0; i < frames; i++) simFrame();
      renderer.draw(gw, interp, alpha, {
        singlePlayer: gw.singlePlayer,
        message,
        showControlsHint: false,
      });
      return gw.frame;
    },
  };
}
