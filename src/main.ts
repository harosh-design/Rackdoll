import { wirePhysicsPanel } from './debug/physicsPanel';
import { loadPhysicsLibrary, type PresetStorage } from './debug/physicsPresets';
import { Music } from './audio/music';
import { Sfx } from './audio/sfx';
import {
  bindingOwner, defaultBindings, isAssignableCode, keyLabel,
  loadBindings, normalizeCode, saveBindings, toKeyBindings,
} from './input/bindings';
import { bindKeyboard } from './input/keyboard';
import { Interpolator } from './render/interp';
import { drawMenuCharacter } from './render/menuArt';
import { animateMatchStart } from './ui/matchTransition';
import { HUD_BAR, Renderer } from './render/renderer';
import { WEATHER_OPTIONS, type WeatherChoice } from './render/weather';
import { BEE_FLIGHT } from './sim/bees';
import { BALL, BODYTYPE, FPS, OPTIONS } from './sim/constants';
import type { ControlAction } from './sim/control';
import type { PointReason } from './sim/game';
import type { PlayerId } from './sim/player';
import { bodyTypeOf } from './sim/types';
import { GameWorld } from './sim/world';
import { GAME_MAPS, MAP_STORAGE_KEY, gameMap, loadMapSelection } from './sim/maps';

type Screen = 'menu' | 'starting' | 'playing' | 'paused' | 'over';

/** One simulation frame per 1/30 s of wall clock, exactly like the SWF. */
const FRAME = 1 / FPS;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('game') as HTMLCanvasElement;
const overlays = { menu: $('menu'), pause: $('pause'), over: $('over') };

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
let physicsStorage: PresetStorage | undefined;
try { physicsStorage = localStorage; } catch { /* Tuning still works in memory. */ }
const physicsLibrary = loadPhysicsLibrary(physicsStorage);
const settings = {
  mode: '1p' as Mode,
  map: loadMapSelection(physicsStorage),
  weather: 'random' as WeatherChoice,
  level: OPTIONS.currentLevel as number,
  /** Bot vs bot: the left CPU's level. */
  p1Level: OPTIONS.championLevel as number,
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
    hazards: true,
    map: settings.map,
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
  if (screen === 'starting') return;
  const fromMenu = screen === 'menu';
  sfx.unlock();
  if (MUSIC_ENABLED) {
    music.unlock();
    music.pickNext();
  }
  applyMute(muted);
  physicsPanel.close();
  gw = createWorld();
  renderer.startMatch(gw, settings.weather);
  describeCourt();
  message = null;
  pendingHit = null;
  acc = 0;
  setScreen('starting');
  $('match-status').textContent = 'Starting match.';
  const transition = animateMatchStart(fromMenu);
  void transition.finished.then(() => {
    // No simulation or serve-clock time elapses behind the opening animation.
    acc = 0;
    last = performance.now();
    setScreen(document.hidden ? 'paused' : 'playing');
    transition.cancel();
    $('match-status').textContent = document.hidden ? 'Match paused.' : 'Match ready.';
  });
}

function describeCourt(): void {
  const map = gameMap(settings.map);
  const atmosphere = map.id === 'graveyard'
    ? WEATHER_OPTIONS.find(option => option.id === renderer.weatherId)!.label : map.atmosphere;
  canvas.setAttribute('aria-label', `${map.label} volleyball court. ${map.obstacleLabel}. ${atmosphere}.`);
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
  const leavingMenu = s === 'starting' && screen === 'menu';
  if (s === 'menu') $('menu').scrollTop = 0;
  screen = s;
  document.body.dataset.screen = s;
  overlays.menu.classList.toggle('show', s === 'menu' || leavingMenu);
  overlays.pause.classList.toggle('show', s === 'paused');
  overlays.over.classList.toggle('show', s === 'over');
  // Keep departing controls inert while the arena is being revealed.
  for (const [name, el] of Object.entries(overlays)) {
    el.inert = name !== (s === 'paused' ? 'pause' : s);
  }
  $('stage').inert = s !== 'playing';
  $('menu').setAttribute('aria-busy', String(s === 'starting'));
  gw.control.clear();
  if (s === 'playing') focusGame();
  if (s === 'starting') (document.activeElement as HTMLElement | null)?.blur();
  const focusTarget = s === 'menu' ? $('play')
    : s === 'paused' ? $('resume')
    : s === 'over' ? ($('over-next').hidden ? $('over-again') : $('over-next'))
    : null;
  focusTarget?.focus({ preventScroll: true });
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
  left: 'Move left', right: 'Move right', jump: 'Jump', down: 'Crouch',
  serve: 'Serve / attack',
};

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
  document.querySelectorAll<HTMLButtonElement>('[data-binding-player]').forEach(button => {
    const player = Number(button.dataset.bindingPlayer) as PlayerId;
    const action = button.dataset.bindingAction as ControlAction;
    const waiting = capturing?.player === player && capturing.action === action;
    const label = keyLabel(settings.bindings[player][action]);
    button.textContent = waiting ? '…' : label;
    button.classList.toggle('capturing', waiting);
    button.setAttribute('aria-pressed', String(waiting));
    button.title = `Player ${player}, ${actionNames[action]}: ${label}. Click to change.`;
    button.setAttribute('aria-label', waiting
      ? `Player ${player}, ${actionNames[action]}: press a key. Escape cancels.` : button.title);
  });
  document.querySelectorAll<HTMLElement>('[data-bind-card]').forEach(card => {
    const player = Number(card.dataset.bindCard) as PlayerId;
    const cpu = isCpuSide(player);
    card.classList.toggle('is-cpu', cpu);
    card.querySelector<HTMLElement>('.badge')!.textContent = cpu ? 'CPU'
      : settings.mode === '1p' ? 'YOU' : `PLAYER ${player}`;
  });
  // Player 1's keys, wherever the help text names them.
  document.querySelectorAll<HTMLElement>('[data-keyof]').forEach((el) => {
    el.textContent = keyLabel(settings.bindings[1][el.dataset.keyof as ControlAction]);
  });
}

function wireBindings(): void {
  const hint = 'Click a key to change it.';
  const status = (player: PlayerId, text: string) => {
    $(`binding-status-${player}`).textContent = text;
  };
  const cancel = () => {
    if (!capturing) return;
    status(capturing.player, hint);
    capturing = null;
    renderBindings();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-binding-player]').forEach(button => {
    button.addEventListener('click', () => {
      if (screen !== 'menu') return;
      cancel();
      const player = Number(button.dataset.bindingPlayer) as PlayerId;
      const action = button.dataset.bindingAction as ControlAction;
      capturing = { player, action };
      status(player, `Press a key for ${actionNames[action].toLowerCase()}. Esc cancels.`);
      renderBindings();
    });
    button.addEventListener('focusout', cancel);
  });
  $('reset-bindings').addEventListener('click', () => {
    cancel();
    settings.bindings = defaultBindings();
    saveBindings(settings.bindings);
    status(1, 'Default keys restored.');
    status(2, 'Default keys restored.');
    renderBindings();
  });
  window.addEventListener('keydown', event => {
    if (!capturing || screen !== 'menu') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    const { player, action } = capturing;
    if (event.code === 'Escape') {
      cancel();
      status(player, 'Key change cancelled.');
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || !isAssignableCode(event.code)) {
      status(player, 'Choose a letter, number, arrow or common key. P and M are reserved.');
      return;
    }
    const code = normalizeCode(event.code);
    const owner = bindingOwner(settings.bindings, code);
    if (owner && (owner.player !== player || owner.action !== action)) {
      status(player, `${keyLabel(code)} is used by Player ${owner.player} for ${actionNames[owner.action].toLowerCase()}. Try another key.`);
      return;
    }
    settings.bindings[player][action] = code;
    saveBindings(settings.bindings);
    capturing = null;
    status(player, `${actionNames[action]}: ${keyLabel(code)}. Saved.`);
    renderBindings();
  }, true);
  window.addEventListener('blur', cancel);
  renderBindings();
}

function wireMenu(): void {
  wireBindings();
  const weatherIcons: Record<WeatherChoice, string> = {
    random: '<path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4"/>',
    rain: '<path d="M5 13a4 4 0 0 1 1-8 6 6 0 0 1 11-1 4.5 4.5 0 0 1 1 9M7 16l-1 3m6-3-1 3m6-3-1 3"/>',
    snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M4 10l4-1-1-4m10 14-1-4 4-1M4 14l4 1-1 4m10-14-1 4 4 1"/>',
    autumn: '<path d="M5 20C1 11 8 5 17 6c2 10-4 16-12 14ZM5 20l9-10m-5 6 5 1M19 2v4m-2-2h4"/>',
  };
  const weatherOptions = [{ id: 'random' as const, label: 'Random', caption: 'Every match' }, ...WEATHER_OPTIONS];
  for (const option of weatherOptions) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'mode weather-option';
    button.dataset.weather = option.id;
    button.setAttribute('aria-pressed', String(option.id === settings.weather));
    button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${weatherIcons[option.id]}</svg>`;
    const label = document.createElement('span'); label.className = 'mode-title'; label.textContent = option.label;
    const caption = document.createElement('span'); caption.className = 'mode-cap'; caption.textContent = option.caption;
    button.append(label, caption); $('weather-options').append(button);
  }
  const mapPreviews: HTMLCanvasElement[] = [];
  for (const [index, option] of GAME_MAPS.entries()) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'mode map-option';
    button.dataset.map = option.id;
    button.setAttribute('aria-pressed', String(option.id === settings.map));
    button.setAttribute('aria-label', `${option.label}. ${option.obstacleLabel}. ${option.caption}.`);
    const preview = document.createElement('canvas');
    preview.width = 320; preview.height = 192; preview.className = 'map-preview';
    preview.setAttribute('aria-hidden', 'true');
    const marker = document.createElement('span'); marker.className = 'map-selected';
    marker.textContent = '✓'; marker.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'mode-title'; label.textContent = option.label;
    const caption = document.createElement('span'); caption.className = 'mode-cap'; caption.textContent = option.obstacleLabel;
    button.append(preview, marker, label, caption); $('map-options').append(button);
    mapPreviews.push(preview);
    button.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? GAME_MAPS.length - 1
        : (index + step + GAME_MAPS.length) % GAME_MAPS.length;
      const next = $('map-options').querySelectorAll<HTMLButtonElement>('button')[target];
      next.click(); next.focus();
    });
  }
  void renderer.ready.then(() => {
    for (const [index, preview] of mapPreviews.entries()) renderer.drawMapPreview(preview, GAME_MAPS[index].id);
    const drawCharacters = () => {
      for (const player of [gw.p1, gw.p2]) {
        drawMenuCharacter(document.querySelector<HTMLCanvasElement>(`[data-menu-player="${player.id}"]`)!, player);
      }
    };
    drawCharacters();
    new ResizeObserver(drawCharacters).observe($('menu'));
  });
  const syncMapDescription = () => {
    const map = gameMap(settings.map);
    $('map-description').textContent = map.description;
    $('selected-map-name').textContent = map.label;
    $('weather-field').hidden = map.id !== 'graveyard';
    describeCourt();
  };
  syncMapDescription();
  const group = (attr: string, apply: (v: string) => void) => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`));
    for (const b of buttons) {
      b.addEventListener('click', () => {
        if (screen !== 'menu') return;
        for (const o of buttons) o.setAttribute('aria-pressed', String(o === b));
        apply(b.getAttribute(`data-${attr}`)!);
      });
    }
  };
  group('mode', (v) => {
    settings.mode = v as Mode;
    $('level-field').hidden = v === '2p';
    $('p1-level-field').hidden = v !== 'cpu';
    renderBindings();
  });
  group('level', (v) => { settings.level = Number(v); syncLevels(); });
  group('p1level', (v) => { settings.p1Level = Number(v); syncLevels(); });
  group('weather', value => {
    settings.weather = value as WeatherChoice;
    renderer.previewWeather(settings.weather);
    $('weather-description').textContent = settings.weather === 'random'
      ? 'A new random sky each match. Pick a weather to preview and test it.'
      : WEATHER_OPTIONS.find(option => option.id === settings.weather)!.description;
    describeCourt();
  });
  group('map', value => {
    settings.map = gameMap(value).id;
    syncMapDescription();
    try { physicsStorage?.setItem(MAP_STORAGE_KEY, settings.map); } catch { /* Selection still works in memory. */ }
    // Preview the complete map and the same obstacle that the next match uses.
    gw = createWorld(true);
  });
  syncLevels();

  const help = $<HTMLDialogElement>('help-panel');
  $('show-help').addEventListener('click', () => help.showModal());
  $('close-help').addEventListener('click', () => help.close());
  help.addEventListener('click', event => {
    if (event.target !== help) return;
    const rect = help.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) help.close();
  });

  $('play').addEventListener('click', startMatch);
  $('resume').addEventListener('click', () => setScreen('playing'));
  $('restart').addEventListener('click', startMatch);
  $('quit').addEventListener('click', () => { gw = createWorld(true); setScreen('menu'); });
  $('over-again').addEventListener('click', startMatch);
  $('over-menu').addEventListener('click', () => { gw = createWorld(true); setScreen('menu'); });
  $('over-next').addEventListener('click', () => {
    if (screen === 'starting') return;
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
    if (e.altKey || e.ctrlKey || e.metaKey || help.open || e.repeat) return;
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
      if (e.variant.id === 'slime' || e.variant.id === 'chameleon') sfx.splat();
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

function tick(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;

  if (screen === 'menu') {
    requestAnimationFrame(tick);
    return;
  }
  const running = screen === 'playing';
  if (running) {
    acc += dt;
    let n = 0;
    while (acc >= FRAME && n < 5) {
      simFrame();
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
$('debug-launch').addEventListener('click', () => gw.control.clear());
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
