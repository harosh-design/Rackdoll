import {
  BALL, BALL_TINT, BOXER, CHAMELEON, CHARGE, COURT, FLIP, EXECUTER, FLOOR_TOP_PX, FPS, MAGNET, MAX_TOUCHES, OPTIONS, PARTS, PRIZE_ANIM,
  PRIZE_BUTTONS, SLIME, SPRING, STUN, SWING, VIEW, toPx, type PartName,
} from '../sim/constants';
import type { Body, Vec2Value } from 'planck';
import type { Executer } from '../sim/executer';
import { type ExecuterId } from '../sim/executerVariants';
import type { GameWorld } from '../sim/world';
import type { PrizeButton } from '../sim/prizeButton';
import { POWER_LABELS } from '../sim/powerUps';
import { drawFamiliarPops, drawFamiliars } from './familiars';
import { drawHorrorProp, HORROR_HAZARD_LABELS } from './horrorProps';
import { COMIC, COMIC_TEXT, COMIC_TITLE, burstPath, comicPanel, hatch, inkRect } from './comicStyle';
import { STAGE } from './stageLayout';
import { SOLE_Y } from './dollArt';
import { closedPoses, type PoseSource } from './dollPose';
import type { Interpolator, Pose } from './interp';
import { AmbientBackdrop } from './ambientBackdrop';
import { drawHorrorBackground, drawHorrorPlayers, loadHorrorArt } from './horrorArt';
import { PencilGrain } from './pencilGrain';
import { RUBBER_NET, SHARP_SPIKE } from '../sim/centerObstacle';
import { gameMap, type GameMapId } from '../sim/maps';
import { MapScenery } from './mapScenery';
import { drawSteamPipe, drawStitchedPole } from './mapObstacles';
import { drawBallArt, loadBallArt, pickBallSkin, type BallSkin } from './ballArt';
import { DEFAULT_GRAVE_SKINS, drawGraveArt, loadGraveArt, pickGraveSkins, type GraveSkins } from './graveArt';
import { BallSquash, type BallDeformation } from './ballDeformation';
import { drawChameleonArt, drawChameleonTongue, loadChameleonArt } from './chameleonArt';
import { drawSpikeBlood } from './spikeArt';
import { drawFeatherAirflow } from './featherAirflow';
import { pickWeather, WeatherEffects, type WeatherChoice, type WeatherId } from './weather';


/**
 * Canvas renderer. A 640x400 stage frames the original world at scale 0.56.
 * STAGE centres the arena and leaves a shallow foreground beneath the court.
 * The comic cutouts use the same interpolated ragdoll poses and unchanged
 * simulation geometry. Paper grain is composited before the HUD.
 */

const PAL = {
  jersey: { 1: COMIC.ochre, 2: COMIC.mint }, housing: COMIC.ink,
  prizeLive: COMIC.rust, prizeLiveGlow: '197,106,81', prizeGlow: '218,176,92',
  prizeCore: COMIC.paper,
} as const;

const partDef = (name: PartName) => PARTS.find((p) => p.name === name)!;
const footHalfHeight = ((s) => (s.kind === 'box' ? s.hh : s.r))(partDef('FootLeft').shape);

/** Where a standing doll's drawn soles are: the feet hang below the shin colliders. */
const SOLES_PX = FLOOR_TOP_PX + SOLE_Y - footHalfHeight;

/**
 * HUD columns, stage px: the score panels flank the central queue caption
 * with an 11 px gap on either side.
 */
const HUD_LEFT_X = 164;
const HUD_RIGHT_X = VIEW.stageW - HUD_LEFT_X;

/**
 * The top bar, stage px, centred over the court. The page puts its own
 * controls (pause, sound, fullscreen) in the middle `controlsW`, below the
 * printed hazard and target-score caption.
 */
export const HUD_BAR = {
  midX: (HUD_LEFT_X + HUD_RIGHT_X) / 2,
  y: 30,
  h: 18,
  controlsW: 88,
  gap: 5,
} as const;

export interface HudState {
  singlePlayer: boolean;
  /** Freeze decorative scenery together with the match. */
  paused?: boolean;
  /** A banner across the court, e.g. "POINT! · 4 TOUCHES". */
  message: string | null;
  /** Whose jersey colours the banner; 0 for neutral. */
  messageTone: 0 | 1 | 2;
}

interface DustPuff {
  x: number;
  frame: number;
  drift: number;
  size: number;
}

interface MotionState {
  frame: number;
  grounded: Record<1 | 2, boolean>;
  lastStep: Record<1 | 2, number>;
  dust: DustPuff[];
}

interface BallTrailPoint {
  x: number;
  y: number;
  frame: number;
  strength: number;
}

/** Render history in simulation frames, so the tail freezes with the match. */
const BALL_TRAIL_FRAMES = FPS * 0.45;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly motion = new WeakMap<GameWorld, MotionState>();
  private readonly ballTrails = new WeakMap<GameWorld, BallTrailPoint[]>();
  private readonly ballSkins = new WeakMap<GameWorld, BallSkin>();
  private readonly graveSkins = new WeakMap<GameWorld, GraveSkins>();
  private previousGraveSkins?: GraveSkins;
  private readonly ballSquashes = new WeakMap<GameWorld, BallSquash>();
  private previousBallSkin?: BallSkin;
  /** Device pixels per stage pixel. */
  private k = 1;
  private grainPixelRatio = 1;
  private scenerySeconds = 0;
  private sceneryAt: number | null = null;
  private weather = new WeatherEffects(pickWeather('random'));
  private previousWeather?: WeatherId;
  private weatherStartedAt = 0;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly grain = new PencilGrain();
  private readonly backdrop: AmbientBackdrop | null;
  private readonly mapScenery = new MapScenery();
  readonly ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement, backdrop?: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.backdrop = backdrop ? new AmbientBackdrop(backdrop) : null;
    this.resize();
    this.ready = Promise.all([loadHorrorArt(), loadBallArt(), loadGraveArt(), loadChameleonArt(), this.mapScenery.load()]).then(() => {});
  }

  /** Called only for a new match; rounds and pauses retain their skins and weather. */
  startMatch(gw: GameWorld, weatherChoice: WeatherChoice = 'random'): void {
    this.setWeather(pickWeather(weatherChoice, this.previousWeather));
    this.previousWeather = this.weather.id;
    const skin = pickBallSkin(this.previousBallSkin);
    this.ballSkins.set(gw, skin);
    this.previousBallSkin = skin;
    const graves = pickGraveSkins(this.previousGraveSkins);
    this.graveSkins.set(gw, graves);
    this.previousGraveSkins = graves;
    this.ballSquashFor(gw);
  }

  get weatherId(): WeatherId { return this.weather.id; }

  drawMapPreview(canvas: HTMLCanvasElement, id: GameMapId): void {
    this.mapScenery.drawPreview(canvas, id);
  }

  /** Menu previews replace only the decorative weather, without restarting physics. */
  previewWeather(choice: WeatherChoice): void {
    this.setWeather(pickWeather(choice));
  }

  private setWeather(id: WeatherId): void {
    this.weather = new WeatherEffects(id);
    this.weatherStartedAt = this.scenerySeconds;
  }

  private ballSquashFor(gw: GameWorld): BallSquash {
    let squash = this.ballSquashes.get(gw);
    if (!squash) {
      squash = new BallSquash(gw);
      this.ballSquashes.set(gw, squash);
    }
    return squash;
  }

  ballSkinFor(gw: GameWorld): BallSkin {
    return this.ballSkins.get(gw) ?? this.previousBallSkin ?? 'stitched';
  }

  graveSkinsFor(gw: GameWorld): GraveSkins {
    return this.graveSkins.get(gw) ?? this.previousGraveSkins ?? DEFAULT_GRAVE_SKINS;
  }

  /** Fit the 640x400 stage into the canvas's CSS box at device resolution. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.k = w / VIEW.stageW;
    this.grainPixelRatio = w / Math.max(1, rect.width);
    this.backdrop?.resize(rect);
  }

  // -------------------------------------------------------------------------
  // Transforms
  // -------------------------------------------------------------------------

  /** The fixed stage coordinates used by the HUD and scenery. */
  private stageSpace(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
  }

  /** World pixels at the fixed arena scale and placement. */
  private worldSpace(ctx: CanvasRenderingContext2D): void {
    const s = this.k * VIEW.scale;
    ctx.setTransform(s, 0, 0, s, this.k * STAGE.offsetX, this.k * STAGE.offsetY);
  }

  /** Where a world point lands on the fixed stage. */
  private toStage(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * VIEW.scale + STAGE.offsetX, y: wy * VIEW.scale + STAGE.offsetY };
  }

  // -------------------------------------------------------------------------
  // Court: pencil sky, isolated scenery, ground, walls and center obstacle,
  // drawn at the fixed arena scale each frame.
  // -------------------------------------------------------------------------

  private paintCourt(ctx: CanvasRenderingContext2D, gw: GameWorld): void {
    this.backdrop?.draw(this.scenerySeconds, gameMap(gw.mapId).surround);
    this.stageSpace(ctx);
    const floorY = this.toStage(0, SOLES_PX).y;
    const weatherSeconds = this.scenerySeconds - this.weatherStartedAt;
    if (gw.mapId === 'graveyard') {
      drawHorrorBackground(ctx, VIEW.stageW, VIEW.stageH, floorY, this.scenerySeconds,
        this.weather, weatherSeconds, this.reducedMotion.matches);
      this.weather.drawCourt(ctx, VIEW.stageW, VIEW.stageH, floorY, weatherSeconds, this.reducedMotion.matches);
    } else {
      this.mapScenery.draw(ctx, gw.mapId, VIEW.stageW, VIEW.stageH, floorY,
        this.scenerySeconds, this.reducedMotion.matches);
    }
    this.worldSpace(ctx);
    const ground = COURT.ground;
    ctx.fillStyle = gw.mapId === 'graveyard' ? '#cfb3cb' : gw.mapId === 'crematorium' ? '#a28587' : '#b08783';
    ctx.fillRect(ground.x - ground.hw, SOLES_PX, ground.hw * 2, 1.2);
    for (const wall of [COURT.leftWall, COURT.rightWall]) {
      const left = wall === COURT.leftWall;
      const inner = left ? wall.x + wall.hw : wall.x - wall.hw;
      ctx.fillStyle = '#11101c';
      ctx.fillRect(left ? inner - 4000 : inner, -4000, 4000, 4500);
      ctx.fillStyle = '#323453';
      ctx.fillRect(left ? inner - 1.5 : inner, -4000, 1.5, 4500);
    }
    for (const button of PRIZE_BUTTONS) {
      const inward = button.side === 1 ? 1 : -1;
      const wallFace = button.x - inward * (button.hw + 1);
      const depth = PRIZE_ANIM.pressDepthPx + 3;
      ctx.fillStyle = PAL.housing;
      inkRect(ctx, inward === 1 ? wallFace - depth : wallFace, button.y - button.hh - 4, depth, button.hh * 2 + 8, 2);
      ctx.fill();
    }
  }

  /** Draw the selected physical geometry, including bending. */
  private drawCenterObstacle(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const obstacle = gw.centerObstacle;
    const x = COURT.net.x, top = COURT.net.y - COURT.net.hh;
    ctx.save(); ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1.6;
    if (obstacle.id === 'sharp') {
      ctx.beginPath(); ctx.moveTo(x - SHARP_SPIKE.halfWidthPx, FLOOR_TOP_PX);
      ctx.lineTo(x, SHARP_SPIKE.topPx); ctx.lineTo(x + SHARP_SPIKE.halfWidthPx, FLOOR_TOP_PX); ctx.closePath();
      ctx.fillStyle = COMIC.paper; ctx.fill(); ctx.stroke();
      ctx.save(); ctx.clip(); hatch(ctx, x - 6, top, 7, FLOOR_TOP_PX - top, 7); ctx.restore();
      ctx.strokeStyle = COMIC.plum; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x, top + 10); ctx.lineTo(x + 1, FLOOR_TOP_PX); ctx.stroke();
    } else if (obstacle.id === 'blower') {
      drawSteamPipe(ctx, x, top, FLOOR_TOP_PX, this.reducedMotion.matches ? 0.6 : this.scenerySeconds);
    } else {
      const halfHeight = (RUBBER_NET.basePx - top) / RUBBER_NET.segments / 2;
      const points: Array<{ x: number; y: number }> = [{ x, y: RUBBER_NET.basePx }];
      for (const body of obstacle.bodies) {
        const pose = interp.pose(body, alpha);
        points.push({ x: pose.x + Math.sin(pose.a) * halfHeight, y: pose.y - Math.cos(pose.a) * halfHeight });
      }
      drawStitchedPole(ctx, points);
    }
    drawSpikeBlood(ctx, obstacle, SOLES_PX, alpha);
    if (obstacle.id !== 'blower') comicPanel(ctx, x - 9, FLOOR_TOP_PX, 18, SOLES_PX - FLOOR_TOP_PX + 3, COMIC.plum);
    ctx.restore();
  }

  draw(gw: GameWorld, frames: Interpolator, alpha: number, hud: HudState): void {
    const ctx = this.ctx;
    const sceneryAt = performance.now() / 1000;
    const sceneryDt = this.sceneryAt === null ? 0 : Math.min(0.1, Math.max(0, sceneryAt - this.sceneryAt));
    this.weather.observeFrame(sceneryDt, !hud.paused && !document.hidden);
    if (this.sceneryAt !== null && !hud.paused) this.scenerySeconds += sceneryDt;
    this.sceneryAt = sceneryAt;
    const interp = closedPoses(frames, alpha, [gw.p1, gw.p2], gw.ball.body);
    const now = gw.frame - 1 + alpha;
    this.paintCourt(ctx, gw);
    drawFeatherAirflow(ctx, gw, now);
    this.drawShadows(gw, interp, alpha);
    this.worldSpace(ctx);
    for (const e of gw.executers) {
      if (!e.dead && e.variant.id === 'magnet') this.drawMagnetField(ctx, e, interp, alpha);
    }
    this.drawCenterObstacle(ctx, gw, interp, alpha);
    this.drawPrizeButtons(ctx, gw, now);
    this.drawFootMotion(ctx, gw, interp, now);
    drawHorrorPlayers(ctx, [gw.p1, gw.p2], interp, alpha);
    this.drawPowerGlows(ctx, gw, interp, alpha);
    drawFamiliars(ctx, gw, now, alpha);
    this.drawBall(ctx, gw, interp, alpha);
    drawFamiliarPops(ctx, gw, interp, alpha, now);
    this.drawSwingEffects(ctx, gw, interp, alpha);
    this.drawOpponentHitEffects(ctx, gw, interp, alpha);
    this.drawStunEffects(ctx, gw, interp, alpha);
    this.drawSpecialEffects(ctx, gw, interp, alpha);
    for (const e of gw.executers) if (!e.dead) this.drawExecuter(ctx, e, interp, alpha);
    this.drawChargeMeters(ctx, gw, interp, alpha);
    this.stageSpace(ctx);
    if (gw.mapId === 'graveyard') this.weather.drawForeground(ctx, VIEW.stageW, VIEW.stageH, this.toStage(0, SOLES_PX).y,
      this.scenerySeconds - this.weatherStartedAt, this.reducedMotion.matches);
    this.grain.draw(ctx, this.canvas.width, this.canvas.height, this.scenerySeconds, this.grainPixelRatio);
    this.stageSpace(ctx);
    this.drawOffscreenBall(ctx, gw, interp, alpha);
    this.drawOffscreenPlayers(ctx, gw, interp, alpha);
    this.drawHud(ctx, gw, hud, now);
  }

  private drawShadows(gw: GameWorld, interp: PoseSource, alpha: number): void {
    const ctx = this.ctx; ctx.save(); this.worldSpace(ctx);
    for (const p of [gw.p1, gw.p2]) {
      const hips = interp.pose(p.ass, alpha);
      const left = interp.pose(p.activePart('FootLeft'), alpha), right = interp.pose(p.activePart('FootRight'), alpha);
      const lift = Math.max(0, FLOOR_TOP_PX - Math.max(left.y, right.y) - footHalfHeight * p.sizeScale);
      const radius = (24 + lift * 0.025) * p.sizeScale;
      ctx.globalAlpha = 0.28 / (1 + lift / 100); ctx.fillStyle = COMIC.ink;
      ctx.beginPath(); ctx.ellipse(hips.x, SOLES_PX, radius, 3 * p.sizeScale, -0.02, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  private drawFootMotion(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, now: number): void {
    let state = this.motion.get(gw);
    if (!state) {
      state = { frame: -1, grounded: { 1: gw.p1.grounded, 2: gw.p2.grounded }, lastStep: { 1: -20, 2: -20 }, dust: [] };
      this.motion.set(gw, state);
    }
    if (gw.frame > state.frame) {
      for (const p of [gw.p1, gw.p2]) {
        if (!p.isAttached('FootLeft') && !p.isAttached('FootRight')) continue;
        const grounded = p.grounded;
        const vx = p.ass.getLinearVelocity().x;
        const vy = p.ass.getLinearVelocity().y;
        const left = interp.pose(p.activePart('FootLeft'), 1);
        const right = interp.pose(p.activePart('FootRight'), 1);
        const x = (left.x + right.x) / 2;
        if (grounded && !state.grounded[p.id]) {
          state.dust.push({ x, frame: gw.frame, drift: -Math.sign(vx) * 0.35, size: 1.5 });
        } else if (!grounded && state.grounded[p.id] && vy < -1) {
          state.dust.push({ x, frame: gw.frame, drift: 0, size: 0.85 });
        } else if (grounded && Math.abs(vx) > 2.5 && gw.frame - state.lastStep[p.id] >= 6) {
          state.dust.push({ x: x - Math.sign(vx) * 7, frame: gw.frame, drift: -Math.sign(vx) * 0.5, size: 0.7 });
          state.lastStep[p.id] = gw.frame;
        }
        state.grounded[p.id] = grounded;
      }
      state.dust = state.dust.filter((puff) => gw.frame - puff.frame < 15);
      state.frame = gw.frame;
    }
    ctx.save();
    for (const puff of state.dust) {
      const age = now - puff.frame;
      if (age < 0 || age >= 15) continue;
      const fade = (1 - age / 15) ** 2;
      ctx.fillStyle = `rgba(255,246,218,${0.55 * fade})`;
      for (const side of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.ellipse(
          puff.x + side * (5 + age * 0.55) * puff.size + age * puff.drift,
          SOLES_PX - 2 - age * (0.25 + 0.12 * Math.abs(side)),
          (4 + age * 0.23) * puff.size,
          (2.5 + age * 0.12) * puff.size,
          0, 0, Math.PI * 2,
        );
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** An ink halo and a rising lettered callout identify active powers. */
  private drawPowerGlows(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    for (const p of [gw.p1, gw.p2]) {
      const power = gw.powerUps.active[p.id];
      if (!power) continue;
      const head = interp.pose(p.head, alpha);
      ctx.save();
      ctx.strokeStyle = COMIC.ochre;
      ctx.lineWidth = 1.2;
      burstPath(ctx, head.x, head.y, 18 * p.sizeScale + 2, 8);
      ctx.stroke();
      const age = now - power.startedAt;
      if (age >= 0 && age < 1.5 * FPS) {
        const fade = Math.min(1, 2 - age / (0.75 * FPS));
        ctx.font = 'bold 16px ' + COMIC_TEXT;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(17,16,26,${0.9 * fade})`;
        ctx.fillStyle = `rgba(235,220,181,${fade})`;
        const y = head.y - 30 * p.sizeScale - age * 0.8;
        ctx.strokeText(`${POWER_LABELS[power.kind]}!`, head.x, y);
        ctx.fillText(`${POWER_LABELS[power.kind]}!`, head.x, y);
      }
      ctx.restore();
    }
  }

  /**
   * A rust-red bar and a ragged mark where the feet sweep show the
   * windup. A faint line shows when the nearby ball is in attraction range.
   */
  private drawChargeMeters(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    for (const p of [gw.p1, gw.p2]) {
      const info = gw.control.chargeLevel(p.id);
      if (!info) continue;
      const pose = interp.pose(p.head, alpha);
      const sign = p.id === 1 ? 1 : -1;
      const finger = { x: pose.x + sign * FLIP.kickAheadPx * p.sizeScale, y: pose.y - FLIP.kickAbovePx * p.sizeScale };
      if (!gw.ball.held && info.power < 1) {
        const ball = interp.pose(gw.ball.body, alpha);
        const distance = Math.hypot(ball.x - finger.x, ball.y - finger.y);
        if (distance < CHARGE.attractRadiusPx) {
          ctx.beginPath();
          ctx.moveTo(finger.x, finger.y);
          ctx.lineTo(ball.x, ball.y);
          ctx.strokeStyle = `rgba(197,106,81,${0.15 + 0.35 * info.power * (1 - distance / CHARGE.attractRadiusPx)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      burstPath(ctx, finger.x, finger.y, 9 + 9 * info.power, 8);
      ctx.strokeStyle = `rgba(197,106,81,${0.35 + 0.5 * info.power})`;
      ctx.lineWidth = 2 + 2 * info.power;
      ctx.stroke();
      const w = 32;
      const h = 5;
      const x = pose.x - w / 2;
      const y = pose.y - 26;
      ctx.fillStyle = 'rgba(15,25,35,0.55)';
      inkRect(ctx, x, y, w, h, 2.5);
      ctx.fill();
      ctx.fillStyle = PAL.prizeLive;
      inkRect(ctx, x, y, Math.max(w * clamp01(info.power), 2), h, 2.5);
      ctx.fill();
      ctx.strokeStyle = COMIC.ink;
      ctx.lineWidth = 0.8;
      inkRect(ctx, x, y, w, h, 2.5);
      ctx.stroke();
    }
  }

  /** A streak follows the feet round the flip; a forward wave shows the kick's reach. */
  private drawSwingEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    for (const p of [gw.p1, gw.p2]) {
      const effect = gw.swingEffects[p.id];
      const age = now - effect.frame;
      if (age < 0 || age >= FLIP.maxFrames) continue;
      // Fade out once the doll has come round, or as the flip runs long.
      const fade = p.flipping ? 1 - 0.5 * age / FLIP.maxFrames : 0;
      if (fade <= 0) continue;
      const hips = interp.pose(p.ass, alpha);
      const head = interp.pose(p.head, alpha);
      const cx = (hips.x + head.x) / 2;
      const cy = (hips.y + head.y) / 2;
      const attachedFeet = (['FootLeft', 'FootRight'] as const).filter(name => p.isAttached(name));
      const tips = attachedFeet.length ? attachedFeet : (['LegLeft', 'LegRight'] as const).filter(name => p.isAttached(name));
      const feet = tips.map(name => interp.pose(p.part(name), alpha));
      if (!feet.length) continue;
      const fx = feet.reduce((sum, foot) => sum + foot.x, 0) / feet.length;
      const fy = feet.reduce((sum, foot) => sum + foot.y, 0) / feet.length;
      const radius = Math.hypot(fx - cx, fy - cy);
      const at = Math.atan2(fy - cy, fx - cx);
      // The streak trails behind the feet, against the spin.
      const back = p.id === 1 ? -1 : 1;
      const tail = Math.min(Math.PI * 1.1, p.flipProgress * Math.PI * 2);
      ctx.save();
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const span = tail * (1 - i * 0.3);
        ctx.strokeStyle = `rgba(255,246,210,${(0.55 - i * 0.15) * fade})`;
        ctx.lineWidth = (3 + 3 * effect.power) * (1 - i * 0.25);
        ctx.beginPath();
        ctx.arc(cx, cy, radius + i * 6, at, at + back * span, back < 0);
        ctx.stroke();
      }
      const sign = p.id === 1 ? 1 : -1;
      const reach = p.flipProgress * Math.PI * 2 >= FLIP.opponentFromRad;
      if (reach) {
        const travel = SWING.opponentReachPx * Math.min(1, p.flipProgress * 2);
        const waveX = head.x + sign * travel;
        ctx.strokeStyle = `rgba(255,235,155,${0.6 * fade})`;
        ctx.lineWidth = 2 + 2 * effect.power;
        ctx.beginPath();
        ctx.moveTo(waveX - sign * 14, head.y - 30);
        ctx.quadraticCurveTo(waveX + sign * 12, head.y, waveX - sign * 14, head.y + 30);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Orbiting stars and a draining bar remain visible for the whole stun. */
  private drawStunEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    for (const p of [gw.p1, gw.p2]) {
      if (p.stunFrames <= 0) continue;
      const head = interp.pose(p.head, alpha);
      ctx.save();
      ctx.fillStyle = COMIC.ochre;
      ctx.strokeStyle = COMIC.ink;
      ctx.lineWidth = 0.9;
      for (let star = 0; star < 3; star++) {
        const angle = now * 0.16 + star * Math.PI * 2 / 3;
        const x = head.x + Math.cos(angle) * 23 * p.sizeScale;
        const y = head.y - 25 * p.sizeScale + Math.sin(angle) * 6;
        ctx.beginPath();
        for (let point = 0; point < 10; point++) {
          const a = -Math.PI / 2 + point * Math.PI / 5;
          const radius = point % 2 === 0 ? 5 : 2.3;
          const px = x + Math.cos(a) * radius;
          const py = y + Math.sin(a) * radius;
          if (point === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      const y = head.y - 40 * p.sizeScale;
      ctx.fillStyle = 'rgba(25,30,45,0.55)';
      inkRect(ctx, head.x - 16, y, 32, 3, 1.5);
      ctx.fill();
      ctx.fillStyle = COMIC.ochre;
      inkRect(ctx, head.x - 16, y, 32 * p.stunFrames / STUN.frames, 3, 1.5);
      ctx.fill();
      ctx.restore();
    }
  }

  /** A brief impact ring makes the opponent knockback clear. */
  private drawOpponentHitEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    for (const p of [gw.p1, gw.p2]) {
      const effect = gw.opponentHitEffects[p.id];
      const age = now - effect.frame;
      if (age < 0 || age >= 10) continue;
      const pose = interp.pose(p.tors, alpha);
      const fade = 1 - age / 10;
      ctx.save();
      burstPath(ctx, pose.x, pose.y, 18 + effect.power * 8 + age * 2.5);
      ctx.strokeStyle = `rgba(255,245,190,${0.8 * fade})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Callouts for timing-based moves. */
  private drawSpecialEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    const ball = interp.pose(gw.ball.body, alpha);
    for (const p of [gw.p1, gw.p2]) {
      const perfect = gw.perfectEffects[p.id];
      const perfectAge = now - perfect.frame;
      if (perfectAge >= 0 && perfectAge < 12) {
        const fade = 1 - perfectAge / 12;
        ctx.save();
        ctx.strokeStyle = `rgba(218,176,92,${fade})`;
        ctx.lineWidth = 3;
        burstPath(ctx, ball.x, ball.y, 22 + perfectAge * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(235,220,181,${fade})`;
        ctx.strokeStyle = `rgba(17,16,26,${fade})`; ctx.lineWidth = 3;
        ctx.font = '20px ' + COMIC_TITLE;
        ctx.textAlign = 'center';
        ctx.strokeText('KICK!', ball.x, ball.y - 30 - perfectAge);
        ctx.fillText('KICK!', ball.x, ball.y - 30 - perfectAge);
        ctx.restore();
      }
    }

    const age = now - gw.counterEffect.frame;
    if (age >= 0 && age < 14) {
      const fade = 1 - age / 14;
      ctx.save();
      ctx.strokeStyle = `rgba(255,245,190,${fade})`;
      ctx.lineWidth = 4;
      burstPath(ctx, ball.x, ball.y, 24 + age * 3);
      ctx.stroke();
      ctx.fillStyle = `rgba(235,220,181,${fade})`;
      ctx.strokeStyle = `rgba(17,16,26,${fade})`; ctx.lineWidth = 3;
      ctx.font = '22px ' + COMIC_TITLE;
      ctx.textAlign = 'center';
      ctx.strokeText('CLASH!', ball.x, ball.y - 38 - age);
      ctx.fillText('CLASH!', ball.x, ball.y - 38 - age);
      ctx.restore();
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const pose = interp.pose(gw.ball.body, alpha);
    const v = gw.ball.velocity;
    const speed = Math.hypot(v.x, v.y);
    const r = gw.ball.radiusPx;
    const now = gw.frame - 1 + alpha;
    const tint = this.currentBallTint(gw, now);
    const skin = this.ballSkinFor(gw);
    const deformation = this.ballSquashFor(gw).sample(now);

    this.drawBallTrail(ctx, gw, pose, now, speed, r);

    // Motion blur: |vx|/7, or |angularVelocity|/11 below 4.5 m/s (§9).
    const blur = Math.abs(v.x) >= 4.5
      ? Math.abs(v.x) / 7
      : Math.abs(gw.ball.body.getAngularVelocity()) / 11;
    const ghosts = Math.min(3, Math.floor(blur));
    for (let i = ghosts; i >= 1; i--) {
      const back = (i * Math.min(speed, 20)) / 28 / 3 * 30;
      const ux = speed > 0 ? v.x / speed : 0;
      const uy = speed > 0 ? v.y / speed : 0;
      ctx.globalAlpha = 0.12 / i;
      this.ballArt(ctx, { x: pose.x - ux * back, y: pose.y - uy * back, a: pose.a }, skin, tint, deformation);
    }
    ctx.globalAlpha = 1;
    this.ballArt(ctx, pose, skin, tint, deformation);
  }

  /** A tapered comet wake follows the actual flight, including curved shots and bounces. */
  private drawBallTrail(ctx: CanvasRenderingContext2D, gw: GameWorld, pose: Pose, now: number, speed: number, r: number): void {
    let points = this.ballTrails.get(gw);
    if (!points) { points = []; this.ballTrails.set(gw, points); }
    const last = points[points.length - 1];
    if (gw.ball.held || gw.ball.ballOfPlayer !== 0) { points.length = 0; return; }
    if (last && (now < last.frame || Math.hypot(pose.x - last.x, pose.y - last.y) > 180)) points.length = 0;
    while (points.length && now - points[0].frame >= BALL_TRAIL_FRAMES) points.shift();
    const strength = clamp01((speed - 1) / 12), newest = points[points.length - 1];
    if (!newest || now > newest.frame) points.push({ x: pose.x, y: pose.y, frame: now, strength });
    if (points.length > 64) points.splice(0, points.length - 64);
    ctx.save(); ctx.lineCap = 'butt';
    for (const offset of [-0.75, 0, 0.75]) for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const life = clamp01(1 - (now - (a.frame + b.frame) / 2) / BALL_TRAIL_FRAMES);
      const energy = (a.strength + b.strength) / 2;
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
      const ox = -dy / length * r * offset, oy = dx / length * r * offset;
      ctx.globalAlpha = life * life * energy * (offset === 0 ? 0.8 : 0.45);
      ctx.lineWidth = offset === 0 ? 2 : 0.9;
      ctx.strokeStyle = offset === 0 ? COMIC.paper : COMIC.ink;
      ctx.beginPath(); ctx.moveTo(a.x + ox, a.y + oy); ctx.lineTo(b.x + ox, b.y + oy); ctx.stroke();
    }
    ctx.restore();
  }

  private currentBallTint(gw: GameWorld, now: number): { rgb: string; alpha: number } | null {
    const t = gw.ballTint; if (!t.player) return null;
    const k = clamp01((now - t.frame) / BALL_TINT.fadeInFrames);
    const colors = { 0: [235, 220, 181], 1: [218, 176, 92], 2: [159, 198, 173] };
    const from = colors[t.previous], to = colors[t.player];
    const rgb = to.map((c, i) => Math.round(from[i] + (c - from[i]) * k)).join(',');
    return { rgb, alpha: BALL_TINT.alpha * (t.previous ? 1 : k) };
  }

  private ballArt(ctx: CanvasRenderingContext2D, pose: Pose, skin: BallSkin, tint?: { rgb: string; alpha: number } | null, deformation?: BallDeformation | null): void {
    const r = BALL.radiusPx; ctx.save(); ctx.translate(pose.x, pose.y);
    if (deformation) {
      ctx.rotate(deformation.angle);
      ctx.scale(deformation.normalScale, deformation.tangentScale);
      ctx.rotate(pose.a - deformation.angle);
    } else ctx.rotate(pose.a);
    drawBallArt(ctx, skin, r);
    if (tint && tint.alpha > 0) {
      ctx.beginPath(); ctx.arc(0, 0, r - 0.65, 0, Math.PI * 2); ctx.clip();
      // Tint the printed colors without washing out stitches, craters or the iris.
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha *= tint.alpha * 0.3;
      ctx.fillStyle = 'rgb(' + tint.rgb + ')'; ctx.fillRect(-r, -r, r * 2, r * 2);
    }
    ctx.restore();
  }

  /** The fixed boundary shares the simulation's reach; only the inner waves move. */
  private drawMagnetField(ctx: CanvasRenderingContext2D, e: Executer, interp: PoseSource, alpha: number): void {
    const pose = interp.pose(e.body, alpha);
    const radius = MAGNET.fieldPx;
    const active = e.solid && e.knockbackFrames === 0;
    const left = COURT.leftWall.x + COURT.leftWall.hw;
    const right = COURT.rightWall.x - COURT.rightWall.hw;
    ctx.save();
    // Keep the field inside the visible court, behind players and the ball.
    ctx.beginPath(); ctx.rect(left, -4000, right - left, SOLES_PX + 4000); ctx.clip();
    ctx.translate(pose.x, pose.y);
    ctx.globalAlpha = active ? 1 : 0.25;
    const glow = ctx.createRadialGradient(0, 0, EXECUTER.radiusPx, 0, 0, radius);
    glow.addColorStop(0, 'rgba(159,198,173,0.14)');
    glow.addColorStop(0.7, 'rgba(159,198,173,0.06)');
    glow.addColorStop(1, 'rgba(159,198,173,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();

    ctx.setLineDash([9, 7]);
    ctx.strokeStyle = 'rgba(17,16,26,0.5)'; ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(159,198,173,0.75)'; ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.setLineDash([]);

    if (active && !this.reducedMotion.matches) {
      const t = (e.age + alpha) / (FPS * 2.4);
      for (let i = 0; i < 3; i++) {
        const progress = (t + i / 3) % 1;
        const waveRadius = EXECUTER.radiusPx + (radius - EXECUTER.radiusPx) * (1 - progress);
        ctx.strokeStyle = `rgba(159,198,173,${0.2 * Math.sin(progress * Math.PI)})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(0, 0, waveRadius, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawExecuter(ctx: CanvasRenderingContext2D, e: Executer, interp: PoseSource, alpha: number): void {
    const pose = interp.pose(e.body, alpha);
    const t = e.age + alpha;
    if (e.variant.id === 'slime') this.drawSlimeGlue(ctx, e, interp, alpha, t);
    if (e.variant.id === 'chameleon') drawChameleonTongue(ctx, e, pose, interp, alpha);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    if (!e.solid) {
      // Emerging from the button: grows to full size as it clears the wall.
      const emergeFrames = e.variant.id === 'chameleon' ? CHAMELEON.emergeFrames : EXECUTER.emergeFrames;
      const k = 0.45 + 0.55 * easeOutCubic(Math.min(1, t / emergeFrames));
      if (e.variant.id === 'chameleon') {
        const wall = e.side === 1 ? COURT.leftWall.x + COURT.leftWall.hw : COURT.rightWall.x - COURT.rightWall.hw;
        ctx.translate(wall - pose.x, 0); ctx.scale(k, k); ctx.translate(pose.x - wall, 0);
      } else ctx.scale(k, k);
    }
    const c = e.body.getWorldCenter();
    const aim = e.target.tors.getWorldCenter();
    const toTarget = Math.atan2(aim.y - c.y, aim.x - c.x);
    switch (e.variant.id) {
      case 'magnet':
        this.drawMagnetArt(ctx, toTarget, e.field, e.phase === 'latched', t);
        break;
      case 'boxer':
        this.drawBoxer(ctx, e, pose, interp.pose(e.target.head, alpha));
        break;
      case 'comet': {
        const v = e.body.getLinearVelocity();
        const facing = e.previousFacingAngle + (e.facingAngle - e.previousFacingAngle) * alpha;
        this.drawCometArt(ctx, facing, Math.atan2(v.y, v.x), v.length(), e.phase === 'dash', t);
        break;
      }
      case 'spring': {
        const v = e.body.getLinearVelocity();
        const bounce = e.lastBounce;
        const since = bounce ? t - bounce.age : 100;
        const squash = Math.exp(-since * 0.17);
        const heading = Math.atan2(v.y, v.x);
        const normalAngle = bounce ? Math.atan2(bounce.ny, bounce.nx) : heading;
        const delta = Math.atan2(Math.sin(normalAngle - heading), Math.cos(normalAngle - heading));
        this.drawSpringArt(ctx, heading + delta * squash, springStretch(e, t), e.slamPower, t,
          Math.sin(t * 0.7) * (0.8 + 2 * e.slamPower) + Math.sin(since * 0.65) * squash * 6);
        break;
      }
      case 'slime': {
        // Its eyes are on the part it is reeling in, or else its player.
        const look = (e.reelPart ?? e.target.head).getWorldCenter();
        const v = e.body.getLinearVelocity();
        const splat = e.host ? interp.pose(e.host, alpha).a : null;
        this.drawSlimeArt(
          ctx, Math.atan2(v.y, v.x), clamp01(v.length() / SLIME.flySpeed), splat, Math.atan2(look.y - c.y, look.x - c.x), t,
        );
        break;
      }
      case 'chameleon': {
        const look = e.tongueTarget?.getWorldCenter() ?? aim;
        const inward = e.side === 1 ? 1 : -1;
        const wall = e.side === 1 ? COURT.leftWall.x + COURT.leftWall.hw : COURT.rightWall.x - COURT.rightWall.hw;
        drawChameleonArt(ctx, e.side === 1 ? 1 : -1, Math.atan2(look.y - c.y, look.x - c.x), t,
          e.phase !== 'crawl', { wallX: (wall - pose.x) * inward, travelPx: pose.y - PRIZE_BUTTONS[e.side - 1].y });
        break;
      }
    }
    ctx.restore();

    if (e.variant.id === 'spring' && e.lastBounce) {
      const hit = e.lastBounce, since = t - hit.age;
      if (since >= 0 && since < 9) {
        ctx.save(); ctx.translate(hit.xPx, hit.yPx); ctx.rotate(Math.atan2(hit.ny, hit.nx));
        ctx.globalAlpha = (1 - since / 9) * 0.8; ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          ctx.strokeStyle = i === 0 && hit.power > 0.65 ? COMIC.ochre : COMIC.paper;
          ctx.lineWidth = 1 + hit.power;
          ctx.beginPath(); ctx.moveTo(3 + since, i * 5);
          ctx.lineTo(9 + since * (1.5 + hit.power), i * (8 + since)); ctx.stroke();
        }
        ctx.restore();
      }
    }

    // A ring where each blow lands, sized by how hard it was.
    const hit = e.lastImpact;
    if (hit) {
      const since = t - hit.age;
      const rgb = IMPACT_RGB[e.variant.id];
      ring(ctx, hit.xPx, hit.yPx, since, 12, 5, 16 + 34 * hit.power, 2 + 4 * hit.power, rgb);
      ring(ctx, hit.xPx, hit.yPx, since - 2, 10, 3, 10 + 18 * hit.power, 1.5, '255,255,255');
    }
  }

  /**
   * A horseshoe magnet, poles toward its player. Field arcs run in from the
   * poles while its pull is on, faster and brighter the stronger it is.
   */
  private drawMagnetArt(ctx: CanvasRenderingContext2D, facing: number, field: number, latched: boolean, t: number): void {
    ctx.save(); ctx.rotate(facing);
    if (field > 0) for (let i = 0; i < 3; i++) {
      const p = (t * (0.03 + 0.04 * field) + i / 3) % 1;
      const radius = 22 + (1 - p) * (24 + 40 * field);
      ctx.globalAlpha = (0.2 + 0.6 * field) * Math.sin(p * Math.PI);
      ctx.strokeStyle = COMIC.mint; ctx.lineWidth = 1.3; ctx.setLineDash([5, 3]);
      ctx.beginPath(); ctx.arc(0, 0, radius, -0.75, 0.75); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    if (latched) { burstPath(ctx, 14, 0, 22 + Math.sin(t * 0.5) * 2, 8); ctx.strokeStyle = COMIC.ochre; ctx.lineWidth = 1; ctx.stroke(); }
    drawHorrorProp(ctx, 'magnet', -2, 0, 52, 52); ctx.restore();
  }

  private drawCometArt(ctx: CanvasRenderingContext2D, facing: number, heading: number, speed: number, dashing: boolean, t: number): void {
    ctx.save(); ctx.rotate(heading);
    if (speed > 2) for (let i = 0; i < 3; i++) {
      const shift = (t * 2 + i * 7) % 12; ctx.strokeStyle = dashing ? COMIC.ochre : COMIC.paper; ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-25 - shift, -7 + i * 7); ctx.lineTo(-34 - shift - Math.min(speed, 15), -5 + i * 7); ctx.stroke();
    }
    ctx.restore();
    ctx.save(); ctx.rotate(facing);
    drawHorrorProp(ctx, 'fire-skull', 0, 0, 61, 48); ctx.restore();
  }

  private drawSpringArt(ctx: CanvasRenderingContext2D, facing: number, stretch: number, power = 0, t = 0, bend = 0): void {
    const half = 15 * stretch, width = 10 / Math.sqrt(stretch);
    ctx.save(); ctx.rotate(facing + Math.PI / 2); ctx.lineCap = 'round';
    // Printed speed scratches grow with the same energy that powers the hit.
    if (power > 0.25) for (let i = -1; i <= 1; i++) {
      const offset = (t * 2 + i * 5 + 20) % 13;
      ctx.globalAlpha = power * 0.75; ctx.strokeStyle = i === 0 ? COMIC.ochre : COMIC.paper;
      ctx.lineWidth = 0.8 + power;
      ctx.beginPath(); ctx.moveTo(i * 12, half + 8 + offset);
      ctx.lineTo(i * 15 + bend * 0.4, half + 12 + offset + power * 29); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Separate overlapping loops give the coil depth. A bowed centre line
    // and independent jaw hinges keep the bone cutouts supple in flight.
    for (let turn = 0; turn < 5; turn++) {
      const p = (turn + 0.5) / 5, y = -half + 5 + p * (half * 2 - 10);
      const bow = Math.sin(p * Math.PI) * bend;
      ctx.save(); ctx.translate(bow, y); ctx.rotate(bend * (p - 0.5) * 0.035);
      for (const [lineWidth, color] of [[4.2, COMIC.ink], [2.5, power > 0.72 ? COMIC.ochre : COMIC.plum], [0.7, COMIC.muted]] as const) {
        ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
        ctx.beginPath(); ctx.ellipse(0, 0, width, Math.max(1.4, stretch * 3), -0.18, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save(); ctx.translate(0, half + 3); ctx.rotate(-bend * 0.035);
    drawHorrorProp(ctx, 'jaw-base', 0, 0, 37 / Math.sqrt(stretch), 19); ctx.restore();
    ctx.save(); ctx.translate(0, -half); ctx.rotate(bend * 0.045);
    drawHorrorProp(ctx, 'jaw-cap', 0, 0, 37 / Math.sqrt(stretch), 19); ctx.restore();
    ctx.restore();
  }

  private drawSlimeArt(ctx: CanvasRenderingContext2D, heading: number, speed: number, splat: number | null, gaze: number, t: number): void {
    const stuck = splat !== null; ctx.save(); ctx.scale(Math.cos(gaze) >= 0 ? 1 : -1, 1);
    ctx.rotate(stuck ? Math.sin(splat) * 0.06 : Math.sin(heading) * speed * 0.12);
    ctx.fillStyle = COMIC.mint; ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(6, 17, stuck ? 24 : 15, 3 + Math.sin(t * 0.24) * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawHorrorProp(ctx, 'ectoplasm', 0, -1, 48, 46); ctx.restore();
  }

  private drawSlimeGlue(ctx: CanvasRenderingContext2D, e: Executer, interp: PoseSource, alpha: number, t: number): void {
    const at = (b: Body, local: Vec2Value) => {
      const p = interp.pose(b, alpha);
      const lx = toPx(local.x);
      const ly = toPx(local.y);
      return { x: p.x + Math.cos(p.a) * lx - Math.sin(p.a) * ly, y: p.y + Math.sin(p.a) * lx + Math.cos(p.a) * ly };
    };
    ctx.save();
    ctx.lineCap = 'round';
    if (e.host) {
      const a = at(e.host, e.hostAnchor);
      for (const bond of e.bonds) {
        const b = at(bond.part, bond.local);
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.strokeStyle = `rgba(${SLIME_RGB},0.8)`;
        ctx.lineWidth = Math.max(2.5, 12 - len * 0.4);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.fillStyle = `rgba(${SLIME_RGB},0.72)`;
        ctx.beginPath();
        ctx.arc(b.x, b.y, 6.5 + 0.8 * Math.sin(t * 0.3 + bond.age), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(30,92,26,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (e.reelPart) {
        const q = interp.pose(e.reelPart, alpha);
        const sag = 6 + 3 * Math.sin(t * 0.4);
        ctx.strokeStyle = `rgba(${SLIME_RGB},0.75)`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo((a.x + q.x) / 2, (a.y + q.y) / 2 + sag, q.x, q.y);
        ctx.stroke();
      }
    }
    // A torn strand: each end snaps back toward its part, flinging drops.
    const s = e.lastSnap;
    const since = s ? t - s.age : -1;
    if (s && since >= 0 && since < 10) {
      const p = since / 10;
      const mx = (s.ax + s.bx) / 2;
      const my = (s.ay + s.by) / 2;
      const back = 0.5 * easeOutCubic(p);
      ctx.strokeStyle = `rgba(${SLIME_RGB},${0.85 * (1 - p)})`;
      ctx.lineWidth = 3 * (1 - p) + 1;
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(mx + (s.ax - mx) * back, my + (s.ay - my) * back);
      ctx.moveTo(s.bx, s.by);
      ctx.lineTo(mx + (s.bx - mx) * back, my + (s.by - my) * back);
      ctx.stroke();
      ctx.fillStyle = `rgba(${SLIME_RGB},${0.9 * (1 - p)})`;
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + s.age;
        ctx.beginPath();
        ctx.arc(mx + Math.cos(a) * 14 * p, my + Math.sin(a) * 10 * p + 12 * p * p, 2.2 * (1 - p) + 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Aim the active fist directly at the head, even above or below the boxer. */
  private drawBoxer(ctx: CanvasRenderingContext2D, e: Executer, c: Pose, p: Pose): void {
    const facing = p.x >= c.x ? 1 : -1;
    // In the flipped frame the target is always ahead; aim the arms at it.
    const aim = Math.atan2(p.y - c.y, Math.abs(p.x - c.x));
    const frame = e.punchFrame;
    const reach = frame < 0 ? 0 : frame <= BOXER.impactFrame
      ? frame / BOXER.impactFrame
      : Math.max(0, 1 - (frame - BOXER.impactFrame) / 8);
    const active = (e.hits + (frame >= BOXER.impactFrame ? 1 : 0)) % 2;
    this.drawBoxerArt(ctx, facing, aim, reach, active, Math.max(18, Math.hypot(p.x - c.x, p.y - c.y) - 5));
  }

  private drawBoxerArt(ctx: CanvasRenderingContext2D, facing: number, aim: number, reach: number, active: number,
    impactDistance: number = BOXER.armRestPx + BOXER.armExtensionPx): void {
    ctx.save(); ctx.scale(facing, 1); ctx.save(); ctx.rotate(aim); ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const y = i === 0 ? -9 : 9, extension = i === active ? reach * (impactDistance - BOXER.armRestPx) : 0;
      const fistY = (y - (i === 0 ? -2 : 2)) * (i === active ? 1 - reach : 1);
      for (const [width, color] of [[6, COMIC.ink], [3.5, COMIC.paper]] as const) {
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(8, y);
        ctx.lineTo(21, y + (i === 0 ? -3 : 3)); ctx.lineTo(BOXER.armRestPx - 1 + extension, fistY); ctx.stroke();
      }
      drawHorrorProp(ctx, 'fist', BOXER.armRestPx + extension, fistY, 15, 13);
    }
    ctx.restore(); drawHorrorProp(ctx, 'voodoo', 0, 0, 36, 46); ctx.restore();
  }

  private drawExecuterIcon(ctx: CanvasRenderingContext2D, id: ExecuterId, size: number): void {
    const k = size / (EXECUTER.radiusPx * 2.6);
    ctx.save();
    ctx.scale(k, k);
    switch (id) {
      case 'magnet': this.drawMagnetArt(ctx, Math.PI / 2, 0, false, 0); break;
      case 'boxer': this.drawBoxerArt(ctx, 1, 0, 0.8, 0); break;
      case 'comet':
        ctx.translate(-8, 5);
        this.drawCometArt(ctx, 0.4, -2.75, 7, false, 4);
        break;
      case 'spring': this.drawSpringArt(ctx, -Math.PI / 2, 1); break;
      case 'slime': this.drawSlimeArt(ctx, 0, 0, null, 0.4, 20); break;
      case 'chameleon': ctx.scale(0.7, 0.7); drawChameleonArt(ctx, 1, 0.4, 0); break;
    }
    ctx.restore();
  }

  /** Gravestone artwork follows the original wall buttons' press, flash and lifetime. */
  private drawPrizeButtons(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number): void {
    const skins = this.graveSkinsFor(gw);
    for (const b of gw.ground.prizeButtons) {
      const d = b.def, live = !b.armed, depth = buttonDepth(b, now);
      const life = Math.max(0, ...b.executers.filter(e => !e.dead).map(e => e.lifeFraction));
      const flash = Math.max(flashCurve(now - b.pressedAt, 6, 1), flashCurve(now - b.releasedAt, 6, 0.5));
      ctx.save();
      ctx.translate(d.x - b.inward * depth, d.y + d.hh);
      ctx.scale(b.inward, 1);
      drawGraveArt(ctx, skins[b.side], d.hh * 2, { active: live, life, flash });
      ctx.restore();
      ring(ctx, d.x + b.inward * d.hw, d.y, now - b.pressedAt, 14, 8, 95, 2.5, PAL.prizeLiveGlow);
      ring(ctx, d.x + b.inward * d.hw, d.y, now - b.releasedAt, 10, 6, 45, 1.5, PAL.prizeGlow);
    }
  }

  private drawOffscreenPlayers(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    for (const p of [gw.p1, gw.p2]) {
      const pose = interp.pose(p.head, alpha);
      const { x: sx, y: sy } = this.toStage(pose.x, pose.y);
      if (sy > -6) continue;
      ctx.fillStyle = PAL.jersey[p.id];
      ctx.beginPath();
      ctx.moveTo(sx, 2);
      ctx.lineTo(sx - 7, 14);
      ctx.lineTo(sx + 7, 14);
      ctx.closePath();
      ctx.fill();
      ctx.font = '800 8px ' + COMIC_TEXT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`P${p.id} ${(-sy / VIEW.scale / 30).toFixed(1)} m`, sx, 16);
    }
  }

  /** A printed queue caption; HTML icon controls occupy the quiet row below. */
  private drawTopBar(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number): number {
    const x = HUD_BAR.midX, y = 8, w = 176, h = 18;
    ctx.save(); comicPanel(ctx, x - w / 2, y, w, h);
    ctx.strokeStyle = COMIC.ink; ctx.lineWidth = 0.65; ctx.setLineDash([1.5, 2]);
    ctx.beginPath(); ctx.moveTo(x + 40, y + 3); ctx.lineTo(x + 40, y + h - 3); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = 'bold 7px ' + COMIC_TEXT; ctx.fillStyle = COMIC.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TO ' + OPTIONS.gameSet, x + 64, y + h / 2);
    if (gw.hazards) this.drawNextHazard(ctx, gw, x - w / 2 + 8, y + h / 2, now);
    else { ctx.textAlign = 'left'; ctx.fillText('TRAPS OFF', x - w / 2 + 10, y + h / 2); }
    ctx.restore(); return HUD_BAR.y + HUD_BAR.h;
  }

  private drawNextHazard(ctx: CanvasRenderingContext2D, gw: GameWorld, x: number, y: number, now: number): void {
    const [next] = gw.executerQueue.peek(1); if (!next) return;
    const since = now - gw.executerLaunchEffect.frame;
    const p = since >= 0 && since < 10 ? easeOutCubic(since / 10) : 1;
    ctx.save(); ctx.translate(x + 6, y); ctx.globalAlpha = 0.65 + 0.35 * p; ctx.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
    this.drawExecuterIcon(ctx, next.id, 14); ctx.restore();
    ctx.fillStyle = COMIC.ink; ctx.font = 'bold 7px ' + COMIC_TEXT; ctx.textAlign = 'left';
    ctx.fillText('NEXT: ' + HORROR_HAZARD_LABELS[next.id], x + 18, y);
  }

  private drawOffscreenBall(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const pose = interp.pose(gw.ball.body, alpha);
    const { x: sx, y: sy } = this.toStage(pose.x, pose.y);
    const scale = VIEW.scale;
    if (sy > -gw.ball.radiusPx * scale) return;
    const heightM = (-sy / scale / 30).toFixed(1);
    const tint = this.currentBallTint(gw, gw.frame - 1 + alpha);
    ctx.fillStyle = tint ? `rgba(${tint.rgb},${Math.min(0.9, 0.55 + tint.alpha)})` : 'rgba(20,30,40,0.55)';
    ctx.beginPath();
    ctx.moveTo(sx, 3);
    ctx.lineTo(sx - 6, 13);
    ctx.lineTo(sx + 6, 13);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 8px ' + COMIC_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`${heightM} m`, sx, 15);
  }

  private drawHud(ctx: CanvasRenderingContext2D, gw: GameWorld, hud: HudState, now: number): void {
    const g = gw.game;
    ctx.save();
    for (const id of [1, 2] as const) {
      const player = id === 1 ? gw.p1 : gw.p2;
      const x = id === 1 ? HUD_LEFT_X : HUD_RIGHT_X;
      const dir = id === 1 ? 1 : -1;
      const ink = id === 1 ? COMIC.ochre : COMIC.mint;
      ctx.textAlign = id === 1 ? 'left' : 'right'; ctx.textBaseline = 'top';
      ctx.save(); ctx.globalAlpha = 0.18;
      comicPanel(ctx, id === 1 ? x - 12 : x - 57, 8, 69, 60, COMIC.night);
      ctx.restore();
      ctx.fillStyle = ink; ctx.fillRect(id === 1 ? x - 8 : x + 6, 13, 2, 49);
      const level = gw.levelOf(id);
      const label = gw.isCpu(id) ? 'CPU · ' + level : hud.singlePlayer ? 'YOU' : 'P' + id;
      ctx.font = '600 7px ' + COMIC_TEXT; ctx.fillStyle = COMIC.paper; ctx.fillText(label, x, 13);
      ctx.font = '28px ' + COMIC_TITLE; ctx.fillStyle = ink; ctx.fillText(String(g.score[id]), x, 24);
      for (let i = 0; i < MAX_TOUCHES; i++) {
        const on = i < Math.min(player.contact, MAX_TOUCHES);
        ctx.fillStyle = on ? player.contact >= MAX_TOUCHES ? COMIC.rust : ink : 'rgba(235,220,181,0.25)';
        ctx.beginPath(); ctx.arc(x + dir * (3 + i * 8), 60, 2.1, 0, Math.PI * 2); ctx.fill();
      }
      const status = (label: string, fraction: number, color: string, y: number) => {
        const cx = x + dir * 6;
        ctx.strokeStyle = 'rgba(148,170,188,0.25)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, y + 5, 5.5, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
        ctx.strokeStyle = color; ctx.beginPath();
        ctx.arc(cx, y + 5, 5.5, -Math.PI / 2, -Math.PI / 2 + clamp01(fraction) * Math.PI * 2); ctx.stroke();
        ctx.fillStyle = COMIC.paper; ctx.font = '600 6px ' + COMIC_TEXT; ctx.fillText(label, x + dir * 16, y + 1);
      };
      let y = 71;
      if (player.injured) {
        ctx.fillStyle = COMIC.rust; ctx.font = '600 6px ' + COMIC_TEXT;
        ctx.fillText('INJURED · ' + player.detachedBodies.length + ' PARTS LOST', x, y);
        y += 14;
      }
      const live = gw.executers.filter(e => !e.dead && e.target.id === id);
      if (live.length) {
        const remaining = Math.max(...live.map(e => e.secondsLeft));
        const label = live.length > 1 ? live.length + ' HAZARDS' : HORROR_HAZARD_LABELS[live[0].variant.id];
        status(label + ' · ' + remaining + 's', Math.max(...live.map(e => e.lifeFraction)), COMIC.ochre, y); y += 14;
      }
      const power = gw.powerUps.active[id];
      if (power) {
        const remaining = Math.max(0, power.expiresAt - gw.frame);
        status(POWER_LABELS[power.kind] + ' · ' + Math.ceil(remaining / FPS) + 's', remaining / (power.expiresAt - power.startedAt), ink, y); y += 14;
      }
      const cooldown = gw.swingCooldownFramesLeft(id);
      if (cooldown > 0) status('FLIP / DIVE · ' + Math.ceil(cooldown / FPS) + 's', 0, COMIC.muted, y);
    }
    const top = this.drawTopBar(ctx, gw, now);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (g.phase === 'play' && gw.ball.ballOfPlayer !== 0) {
      const secs = g.serveSecondsLeft;
      ctx.fillStyle = secs <= 2 ? COMIC.ochre : COMIC.paper; ctx.font = '600 8px ' + COMIC_TEXT;
      const holder = gw.ball.ballOfPlayer;
      const who = hud.singlePlayer ? holder === 1 ? 'YOUR SERVE' : 'CPU SERVE' : 'P' + holder + ' SERVE';
      ctx.fillText(who + ' · ' + secs, HUD_BAR.midX, top + 6);
    }
    if (hud.message) this.drawBanner(ctx, hud.message, hud.messageTone, HUD_BAR.midX, 104);
    ctx.restore();
  }

  /**
   * A printed panel across the court: the headline, and under
   * it the reason after a " · " if there is one.
   */
  private drawBanner(ctx: CanvasRenderingContext2D, text: string, tone: 0 | 1 | 2, x: number, y: number): void {
    const [title, detail] = text.split(' · ');
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '19px ' + COMIC_TITLE;
    let w = ctx.measureText(title).width;
    if (detail) { ctx.font = 'bold 8px ' + COMIC_TEXT; w = Math.max(w, ctx.measureText(detail).width); }
    w += 36; const h = detail ? 39 : 28;
    comicPanel(ctx, x - w / 2, y - h / 2, w, h);
    ctx.fillStyle = tone === 1 ? COMIC.ochre : tone === 2 ? COMIC.mint : COMIC.plum;
    ctx.fillRect(x - w / 2 + 4, y - h / 2 + 4, 2, h - 8);
    ctx.fillStyle = COMIC.ink; ctx.font = '19px ' + COMIC_TITLE; ctx.fillText(title, x, detail ? y - 5 : y + 1);
    if (detail) { ctx.font = 'bold 8px ' + COMIC_TEXT; ctx.fillText(detail, x, y + 12); }
    ctx.restore();
  }

}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Each hazard's impact ring colour. */
const IMPACT_RGB: Record<ExecuterId, string> = {
  magnet: '159,198,173', boxer: '218,176,92', comet: '197,106,81', spring: '121,80,134', slime: '159,198,173',
  chameleon: '197,106,81',
};

/** The slime's goo. */
const SLIME_RGB = '159,198,173';

/**
 * Every bounce compresses the coil, then releases a damped elastic wobble.
 * In flight it stretches with momentum and the distance stored in the coil.
 */
function springStretch(e: Executer, t: number): number {
  const flight = 1 + 0.2 * clamp01(e.body.getLinearVelocity().length() / SPRING.topSpeed) + 0.16 * e.slamPower;
  const hit = e.lastBounce;
  if (!hit) return flight;
  const since = Math.max(0, t - hit.age);
  return Math.max(0.48, flight - (0.48 + 0.3 * hit.power) * Math.cos(since * 0.6) * Math.exp(-since * 0.16));
}
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
/** Overshoots past 1 before settling — the spring when a button pops out. */
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

/** How far a button's face is sunk into the wall right now, world px. */
function buttonDepth(b: PrizeButton, now: number): number {
  const D = PRIZE_ANIM.pressDepthPx;
  if (!b.armed) return D * easeOutCubic(clamp01((now - b.pressedAt) / PRIZE_ANIM.pressFrames));
  const since = now - b.releasedAt;
  if (since >= 0 && since < PRIZE_ANIM.releaseFrames) {
    return D * (1 - easeOutBack(clamp01(since / PRIZE_ANIM.releaseFrames)));
  }
  return 0;
}

/** 0..peak, falling linearly to 0 over `frames` after an event. */
function flashCurve(since: number, frames: number, peak: number): number {
  return since >= 0 && since < frames ? peak * (1 - since / frames) : 0;
}

/** An expanding, fading ring `since` frames after an event. */
function ring(
  ctx: CanvasRenderingContext2D, x: number, y: number, since: number,
  frames: number, r0: number, r1: number, width: number, rgb: string,
): void {
  if (!(since >= 0 && since < frames)) return;
  const p = since / frames;
  ctx.strokeStyle = `rgba(${rgb},${0.75 * (1 - p)})`;
  ctx.lineWidth = width * (1 - p) + 0.8;
  ctx.beginPath();
  burstPath(ctx, x, y, r0 + (r1 - r0) * easeOutCubic(p));
  ctx.stroke();
}


export const worldToStage = (xPx: number, yPx: number) => ({
  x: xPx * VIEW.scale + STAGE.offsetX,
  y: yPx * VIEW.scale + STAGE.offsetY,
});

export { toPx };
