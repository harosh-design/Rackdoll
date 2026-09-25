import { Sfx } from './audio/sfx';
import { bindKeyboard } from './input/keyboard';
import { Interpolator } from './render/interp';
import { Renderer } from './render/renderer';
import { BALL, BODYTYPE, FPS, ITERATIONS, OPTIONS } from './sim/constants';
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

const settings = { mode: '1p' as '1p' | '2p', level: OPTIONS.currentLevel as number, hazards: true };
let screen: Screen = 'menu';
let gw = createWorld(true);
let message: string | null = null;
let servesSeen = 0;

// ---------------------------------------------------------------------------
// World lifecycle
// ---------------------------------------------------------------------------

function createWorld(demo = false): GameWorld {
  const w = new GameWorld({
    singlePlayer: demo ? true : settings.mode === '1p',
    level: settings.level,
    hazards: settings.hazards,
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
  const who = single ? (winner === 1 ? 'POINT!' : 'CPU POINT') : `PLAYER ${winner} POINT`;
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
        ? `All five opponents beaten. Campaign score ${g.campaignScore}.`
        : `Opponent ${g.level} down. Points this match: ${g.campaignScore}.`
      : `Opponent ${g.level} takes it. Have another go.`;
    next.style.display = won && !last ? '' : 'none';
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

function wireMenu(): void {
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
    settings.mode = v as '1p' | '2p';
    $('level-field').style.display = v === '1p' ? '' : 'none';
  });
  group('level', (v) => { settings.level = Number(v); });
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
      sfx.enabled = !sfx.enabled;
    } else if (e.code === 'Enter' && screen === 'menu') {
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
  const buttons = gw.ground.prizeButtons.map((b) => [b.pressedAt, b.releasedAt]);
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
    sfx.serve();
    servesSeen++;
  }
  if (!wasDown && gw.flags.onBallDown) sfx.thud();
  if (gw.executers.length > executers) sfx.executer();
  const hit = pendingHit as { kind: HitKind; strength: number } | null;
  if (hit) (hit.kind === 'doll' ? sfx.bump(hit.strength) : sfx.clack(hit.strength));
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
    showControlsHint: screen === 'playing' && servesSeen < 2,
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
