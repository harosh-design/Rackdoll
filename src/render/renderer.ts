import {
  BALL, BALL_TINT, BOXER, CHARGE, COURT, FLIP, EXECUTER, FLOOR_TOP_PX, FPS, MAX_TOUCHES, OPTIONS, PARTS, PRIZE_ANIM,
  PRIZE_BUTTONS, SLIME, SPRING, STUN, SWING, VIEW, NET_SPIKE, toPx, type PartName,
} from '../sim/constants';
import type { Body, Vec2Value } from 'planck';
import type { Executer } from '../sim/executer';
import { type ExecuterId } from '../sim/executerVariants';
import type { GameWorld } from '../sim/world';
import type { PrizeButton } from '../sim/prizeButton';
import { POWER_LABELS } from '../sim/powerUps';
import { drawDronePops, drawDrones } from './drones';
import { drawArenaSprite } from './arenaArt';
import { STAGE } from './stageLayout';
import type { ArenaScene } from './arenaBackground';
import { SOLE_Y } from './dollArt';
import { closedPoses, type PoseSource } from './dollPose';
import type { Interpolator, Pose } from './interp';
import { ShaderScene } from './shaderScene';
import { AmbientBackdrop } from './ambientBackdrop';
import { drawResortBackground, loadResortArt } from './resortArt';
import { drawHumanPlayers } from './humanPlayers';
import { AIR_HEATER, RUBBER_NET, SHARP_SPIKE } from '../sim/centerObstacle';

export type VisualStyle = 'people' | 'shaders';

/**
 * Canvas renderer. A 640x400 stage frames the original world at scale 0.56.
 * STAGE centres the arena and leaves a shallow foreground beneath the court.
 * Both the textured people arena and flowing glass/chrome shader arena use
 * the same interpolated ragdoll poses; simulation geometry remains independent.
 */

const PAL = {
  skyTop: '#6fb7e0',
  skyBottom: '#cfeaf6',
  sea: '#3f93bf',
  seaFoam: '#8ccbe6',
  sand: '#ecd49b',
  sandDark: '#d6b877',
  sandLine: '#c9a863',
  wall: '#56616b',
  wallEdge: '#3d464e',
  netPole: '#2b3137',
  netMesh: 'rgba(255,255,255,0.55)',
  netTape: '#fbfbf7',
  skin: '#f1c7a0',
  skinShade: '#d8a57a',
  hair: { 1: '#4a3222', 2: '#2d2320' },
  jersey: { 1: '#84dcff', 2: '#e3cfb0' },
  jerseyShade: { 1: '#1f4fa8', 2: '#a92d25' },
  /** Material accent of the last player to touch the ball. */
  ballTintRgb: { 0: [251, 251, 246], 1: [121, 218, 255], 2: [232, 211, 176] },
  shorts: { 1: '#1d3a7d', 2: '#7b1f1a' },
  shoe: '#f4f4f0',
  ball: '#fbfbf6',
  ballPanelA: '#f2b705',
  ballPanelB: '#2f6fde',
  executer: '#34353d',
  executerSpike: '#a7adb5',
  prize: '#ffcf33',
  prizeEdge: '#c99a12',
  prizeGlow: '255,207,51',
  prizeLive: '#ff4d2e',
  prizeLiveEdge: '#b3301a',
  prizeLiveGlow: '255,77,46',
  prizeCore: '#ffe2d9',
  housing: '#262c31',
  housingRim: 'rgba(255,255,255,0.12)',
  /** The sky the resort photograph fades into above its top edge. */
  resortSky: '#03091c',
} as const;

const partDef = (name: PartName) => PARTS.find((p) => p.name === name)!;
const footHalfHeight = ((s) => (s.kind === 'box' ? s.hh : s.r))(partDef('FootLeft').shape);

/** Where a standing doll's drawn soles are: the feet hang below the shin colliders. */
const SOLES_PX = FLOOR_TOP_PX + SOLE_Y - footHalfHeight;

/**
 * HUD columns, stage px: the scores sit over the court, clear of the prize
 * buttons at the top of each wall (stage x ~25 and ~612), which glow ~30 px
 * around.
 */
const HUD_LEFT_X = 48;
const HUD_RIGHT_X = VIEW.stageW - HUD_LEFT_X;

/**
 * The top bar, stage px, centred over the court. The page puts its own
 * controls (pause, sound, fullscreen) in the middle `controlsW`; the next
 * hazard is drawn to their left and the target score to their right.
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
  /** Device pixels per stage pixel. */
  private k = 1;
  private scenerySeconds = 0;
  private sceneryAt: number | null = null;
  private readonly shaders = new ShaderScene();
  private visualStyle: VisualStyle = 'people';
  private arenaScene: ArenaScene = 'indoor';
  private readonly backdrop: AmbientBackdrop | null;
  readonly ready: Promise<void>;

  constructor(canvas: HTMLCanvasElement, backdrop?: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.backdrop = backdrop ? new AmbientBackdrop(backdrop) : null;
    this.resize();
    this.ready = loadResortArt();
  }

  /** Switch scenery and players together without touching the live simulation. */
  setVisualStyle(style: VisualStyle): void {
    this.visualStyle = style;
  }

  /** Changing the location preserves the current match and player materials. */
  setArenaScene(scene: ArenaScene): void {
    this.arenaScene = scene;
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
  // Court: sky, scenery, sea, sand, walls, net. Everything that holds still,
  // drawn at the fixed arena scale each frame.
  // -------------------------------------------------------------------------

  private paintCourt(ctx: CanvasRenderingContext2D): void {
    const floor = this.toStage(0, SOLES_PX).y / VIEW.stageH;
    if (this.visualStyle === 'shaders' && this.arenaScene === 'indoor') {
      this.backdrop?.draw(this.scenerySeconds, floor);
      this.shaders.drawBackground(ctx, this.scenerySeconds, floor);
    } else {
      this.paintPeopleCourt(ctx);
      return;
    }
    this.worldSpace(ctx);
    const g = COURT.ground;
    ctx.save();
    ctx.shadowColor = '#84dcff'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#c4efff';
    ctx.fillRect(g.x - g.hw, SOLES_PX, g.hw * 2, 1.3);
    ctx.restore();
    for (const w of [COURT.leftWall, COURT.rightWall]) {
      const left = w === COURT.leftWall;
      const inner = left ? w.x + w.hw : w.x - w.hw;
      const x = left ? inner - 45 : inner;
      const wall = ctx.createLinearGradient(x, 0, x + 45, 0);
      wall.addColorStop(0, left ? '#1b2c3d' : '#8bb4c9');
      wall.addColorStop(1, left ? '#8bb4c9' : '#1b2c3d');
      ctx.fillStyle = wall; ctx.fillRect(left ? inner - 4000 : inner, -4000, 4000, 4500);
      ctx.save(); ctx.shadowColor = '#81e0ff'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#cbf5ff'; ctx.fillRect(left ? inner - 2 : inner, -4000, 2, 4500);
      ctx.restore();
    }
    for (const p of PRIZE_BUTTONS) {
      const inward = p.side === 1 ? 1 : -1;
      const wallFace = p.x - inward * (p.hw + 1);
      const depth = PRIZE_ANIM.pressDepthPx + 3;
      ctx.fillStyle = PAL.housing;
      roundRect(ctx, inward === 1 ? wallFace - depth : wallFace, p.y - p.hh - 4, depth, p.hh * 2 + 8, 2);
      ctx.fill();
    }
  }

  private paintPeopleCourt(ctx: CanvasRenderingContext2D): void {
    this.backdrop?.drawPeople();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#111a2b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.stageSpace(ctx);
    ctx.save();
    drawResortBackground(ctx, VIEW.stageW, VIEW.stageH, this.scenerySeconds, undefined, this.arenaScene);
    ctx.restore();
    this.worldSpace(ctx);
    const ground = COURT.ground;
    const floor = ctx.createLinearGradient(0, SOLES_PX, 0, SOLES_PX + 80);
    const floorColors = this.arenaScene === 'beach' ? ['#666552', '#343d48']
      : this.arenaScene === 'rooftop' ? ['#9b7464', '#3d3941'] : ['#283344', '#111827'];
    floor.addColorStop(0, floorColors[0]); floor.addColorStop(1, floorColors[1]);
    ctx.fillStyle = floor;
    ctx.fillRect(ground.x - ground.hw, SOLES_PX, ground.hw * 2, 4000);
    ctx.fillStyle = '#9fc8ca';
    ctx.fillRect(ground.x - ground.hw, SOLES_PX, ground.hw * 2, 1.3);
    for (const wall of [COURT.leftWall, COURT.rightWall]) {
      const left = wall === COURT.leftWall;
      const inner = left ? wall.x + wall.hw : wall.x - wall.hw;
      const x = left ? inner - 45 : inner;
      const fill = ctx.createLinearGradient(x, 0, x + 45, 0);
      fill.addColorStop(0, left ? '#253344' : '#94b1bc');
      fill.addColorStop(1, left ? '#94b1bc' : '#253344');
      ctx.fillStyle = fill;
      ctx.fillRect(left ? inner - 4000 : inner, -4000, 4000, 4500);
      ctx.fillStyle = '#c6e8ec';
      ctx.fillRect(left ? inner - 2 : inner, -4000, 2, 4500);
    }
    for (const button of PRIZE_BUTTONS) {
      const inward = button.side === 1 ? 1 : -1;
      const wallFace = button.x - inward * (button.hw + 1);
      const depth = PRIZE_ANIM.pressDepthPx + 3;
      ctx.fillStyle = PAL.housing;
      roundRect(ctx, inward === 1 ? wallFace - depth : wallFace, button.y - button.hh - 4, depth, button.hh * 2 + 8, 2);
      ctx.fill();
    }
  }

  /** Draw the selected geometry in both graphics styles, including physical bending. */
  private drawCenterObstacle(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const obstacle = gw.centerObstacle;
    const x = COURT.net.x, top = COURT.net.y - COURT.net.hh;
    ctx.save();
    ctx.fillStyle = this.visualStyle === 'shaders' ? '#c2e8ff' : '#d7e4e6';
    if (obstacle.id === 'classic') {
      ctx.fillRect(x - 1.2, top, 2.4, SOLES_PX - top);
      this.drawNetSpike(ctx, x, top);
    } else if (obstacle.id === 'sharp') {
      const metal = ctx.createLinearGradient(x - SHARP_SPIKE.halfWidthPx, 0, x + SHARP_SPIKE.halfWidthPx, 0);
      metal.addColorStop(0, '#66808c'); metal.addColorStop(0.5, '#f5e6c9'); metal.addColorStop(1, '#758995');
      ctx.fillStyle = metal;
      ctx.beginPath(); ctx.moveTo(x - SHARP_SPIKE.halfWidthPx, FLOOR_TOP_PX);
      ctx.lineTo(x, SHARP_SPIKE.topPx); ctx.lineTo(x + SHARP_SPIKE.halfWidthPx, FLOOR_TOP_PX);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#ffe0a9'; ctx.lineWidth = 0.8; ctx.stroke();
    } else if (obstacle.id === 'blower') {
      const radius = AIR_HEATER.rangePx + AIR_HEATER.halfWidthPx;
      const air = ctx.createLinearGradient(x - radius, 0, x + radius, 0);
      air.addColorStop(0, 'rgba(100,218,255,0)'); air.addColorStop(0.5, 'rgba(100,218,255,0.17)');
      air.addColorStop(1, 'rgba(100,218,255,0)');
      ctx.fillStyle = air;
      roundRect(ctx, x - radius, top - radius, radius * 2, FLOOR_TOP_PX - top + radius * 2, radius);
      ctx.fill();
      ctx.strokeStyle = 'rgba(164,238,255,0.6)'; ctx.lineWidth = 1.2;
      for (const side of [-1, 1]) for (let i = 0; i < 7; i++) {
        const travel = ((this.scenerySeconds * 22 + i * 9) % AIR_HEATER.rangePx);
        const ax = x + side * (AIR_HEATER.halfWidthPx + travel), y = top + 10 + i * 20;
        ctx.beginPath(); ctx.moveTo(ax - side * 5, y); ctx.lineTo(ax, y);
        ctx.lineTo(ax - side * 3, y - 2); ctx.moveTo(ax, y); ctx.lineTo(ax - side * 3, y + 2); ctx.stroke();
      }
      ctx.fillStyle = '#ecb67e';
      roundRect(ctx, x - AIR_HEATER.halfWidthPx, top, AIR_HEATER.halfWidthPx * 2, FLOOR_TOP_PX - top, 3);
      ctx.fill(); ctx.strokeStyle = '#694d44'; ctx.lineWidth = 1;
      for (let y = top + 10; y < FLOOR_TOP_PX - 4; y += 8) {
        ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y); ctx.stroke();
      }
    } else {
      const halfHeight = (RUBBER_NET.basePx - top) / RUBBER_NET.segments / 2;
      const points: Array<{ x: number; y: number }> = [{ x, y: RUBBER_NET.basePx }];
      for (const body of obstacle.bodies) {
        const pose = interp.pose(body, alpha);
        points.push({ x: pose.x + Math.sin(pose.a) * halfHeight, y: pose.y - Math.cos(pose.a) * halfHeight });
      }
      ctx.lineJoin = ctx.lineCap = 'round';
      for (const [width, color] of [[9, '#163c42'], [6, '#83dbc8']] as const) {
        ctx.lineWidth = width; ctx.strokeStyle = color;
        ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length - 1; i++) {
          ctx.quadraticCurveTo(points[i].x, points[i].y, (points[i].x + points[i + 1].x) / 2, (points[i].y + points[i + 1].y) / 2);
        }
        const tip = points[points.length - 1]; ctx.lineTo(tip.x, tip.y); ctx.stroke();
      }
      ctx.setLineDash([2, 5]); ctx.lineWidth = 2; ctx.strokeStyle = '#e6fff4'; ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#536573';
    roundRect(ctx, x - 9, FLOOR_TOP_PX, 18, SOLES_PX - FLOOR_TOP_PX + 3, 2); ctx.fill();
    ctx.restore();
  }

  private drawNetSpike(ctx: CanvasRenderingContext2D, x: number, top: number): void {
    ctx.beginPath();
    ctx.moveTo(x - NET_SPIKE.halfWidthPx, top);
    ctx.lineTo(x, top - NET_SPIKE.heightPx);
    ctx.lineTo(x + NET_SPIKE.halfWidthPx, top);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#f9d49a'; ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  draw(gw: GameWorld, frames: Interpolator, alpha: number, hud: HudState): void {
    const ctx = this.ctx;
    const sceneryAt = performance.now() / 1000;
    const sceneryDt = this.sceneryAt === null ? 0 : Math.min(0.1, Math.max(0, sceneryAt - this.sceneryAt));
    if (this.sceneryAt !== null && !hud.paused) {
      this.scenerySeconds += sceneryDt;
    }
    this.sceneryAt = sceneryAt;
    // Every doll joint drawn closed, and a held ball on its hand (dollPose.ts).
    const interp = closedPoses(frames, alpha, [gw.p1, gw.p2], gw.ball.body);
    this.paintCourt(ctx);

    this.drawShadows(gw, interp, alpha);

    this.worldSpace(ctx);
    this.drawCenterObstacle(ctx, gw, interp, alpha);
    // Animation clock in frames: the interpolated poses sit between the
    // previous frame and the latest, so this does too.
    const now = gw.frame - 1 + alpha;
    this.drawPrizeButtons(ctx, gw, now);
    this.drawFootMotion(ctx, gw, interp, now);
    if (this.visualStyle === 'shaders') {
      this.shaders.drawPlayers(ctx, [gw.p1, gw.p2], interp, alpha, this.scenerySeconds);
    } else {
      drawHumanPlayers(ctx, [gw.p1, gw.p2], interp, alpha);
    }
    this.drawPowerGlows(ctx, gw, interp, alpha);
    drawDrones(ctx, gw, now, alpha);
    this.drawBall(ctx, gw, interp, alpha);
    drawDronePops(ctx, gw, interp, alpha, now);
    this.drawSwingEffects(ctx, gw, interp, alpha);
    this.drawOpponentHitEffects(ctx, gw, interp, alpha);
    this.drawStunEffects(ctx, gw, interp, alpha);
    this.drawSpecialEffects(ctx, gw, interp, alpha);
    for (const e of gw.executers) if (!e.dead) this.drawExecuter(ctx, e, interp, alpha);
    this.drawChargeMeters(ctx, gw, interp, alpha);

    this.stageSpace(ctx);
    this.drawOffscreenBall(ctx, gw, interp, alpha);
    this.drawOffscreenPlayers(ctx, gw, interp, alpha);
    this.drawHud(ctx, gw, hud, now);
  }

  /** Soft sand contact shadows stay on the ground while the doll jumps or flips. */
  private drawShadows(gw: GameWorld, interp: PoseSource, alpha: number): void {
    const ctx = this.ctx;
    ctx.save();
    this.worldSpace(ctx);
    for (const p of [gw.p1, gw.p2]) {
      const hips = interp.pose(p.ass, alpha);
      const left = interp.pose(p.activePart('FootLeft'), alpha);
      const right = interp.pose(p.activePart('FootRight'), alpha);
      const lift = Math.max(0, FLOOR_TOP_PX - Math.max(left.y, right.y) - footHalfHeight * p.sizeScale);
      const radius = (24 + lift * 0.025) * p.sizeScale;
      const opacity = 0.3 / (1 + lift / 100);
      ctx.save();
      ctx.translate(hips.x, FLOOR_TOP_PX + (SOLE_Y - footHalfHeight) * p.sizeScale);
      ctx.scale(1, 0.22);
      const fade = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      fade.addColorStop(0, 'rgba(68,44,25,' + opacity + ')');
      fade.addColorStop(0.4, 'rgba(68,44,25,' + opacity * 0.7 + ')');
      fade.addColorStop(1, 'rgba(68,44,25,0)');
      ctx.fillStyle = fade;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.restore();
  }

  /** Small sand puffs make steps, take-offs, and landings readable. */
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

  /** A ring on a powered head, and the ability's name rising for 1.5 s on pickup. */
  private drawPowerGlows(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: PoseSource, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    for (const p of [gw.p1, gw.p2]) {
      const power = gw.powerUps.active[p.id];
      if (!power) continue;
      const head = interp.pose(p.head, alpha);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,216,67,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 18 * p.sizeScale + 2, 0, Math.PI * 2);
      ctx.stroke();
      const age = now - power.startedAt;
      if (age >= 0 && age < 1.5 * FPS) {
        const fade = Math.min(1, 2 - age / (0.75 * FPS));
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * fade})`;
        ctx.fillStyle = `rgba(120,55,0,${fade})`;
        const y = head.y - 30 * p.sizeScale - age * 0.8;
        ctx.strokeText(`${POWER_LABELS[power.kind]}!`, head.x, y);
        ctx.fillText(`${POWER_LABELS[power.kind]}!`, head.x, y);
      }
      ctx.restore();
    }
  }

  /**
   * A red bar, and a glow where the feet will sweep through, show the
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
          ctx.strokeStyle = `rgba(255,77,46,${0.15 + 0.35 * info.power * (1 - distance / CHARGE.attractRadiusPx)})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.arc(finger.x, finger.y, 9 + 9 * info.power, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,77,46,${0.35 + 0.5 * info.power})`;
      ctx.lineWidth = 2 + 2 * info.power;
      ctx.stroke();
      const w = 32;
      const h = 5;
      const x = pose.x - w / 2;
      const y = pose.y - 26;
      ctx.fillStyle = 'rgba(15,25,35,0.55)';
      roundRect(ctx, x, y, w, h, 2.5);
      ctx.fill();
      ctx.fillStyle = PAL.prizeLive;
      roundRect(ctx, x, y, Math.max(w * clamp01(info.power), 2), h, 2.5);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 0.8;
      roundRect(ctx, x, y, w, h, 2.5);
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
      ctx.fillStyle = '#ffe36d';
      ctx.strokeStyle = '#a06a14';
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
      roundRect(ctx, head.x - 16, y, 32, 3, 1.5);
      ctx.fill();
      ctx.fillStyle = '#ffe36d';
      roundRect(ctx, head.x - 16, y, 32 * p.stunFrames / STUN.frames, 3, 1.5);
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
      ctx.beginPath();
      ctx.arc(pose.x, pose.y, 18 + effect.power * 8 + age * 2.5, 0, Math.PI * 2);
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
        ctx.strokeStyle = `rgba(255,210,40,${fade})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, 22 + perfectAge * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = `rgba(120,55,0,${fade})`;
        ctx.font = 'bold 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
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
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, 24 + age * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(30,35,55,${fade})`;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
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
      this.ballArt(ctx, { x: pose.x - ux * back, y: pose.y - uy * back, a: pose.a }, tint);
    }
    ctx.globalAlpha = 1;
    this.ballArt(ctx, pose, tint);
  }

  /** A tapered comet wake follows the actual flight, including curved shots and bounces. */
  private drawBallTrail(ctx: CanvasRenderingContext2D, gw: GameWorld, pose: Pose, now: number, speed: number, r: number): void {
    let points = this.ballTrails.get(gw);
    if (!points) {
      points = [];
      this.ballTrails.set(gw, points);
    }
    const last = points[points.length - 1];
    // A held ball or a round reset must never draw a streak across the court.
    if (gw.ball.held || gw.ball.ballOfPlayer !== 0) {
      points.length = 0;
      return;
    }
    if (last && (now < last.frame || Math.hypot(pose.x - last.x, pose.y - last.y) > 180)) {
      points.length = 0;
    }
    while (points.length && now - points[0].frame >= BALL_TRAIL_FRAMES) points.shift();
    const strength = clamp01((speed - 1) / 12);
    const newest = points[points.length - 1];
    // Render calls at the same simulation time (including pause) leave history intact.
    if (!newest || now > newest.frame) points.push({ x: pose.x, y: pose.y, frame: now, strength });
    if (points.length > 64) points.splice(0, points.length - 64);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Broad blue bloom, a cyan body, and a narrow warm-white core.
    for (const layer of [
      { width: r * 2.6, rgb: '80,175,255', opacity: 0.08 },
      { width: r * 1.2, rgb: '130,225,255', opacity: 0.24 },
      { width: r * 0.32, rgb: '255,246,214', opacity: 0.8 },
    ]) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        const life = clamp01(1 - (now - (a.frame + b.frame) / 2) / BALL_TRAIL_FRAMES);
        const energy = (a.strength + b.strength) / 2;
        ctx.lineWidth = Math.max(0.3, layer.width * life * (0.4 + 0.6 * energy));
        ctx.strokeStyle = `rgba(${layer.rgb},${layer.opacity * life * life * energy})`;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Deterministic embers drift gently away from the wake as they fade.
    for (let i = 1; i < points.length; i++) {
      const p = points[i], previous = points[i - 1];
      if (Math.floor(p.frame * 2) === Math.floor(previous.frame * 2)) continue;
      const age = (now - p.frame) / BALL_TRAIL_FRAMES;
      const life = 1 - age;
      const phase = Math.floor(p.frame * 2) * 2.399;
      const x = p.x + Math.sin(phase) * age * 24;
      const y = p.y + Math.cos(phase) * age * 24;
      ctx.fillStyle = `rgba(255,230,165,${life * life * p.strength * 0.7})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.5 + life * 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (strength > 0) {
      const glow = ctx.createRadialGradient(pose.x, pose.y, r * 0.6, pose.x, pose.y, r * 2.6);
      glow.addColorStop(0, `rgba(180,235,255,${strength * 0.4})`);
      glow.addColorStop(0.45, `rgba(100,200,255,${strength * 0.16})`);
      glow.addColorStop(1, 'rgba(80,175,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(pose.x, pose.y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The jersey colour of whoever touched the ball last, blending in as it changes. */
  private currentBallTint(gw: GameWorld, now: number): { rgb: string; alpha: number } | null {
    const t = gw.ballTint;
    if (!t.player) return null;
    const k = clamp01((now - t.frame) / BALL_TINT.fadeInFrames);
    const colors = this.visualStyle === 'shaders' ? PAL.ballTintRgb
      : { 0: [251, 251, 246], 1: [47, 111, 222], 2: [226, 69, 59] };
    const from = colors[t.previous];
    const to = colors[t.player];
    const rgb = to.map((c, i) => Math.round(from[i] + (c - from[i]) * k)).join(',');
    // From the white ball the colour washes in; between players it shifts hue.
    const alpha = BALL_TINT.alpha * (t.previous ? 1 : k);
    return { rgb, alpha };
  }

  private ballArt(ctx: CanvasRenderingContext2D, pose: Pose, tint?: { rgb: string; alpha: number } | null): void {
    const r = BALL.radiusPx;
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    ctx.fillStyle = PAL.ball;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = PAL.ballPanelA;
    ctx.beginPath();
    ctx.arc(-r * 0.9, -r * 0.2, r * 1.05, -0.9, 0.9);
    ctx.stroke();
    ctx.strokeStyle = PAL.ballPanelB;
    ctx.beginPath();
    ctx.arc(r * 0.95, r * 0.35, r * 1.1, Math.PI - 0.8, Math.PI + 0.8);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, r * 1.3, r * 1.2, -Math.PI * 0.8, -Math.PI * 0.2);
    ctx.stroke();
     // The jersey colour of whoever touched it last.
     if (tint && tint.alpha > 0) {
       const wash = ctx.createRadialGradient(0, -r * 0.15, r * 0.2, 0, 0, r);
       wash.addColorStop(0, `rgba(${tint.rgb},${tint.alpha})`);
       wash.addColorStop(1, `rgba(${tint.rgb},${tint.alpha * 0.4})`);
       ctx.fillStyle = wash;
       ctx.beginPath();
       ctx.arc(0, 0, r, 0, Math.PI * 2);
       ctx.fill();
      }
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawExecuter(ctx: CanvasRenderingContext2D, e: Executer, interp: PoseSource, alpha: number): void {
    const pose = interp.pose(e.body, alpha);
    const t = e.age + alpha;
    if (e.variant.id === 'slime') this.drawSlimeGlue(ctx, e, interp, alpha, t);
    ctx.save();
    ctx.translate(pose.x, pose.y);
    if (!e.solid) {
      // Emerging from the button: grows to full size as it clears the wall.
      const k = 0.45 + 0.55 * easeOutCubic(Math.min(1, t / EXECUTER.emergeFrames));
      ctx.scale(k, k);
    }
    const c = e.body.getWorldCenter();
    const aim = e.target.tors.getWorldCenter();
    const toTarget = Math.atan2(aim.y - c.y, aim.x - c.x);
    switch (e.variant.id) {
      case 'magnet':
        this.drawMagnetArt(ctx, toTarget, e.field, e.phase === 'latched', t);
        break;
      case 'boxer':
        this.drawBoxer(ctx, e);
        break;
      case 'comet': {
        const v = e.body.getLinearVelocity();
        this.drawCometArt(ctx, pose.a, Math.atan2(v.y, v.x), v.length(), e.phase === 'dash', t);
        break;
      }
      case 'spring':
        this.drawSpringArt(ctx, toTarget, springStretch(e, t));
        break;
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
    }
    ctx.restore();

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
    ctx.save();
    ctx.rotate(facing);
    if (field > 0) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const p = (t * (0.03 + 0.04 * field) + i / 3) % 1; // 0 far → 1 near
        const radius = 22 + (1 - p) * (24 + 40 * field);
        ctx.strokeStyle = `rgba(84,184,238,${(0.15 + 0.55 * field) * Math.sin(p * Math.PI)})`;
        ctx.lineWidth = 1.5 + 1.5 * field;
        ctx.beginPath();
        ctx.arc(0, 0, radius, -0.75, 0.75);
        ctx.stroke();
      }
    }
    if (latched) {
      const glow = ctx.createRadialGradient(14, 0, 1, 14, 0, 22);
      glow.addColorStop(0, `rgba(160,220,255,${0.45 + 0.2 * Math.sin(t * 0.5)})`);
      glow.addColorStop(1, 'rgba(160,220,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-8, -22, 44, 44);
    }
    if (drawArenaSprite(ctx, 'magnet', -2, 0, 56, 56)) {
      ctx.restore();
      return;
    }
    // The U opens toward +x: the bend at the back, the poles in front.
    ctx.strokeStyle = '#3c4552';
    ctx.lineWidth = 11;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(12, -11);
    ctx.lineTo(-5, -11);
    ctx.arc(-5, 0, 11, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(12, 11);
    ctx.stroke();
    ctx.fillStyle = '#e94c47';
    ctx.fillRect(6, -16.5, 9, 11);
    ctx.fillStyle = '#48a9e9';
    ctx.fillRect(6, 5.5, 9, 11);
    ctx.fillStyle = '#cdd5dc';
    ctx.fillRect(-9, -14, 5, 5);
    ctx.fillRect(-9, 9, 5, 5);
    ctx.restore();
  }

  /**
   * The express porter leans with its dash and trails restrained service streaks.
   */
  private drawCometArt(
    ctx: CanvasRenderingContext2D, spin: number, heading: number, speed: number, dashing: boolean, t: number,
  ): void {
    ctx.save();
    ctx.scale(Math.cos(heading) >= 0 ? -1 : 1, 1);
    ctx.rotate(Math.sin(spin) * 0.07);
    if (speed > 2) {
      for (let i = 0; i < 3; i++) {
        const shift = (t * 2 + i * 7) % 12;
        ctx.strokeStyle = dashing ? 'rgba(255,183,105,0.5)' : 'rgba(169,200,215,0.3)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(27 + shift, -7 + i * 7);
        ctx.lineTo(36 + shift + Math.min(speed, 15), -7 + i * 7); ctx.stroke();
      }
    }
    if (!drawArenaSprite(ctx, 'porter', 0, 0, 64, 53)) {
      ctx.fillStyle = '#e4ded0'; roundRect(ctx, -23, -15, 46, 29, 7); ctx.fill();
      ctx.fillStyle = '#e18b4d'; ctx.fillRect(3, -11, 16, 14);
    }
    ctx.restore();
  }

  /**
   * Rigid fitness-assistant caps surround a flexible steel coil. Only the coil
   * stretches during charge, compresses on impact, and wobbles in recovery.
   */
  private drawSpringArt(ctx: CanvasRenderingContext2D, facing: number, stretch: number): void {
    const half = 15 * stretch;
    ctx.save(); ctx.rotate(facing + Math.PI / 2);
    // Rigid caps stay rigid while only the exposed steel coil changes length.
    const coil = ctx.createLinearGradient(-12, 0, 12, 0);
    coil.addColorStop(0, '#596676'); coil.addColorStop(0.3, '#e6e8e1');
    coil.addColorStop(0.55, '#788798'); coil.addColorStop(0.8, '#d6cab3'); coil.addColorStop(1, '#435363');
    ctx.strokeStyle = coil; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i <= 70; i++) {
      const p = i / 70, x = Math.sin(p * Math.PI * 10) * 11;
      const y = -half + 5 + p * (half * 2 - 10);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (!drawArenaSprite(ctx, 'spring-base', 0, half + 4, 38, 19)) {
      ctx.fillStyle = '#ded9ce'; roundRect(ctx, -17, half - 2, 34, 12, 4); ctx.fill();
    }
    if (!drawArenaSprite(ctx, 'spring-cap', 0, -half, 37, 19)) {
      ctx.fillStyle = '#df8050'; roundRect(ctx, -16, -half - 7, 32, 13, 5); ctx.fill();
    }
    ctx.restore();
  }

  /**
   * A spa-service dispenser pours animated adhesive treatment. Its rigid shell
   * remains readable while the transparent liquid and bonds show the hold.
   */
  private drawSlimeArt(
    ctx: CanvasRenderingContext2D, heading: number, speed: number, splat: number | null, gaze: number, t: number,
  ): void {
    const stuck = splat !== null;
    ctx.save();
    ctx.scale(Math.cos(gaze) >= 0 ? 1 : -1, 1);
    ctx.rotate(stuck ? Math.sin(splat) * 0.06 : Math.sin(heading) * speed * 0.12);
    const liquid = ctx.createRadialGradient(8, 14, 1, 7, 18, 24);
    liquid.addColorStop(0, 'rgba(138,238,230,0.72)'); liquid.addColorStop(1, 'rgba(48,156,173,0.05)');
    ctx.fillStyle = liquid; ctx.beginPath();
    ctx.ellipse(7, 18, stuck ? 26 : 17, 6 + Math.sin(t * 0.24), 0, 0, Math.PI * 2); ctx.fill();
    if (!drawArenaSprite(ctx, 'spa', 0, -1, 54, 44)) {
      ctx.fillStyle = '#e3ded4'; roundRect(ctx, -17, -16, 34, 32, 8); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(101,230,225,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(21, 6); ctx.quadraticCurveTo(24, 14, 16, 19); ctx.stroke();
    ctx.restore();
  }

  /**
   * The slime's glue, under its body: a goo bridge to each part it holds,
   * thinning as it is pulled out, a coat of goo on that part, a thin strand
   * to the part it is reeling in, and a strand that tore recoiling apart.
   */
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

  /** The boxer, with its jab aimed at whichever part it is going for. */
  private drawBoxer(ctx: CanvasRenderingContext2D, e: Executer): void {
    const c = e.body.getWorldCenter();
    const p = e.target.part(e.punchPart).getWorldCenter();
    const facing = p.x >= c.x ? 1 : -1;
    // In the flipped frame the target is always ahead; aim the arms at it.
    const aim = Math.max(-1.1, Math.min(1.1, Math.atan2(p.y - c.y, Math.abs(p.x - c.x))));
    const frame = e.punchFrame;
    const reach = frame < 0 ? 0 : frame <= BOXER.impactFrame
      ? frame / BOXER.impactFrame
      : Math.max(0, 1 - (frame - BOXER.impactFrame) / 8);
    const active = (e.hits + (frame >= BOXER.impactFrame ? 1 : 0)) % 2;
    this.drawBoxerArt(ctx, facing, aim, reach, active);
  }

  private drawBoxerArt(ctx: CanvasRenderingContext2D, facing: number, aim: number, reach: number, active: number): void {
    const r = EXECUTER.radiusPx;
    ctx.save();
    ctx.scale(facing, 1);

    // One longer arm jabs while the other guards.
    ctx.save();
    ctx.rotate(aim);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const y = i === 0 ? -9 : 9;
      const extension = i === active ? reach * BOXER.armExtensionPx : 0;
      ctx.strokeStyle = '#bda37b';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(21, y + (i === 0 ? -3 : 3));
      ctx.lineTo(BOXER.armRestPx - 1 + extension, y - (i === 0 ? -2 : 2));
      ctx.stroke();
      const glove = ctx.createRadialGradient(BOXER.armRestPx + extension - 2, y - 4, 1, BOXER.armRestPx + extension, y, 7);
      glove.addColorStop(0, '#ffc1a2'); glove.addColorStop(0.35, '#e77a52'); glove.addColorStop(1, '#8b3429');
      ctx.fillStyle = glove;
      ctx.beginPath();
      ctx.arc(BOXER.armRestPx + extension, y - (i === 0 ? -2 : 2), 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (!drawArenaSprite(ctx, 'boxer', 0, 0, r * 2.6, r * 2.4)) {
      const shell = ctx.createLinearGradient(0, -r, 0, r);
      shell.addColorStop(0, '#f2eee4'); shell.addColorStop(1, '#737e88');
      ctx.fillStyle = shell; roundRect(ctx, -r, -r, r * 2, r * 2, 8); ctx.fill();
      ctx.fillStyle = '#ffc478'; ctx.fillRect(-5, -4, 12, 3);
    }
    ctx.restore();
  }

  /** One hazard as a still icon, `size` px across, for the HUD queue. */
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
    }
    ctx.restore();
  }

  /**
   * The prize buttons. A hit sinks the face into the wall, flashes it and
   * throws a shockwave, every time — each hit launches another executer. While
   * any of them lives the button glows red, with a column that drains with the
   * longest-lived one; when the last dies it springs back out.
   */
  private drawPrizeButtons(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number): void {
    for (const b of gw.ground.prizeButtons) {
      const d = b.def;
      const live = !b.armed;
      const depth = buttonDepth(b, now);
      const x = d.x - d.hw - b.inward * depth;
      const y = d.y - d.hh;
      const w = d.hw * 2;
      const h = d.hh * 2;

      // Glow: steady when armed, pulsing while its executer lives.
      const pulse = live ? 0.28 + 0.2 * Math.sin(now * 0.28) : 0.3;
      const glow = ctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, h * 0.75);
      const resort = true;
      const sideGlow = b.def.side === 1 ? '51,202,215' : '255,152,127';
      const rgb = live ? PAL.prizeLiveGlow : resort ? sideGlow : PAL.prizeGlow;
      glow.addColorStop(0, `rgba(${rgb},${pulse})`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x + w / 2 - h * 0.75, y + h / 2 - h * 0.75, h * 1.5, h * 1.5);

      // Face.
      ctx.fillStyle = live ? PAL.prizeLive : resort ? b.def.side === 1 ? '#33cad7' : '#ff987f' : PAL.prize;
      roundRect(ctx, x, y, w, h, 2.5);
      ctx.fill();
      ctx.strokeStyle = live ? PAL.prizeLiveEdge : resort ? '#d2e6ed' : PAL.prizeEdge;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Life column: drains with the longest-lived of its executers.
      const life = Math.max(0, ...b.executers.filter((e) => !e.dead).map((e) => e.lifeFraction));
      if (live && life > 0) {
        const lh = (h - 6) * life;
        ctx.fillStyle = PAL.prizeCore;
        roundRect(ctx, x + w / 2 - 1, y + h - 3 - lh, 2, lh, 1);
        ctx.fill();
      }

      // Flash: bright on every press (each one launches), softer on re-arm.
      const flash = Math.max(flashCurve(now - b.pressedAt, 6, 1), flashCurve(now - b.releasedAt, 6, 0.5));
      if (flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        roundRect(ctx, x, y, w, h, 2.5);
        ctx.fill();
      }

      // Shockwave out of the face on the press; a small ring when it re-arms.
      const cx = d.x + b.inward * d.hw;
      const cy = d.y;
      ring(ctx, cx, cy, now - b.pressedAt, 14, 8, 95, 4.5, PAL.prizeLiveGlow);
      ring(ctx, cx, cy, now - b.releasedAt, 10, 6, 45, 2.5, PAL.prizeGlow);
    }
  }

  /** A player thrown or jumping far above the frame: mark where. */
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
      ctx.font = '800 8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(`P${p.id} ${(-sy / VIEW.scale / 30).toFixed(1)} m`, sx, 16);
    }
  }

  /** A clipped service ticket; HTML icon controls occupy the quiet row below. */
  private drawTopBar(ctx: CanvasRenderingContext2D, gw: GameWorld, now: number): number {
    const x = HUD_BAR.midX, y = 8, w = 158, h = 18;
    ctx.save();
    ctx.fillStyle = 'rgba(8,20,32,0.65)';
    ctx.strokeStyle = 'rgba(153,189,204,0.38)'; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(x - w / 2 + 5, y); ctx.lineTo(x + w / 2 - 5, y);
    ctx.lineTo(x + w / 2, y + 5); ctx.lineTo(x + w / 2, y + h - 4);
    ctx.lineTo(x + w / 2 - 4, y + h); ctx.lineTo(x - w / 2, y + h);
    ctx.lineTo(x - w / 2, y + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(228,187,118,0.65)'; ctx.beginPath();
    ctx.moveTo(x + w / 2 - 5, y); ctx.lineTo(x + w / 2, y + 5); ctx.stroke();
    ctx.strokeStyle = 'rgba(188,209,216,0.35)'; ctx.setLineDash([1, 2]);
    ctx.beginPath(); ctx.moveTo(x + 32, y + 3); ctx.lineTo(x + 32, y + h - 3); ctx.stroke(); ctx.setLineDash([]);
    ctx.font = '600 6.5px system-ui'; ctx.fillStyle = '#ced8dc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('TO ' + OPTIONS.gameSet, x + 54, y + h / 2);
    if (gw.hazards) this.drawNextHazard(ctx, gw, x - w / 2 + 8, y + h / 2, now);
    else { ctx.textAlign = 'left'; ctx.fillText('SERVICE OFF', x - w / 2 + 10, y + h / 2); }
    ctx.restore();
    return HUD_BAR.y + HUD_BAR.h;
  }

  private drawNextHazard(ctx: CanvasRenderingContext2D, gw: GameWorld, x: number, y: number, now: number): void {
    const [next] = gw.executerQueue.peek(1);
    if (!next) return;
    const since = now - gw.executerLaunchEffect.frame;
    const p = since >= 0 && since < 10 ? easeOutCubic(since / 10) : 1;
    ctx.save(); ctx.translate(x + 6, y); ctx.globalAlpha = 0.65 + 0.35 * p;
    ctx.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
    this.drawExecuterIcon(ctx, next.id, 12); ctx.restore();
    const label = next.id === 'comet' ? 'PORTER' : next.id === 'slime' ? 'SPA' : next.label;
    ctx.fillStyle = '#d3dfe2'; ctx.font = '600 6.5px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('NEXT: ' + label, x + 17, y);
  }

  /** The ball often flies above the frame; point at it from the top edge. */
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
    ctx.font = '600 8px system-ui, sans-serif';
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
      const ink = id === 1 ? '#a2e4ff' : '#e5ddd0';
      ctx.textAlign = id === 1 ? 'left' : 'right'; ctx.textBaseline = 'top';
      // A small architectural bracket replaces the generic scoreboard card.
      const shade = ctx.createLinearGradient(x - dir * 10, 0, x + dir * 52, 0);
      shade.addColorStop(0, 'rgba(5,14,23,0.66)'); shade.addColorStop(1, 'rgba(5,14,23,0)');
      ctx.fillStyle = shade; ctx.fillRect(Math.min(x - dir * 10, x + dir * 52), 8, 62, 54);
      ctx.strokeStyle = 'rgba(225,187,127,0.5)'; ctx.lineWidth = 0.65;
      ctx.beginPath(); ctx.moveTo(x - dir * 8, 10); ctx.lineTo(x - dir * 12, 14);
      ctx.lineTo(x - dir * 12, 50); ctx.lineTo(x - dir * 8, 54); ctx.stroke();
      const level = gw.levelOf(id);
      const label = gw.isCpu(id) ? 'CPU · ' + level : hud.singlePlayer ? 'YOU' : 'P' + id;
      ctx.font = '600 7px system-ui'; ctx.fillStyle = '#cdd8dd'; ctx.fillText(label, x, 13);
      ctx.font = '600 24px system-ui'; ctx.fillStyle = ink; ctx.fillText(String(g.score[id]), x, 24);
      for (let i = 0; i < MAX_TOUCHES; i++) {
        const on = i < Math.min(player.contact, MAX_TOUCHES);
        ctx.fillStyle = on ? player.contact >= MAX_TOUCHES ? '#ed805e' : ink : 'rgba(148,170,188,0.3)';
        ctx.beginPath(); ctx.arc(x + dir * (3 + i * 8), 54, 2.1, 0, Math.PI * 2); ctx.fill();
      }
      const status = (label: string, fraction: number, color: string, y: number) => {
        const cx = x + dir * 6;
        ctx.strokeStyle = 'rgba(148,170,188,0.25)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, y + 5, 5.5, -Math.PI / 2, Math.PI * 1.5); ctx.stroke();
        ctx.strokeStyle = color; ctx.beginPath();
        ctx.arc(cx, y + 5, 5.5, -Math.PI / 2, -Math.PI / 2 + clamp01(fraction) * Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#becdd6'; ctx.font = '600 6px system-ui'; ctx.fillText(label, x + dir * 16, y + 1);
      };
      let y = 65;
      if (player.injured) {
        ctx.fillStyle = '#ed805e'; ctx.font = '600 6px system-ui';
        ctx.fillText('INJURED · ' + player.detachedBodies.length + ' PARTS LOST', x, y);
        y += 14;
      }
      const live = gw.executers.filter(e => !e.dead && e.target.id === id);
      if (live.length) {
        const remaining = Math.max(...live.map(e => e.secondsLeft));
        const label = live.length > 1 ? live.length + ' HAZARDS' : live[0].variant.id === 'comet' ? 'PORTER' : live[0].variant.id === 'slime' ? 'SPA' : live[0].variant.label;
        status(label + ' · ' + remaining + 's', Math.max(...live.map(e => e.lifeFraction)), '#d8b07b', y); y += 14;
      }
      const power = gw.powerUps.active[id];
      if (power) {
        const remaining = Math.max(0, power.expiresAt - gw.frame);
        status(POWER_LABELS[power.kind] + ' · ' + Math.ceil(remaining / FPS) + 's', remaining / (power.expiresAt - power.startedAt), ink, y); y += 14;
      }
      const cooldown = gw.swingCooldownFramesLeft(id);
      if (cooldown > 0) status('FLIP · ' + Math.ceil(cooldown / FPS) + 's', 0, '#9fb5c5', y);
    }
    const top = this.drawTopBar(ctx, gw, now);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    if (g.phase === 'play' && gw.ball.ballOfPlayer !== 0) {
      const secs = g.serveSecondsLeft;
      ctx.fillStyle = secs <= 2 ? '#f4a078' : '#bdcdd6'; ctx.font = '600 8px system-ui';
      const holder = gw.ball.ballOfPlayer;
      const who = hud.singlePlayer ? holder === 1 ? 'YOUR SERVE' : 'CPU SERVE' : 'P' + holder + ' SERVE';
      ctx.fillText(who + ' · ' + secs, HUD_BAR.midX, top + 6);
    }
    if (hud.message) this.drawBanner(ctx, hud.message, hud.messageTone, HUD_BAR.midX, 104);
    ctx.restore();
  }

  /**
   * A pill across the court in the scorer's jersey: the headline, and under
   * it the reason after a " · " if there is one.
   */
  private drawBanner(ctx: CanvasRenderingContext2D, text: string, tone: 0 | 1 | 2, x: number, y: number): void {
    const [title, detail] = text.split(' · ');
    const titleFont = '700 15px system-ui, sans-serif';
    const detailFont = '800 8px system-ui, sans-serif';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = titleFont;
    let w = ctx.measureText(title).width;
    if (detail) {
      ctx.font = detailFont;
      w = Math.max(w, ctx.measureText(detail).width);
    }
    w += 40;
    const h = detail ? 37 : 26;
    ctx.shadowColor = 'rgba(15,25,35,0.28)';
    ctx.shadowBlur = 14 * this.k;
    ctx.shadowOffsetY = 3 * this.k;
    ctx.fillStyle = 'rgba(8,20,32,0.85)';
    roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = tone === 1 ? 'rgba(145,220,226,0.5)' : tone === 2 ? 'rgba(236,161,147,0.5)' : 'rgba(189,205,214,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = titleFont;
    ctx.fillText(title, x, detail ? y - 6 : y + 1);
    if (detail) {
      ctx.font = detailFont;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(detail, x, y + 13);
    }
    ctx.restore();
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Each hazard's impact ring colour. */
const IMPACT_RGB: Record<ExecuterId, string> = {
  magnet: '84,184,238', boxer: '255,214,170', comet: '255,150,60', spring: '214,160,255', slime: '140,226,92',
};

/** The slime's goo. */
const SLIME_RGB = '63,199,197';

/**
 * The spring's drawn length, 1 at rest: drawn out with speed as it charges,
 * crushed on impact (further the harder it hit), then a damped wobble back
 * to full length while it recovers.
 */
function springStretch(e: Executer, t: number): number {
  if (e.phase === 'charge') return 1 + 0.3 * clamp01(e.body.getLinearVelocity().length() / SPRING.topSpeed);
  const hit = e.lastImpact;
  if (!hit) return 1;
  const since = t - hit.age;
  return 1 - (0.25 + 0.35 * hit.power) * Math.cos(since * 0.45) * Math.exp(-since * 0.07);
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
  ctx.arc(x, y, r0 + (r1 - r0) * easeOutCubic(p), 0, Math.PI * 2);
  ctx.stroke();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export const worldToStage = (xPx: number, yPx: number) => ({
  x: xPx * VIEW.scale + STAGE.offsetX,
  y: yPx * VIEW.scale + STAGE.offsetY,
});

export { toPx };
