import {
  ART, BALL, CHARGE, COURT, EXECUTER, FLOOR_TOP_PX, MAX_TOUCHES, OPTIONS, PARTS, PRIZE_ANIM, PRIZE_BUTTONS,
  RIGHT_WALL_INNER_PX, VIEW, toPx, type PartName,
} from '../sim/constants';
import type { Executer } from '../sim/executer';
import type { GameWorld } from '../sim/world';
import type { Player } from '../sim/player';
import type { PrizeButton } from '../sim/prizeButton';
import type { Interpolator, Pose } from './interp';

/**
 * Canvas renderer. Draws in the original's coordinate systems: a 640x400
 * stage, and inside it the world sprite scaled 0.56 at (124, 180) (§15).
 * Parts are drawn at their ARTWORK size, not their collider size (§15).
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
  jersey: { 1: '#2f6fde', 2: '#e2453b' },
  jerseyShade: { 1: '#1f4fa8', 2: '#a92d25' },
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
} as const;

/** DropShadowFilter: distance 10, angle 70° (P1) / 110° (P2), alpha 0.2. */
const SHADOW = {
  alpha: 0.2,
  dist: 10,
  angle: { 1: (70 * Math.PI) / 180, 2: (110 * Math.PI) / 180 },
} as const;

/** Parts are drawn back to front in this order. */
const DRAW_ORDER: PartName[] = [
  'FootLeft', 'FootRight', 'LegLeft', 'LegRight', 'Ass', 'Tors',
  'ArmLeft', 'ArmRight', 'HandLeft', 'HandRight', 'FingerLeft', 'FingerRight', 'Head',
];

const COLLIDER_HALF = new Map(
  PARTS.map((p) => [p.name, p.shape.kind === 'box' ? { hw: p.shape.hw, hh: p.shape.hh } : { hw: p.shape.r, hh: p.shape.r }]),
);

export interface HudState {
  singlePlayer: boolean;
  message: string | null;
  showControlsHint: boolean;
}

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private readonly shadow: HTMLCanvasElement;
  /** Device pixels per stage pixel. */
  private k = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.bg = document.createElement('canvas');
    this.shadow = document.createElement('canvas');
    this.resize();
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
    for (const c of [this.bg, this.shadow]) {
      c.width = w;
      c.height = h;
    }
    this.paintBackground();
  }

  // -------------------------------------------------------------------------
  // Transforms
  // -------------------------------------------------------------------------

  private stageSpace(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.k, 0, 0, this.k, 0, 0);
  }

  private worldSpace(ctx: CanvasRenderingContext2D): void {
    const s = this.k * VIEW.scale;
    ctx.setTransform(s, 0, 0, s, this.k * VIEW.offsetX, this.k * VIEW.offsetY);
  }

  // -------------------------------------------------------------------------
  // Static layer: sky, sea, sand, walls, net. Painted once per resize.
  // -------------------------------------------------------------------------

  private paintBackground(): void {
    const ctx = this.bg.getContext('2d')!;
    this.stageSpace(ctx);
    const W = VIEW.stageW;
    const H = VIEW.stageH;

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, PAL.skyTop);
    sky.addColorStop(0.62, PAL.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sea band just above the sand line.
    this.worldSpace(ctx);
    const seaTop = FLOOR_TOP_PX - 95;
    ctx.fillStyle = PAL.sea;
    ctx.fillRect(-400, seaTop, 1500, FLOOR_TOP_PX - seaTop);
    ctx.fillStyle = PAL.seaFoam;
    ctx.fillRect(-400, seaTop, 1500, 3);
    ctx.fillRect(-400, FLOOR_TOP_PX - 10, 1500, 2);

    // Sand: the ground body's top face is the floor line (y = 355).
    const g = COURT.ground;
    const sand = ctx.createLinearGradient(0, FLOOR_TOP_PX, 0, g.y + g.hh);
    sand.addColorStop(0, PAL.sand);
    sand.addColorStop(1, PAL.sandDark);
    ctx.fillStyle = sand;
    ctx.fillRect(g.x - g.hw, g.y - g.hh, g.hw * 2, g.hh * 2);
    ctx.fillStyle = PAL.sandLine;
    ctx.fillRect(g.x - g.hw, FLOOR_TOP_PX, g.hw * 2, 1.5);

    // Walls.
    for (const w of [COURT.leftWall, COURT.rightWall]) {
      ctx.fillStyle = PAL.wall;
      ctx.fillRect(w.x - w.hw, w.y - w.hh, w.hw * 2, w.hh * 2);
      ctx.fillStyle = PAL.wallEdge;
      const inner = w === COURT.leftWall ? w.x + w.hw - 4 : w.x - w.hw;
      ctx.fillRect(inner, w.y - w.hh, 4, w.hh * 2);
    }

    // Prize buttons (§13): the recess each sits in. The button itself animates,
    // so it is drawn per frame.
    for (const p of PRIZE_BUTTONS) {
      const inward = p.side === 1 ? 1 : -1;
      const wallFace = p.x - inward * (p.hw + 1);
      const depth = PRIZE_ANIM.pressDepthPx + 3;
      const x = inward === 1 ? wallFace - depth : wallFace;
      ctx.fillStyle = PAL.housing;
      roundRect(ctx, x, p.y - p.hh - 4, depth, p.hh * 2 + 8, 2);
      ctx.fill();
      ctx.fillStyle = PAL.housingRim;
      ctx.fillRect(inward === 1 ? wallFace - 1 : wallFace, p.y - p.hh - 4, 1, p.hh * 2 + 8);
    }

    // Net: the collider is 2 px wide, 150 tall. Drawn a touch wider to read,
    // with a mesh panel hanging off the top half.
    const n = COURT.net;
    const top = n.y - n.hh;
    const bottom = n.y + n.hh;
    ctx.fillStyle = PAL.netMesh;
    ctx.strokeStyle = PAL.netMesh;
    ctx.lineWidth = 0.8;
    const meshW = 7;
    const meshH = 62;
    ctx.beginPath();
    for (let y = top + 4; y <= top + meshH; y += 7) {
      ctx.moveTo(n.x - meshW, y);
      ctx.lineTo(n.x + meshW, y);
    }
    for (let x = -meshW; x <= meshW; x += 3.5) {
      ctx.moveTo(n.x + x, top + 4);
      ctx.lineTo(n.x + x, top + meshH);
    }
    ctx.stroke();
    ctx.fillStyle = PAL.netPole;
    ctx.fillRect(n.x - 2, top, 4, bottom - top);
    ctx.fillStyle = PAL.netTape;
    ctx.fillRect(n.x - meshW - 1, top, meshW * 2 + 2, 4);
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  draw(gw: GameWorld, interp: Interpolator, alpha: number, hud: HudState): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);

    this.drawShadows(gw, interp, alpha);

    this.worldSpace(ctx);
    // Animation clock in frames: the interpolated poses sit between the
    // previous frame and the latest, so this does too.
    const now = gw.frame - 1 + alpha;
    this.drawPrizeButtons(ctx, gw, now);
    for (const p of [gw.p1, gw.p2]) this.drawDoll(ctx, p, interp, alpha);
    this.drawBall(ctx, gw, interp, alpha);
    this.drawSwingEffects(ctx, gw, interp, alpha);
    this.drawOpponentHitEffects(ctx, gw, interp, alpha);
    this.drawSpecialEffects(ctx, gw, interp, alpha);
    for (const e of gw.executers) if (!e.dead) this.drawExecuter(ctx, e, interp, alpha);
    this.drawChargeMeters(ctx, gw, interp, alpha);

    this.stageSpace(ctx);
    this.drawOffscreenBall(ctx, gw, interp, alpha);
    this.drawOffscreenPlayers(ctx, gw, interp, alpha);
    this.drawHud(ctx, gw, hud);
  }

  /**
   * One silhouette pass for both dolls, composited once at alpha 0.2, so
   * overlapping parts do not stack into darker patches.
   */
  private drawShadows(gw: GameWorld, interp: Interpolator, alpha: number): void {
    const sctx = this.shadow.getContext('2d')!;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, this.shadow.width, this.shadow.height);
    sctx.fillStyle = '#000';
    for (const p of [gw.p1, gw.p2]) {
      const ang = SHADOW.angle[p.id];
      const dx = (SHADOW.dist * Math.cos(ang)) / VIEW.scale;
      const dy = (SHADOW.dist * Math.sin(ang)) / VIEW.scale;
      this.worldSpace(sctx);
      sctx.translate(dx, dy);
      for (const name of DRAW_ORDER) {
        this.withPose(sctx, interp.pose(p.part(name), alpha), () => this.partShape(sctx, name, true));
      }
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = SHADOW.alpha;
    ctx.drawImage(this.shadow, 0, 0);
    ctx.globalAlpha = 1;
  }

  private withPose(ctx: CanvasRenderingContext2D, pose: Pose, fn: () => void): void {
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    fn();
    ctx.restore();
  }

  private drawDoll(ctx: CanvasRenderingContext2D, p: Player, interp: Interpolator, alpha: number): void {
    for (const name of DRAW_ORDER) {
      this.withPose(ctx, interp.pose(p.part(name), alpha), () => this.partArt(ctx, name, p.id));
    }
  }

  /**
   * A red bar and glow on the striking hand show the windup. A faint line
   * shows when the nearby ball is in attraction range.
   */
  private drawChargeMeters(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
    for (const p of [gw.p1, gw.p2]) {
      const info = gw.control.chargeLevel(p.id);
      if (!info) continue;
      const pose = interp.pose(p.head, alpha);
      const finger = interp.pose(p.strikingFinger, alpha);
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

  /** A short slash around the striking hand makes the release readable. */
  private drawSwingEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    for (const p of [gw.p1, gw.p2]) {
      const effect = gw.swingEffects[p.id];
      const age = now - effect.frame;
      if (age < 0 || age >= 8) continue;
      const finger = interp.pose(p.strikingFinger, alpha);
      const fade = 1 - age / 8;
      const radius = 16 + effect.power * 12 + age * 2;
      const start = p.id === 1 ? -Math.PI * 0.7 : Math.PI * 0.3;
      const end = start + Math.PI * 0.9;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(255,245,190,${0.85 * fade})`;
      ctx.lineWidth = 3 + 3 * effect.power;
      ctx.beginPath();
      ctx.arc(finger.x, finger.y, radius, start, end);
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,77,46,${0.7 * fade})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(finger.x, finger.y, radius + 8, start + 0.2, end - 0.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** A brief impact ring makes the opponent knockback clear. */
  private drawOpponentHitEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
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

  /** Callouts for the three timing-based moves. */
  private drawSpecialEffects(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
    const now = gw.frame - 1 + alpha;
    const ball = interp.pose(gw.ball.body, alpha);
    for (const p of [gw.p1, gw.p2]) {
      const pose = interp.pose(p.head, alpha);
      if (gw.rescueState(p) === 'ready' && (!gw.singlePlayer || p.id === 1)) {
        ctx.save();
        ctx.fillStyle = 'rgba(10,110,140,0.9)';
        ctx.font = 'bold 17px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${p.id === 1 ? 'C' : 'F'} DIVE!`, pose.x, pose.y - 42);
        ctx.restore();
      }
      const feedback = gw.rescueFeedback[p.id];
      const feedbackAge = now - feedback.frame;
      if (feedbackAge >= 0 && feedbackAge < 30) {
        ctx.save();
        ctx.fillStyle = `rgba(30,45,55,${1 - feedbackAge / 30})`;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(feedback.text, pose.x, pose.y - 62);
        ctx.restore();
      }
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
        ctx.fillText('PERFECT!', ball.x, ball.y - 30 - perfectAge);
        ctx.restore();
      }

      const rescue = gw.rescueEffects[p.id];
      const rescueAge = now - rescue.frame;
      if (rescueAge >= 0 && rescueAge < 12) {
        const fade = 1 - rescueAge / 12;
        ctx.save();
        ctx.strokeStyle = `rgba(70,210,245,${fade})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(pose.x, pose.y, 20 + rescueAge * 2, Math.PI * 0.2, Math.PI * 1.3);
        ctx.stroke();
        if (rescue.success) {
          ctx.fillStyle = `rgba(10,95,125,${fade})`;
          ctx.font = 'bold 16px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('SAVE!', pose.x, pose.y - 32 - rescueAge);
        }
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

  /** Where a part's art sits relative to its body origin (§15 leg rule). */
  private artRect(name: PartName): { x: number; y: number; w: number; h: number } {
    const art = ART[name];
    const col = COLLIDER_HALF.get(name)!;
    let cy = 0;
    // "Draw each leg segment at sprite length with its LOWER end pinned to the
    // bottom of its collider, so the sole stays on the sand and the thigh runs
    // up under the hips."
    if (name.startsWith('Leg') || name.startsWith('Foot')) cy = col.hh - art.h / 2;
    return { x: -art.w / 2, y: cy - art.h / 2, w: art.w, h: art.h };
  }

  /** Silhouette only — used for the shadow pass. */
  private partShape(ctx: CanvasRenderingContext2D, name: PartName, fill: boolean): void {
    if (name === 'Head') {
      ctx.beginPath();
      ctx.ellipse(0, 0, ART.Head.w / 2, ART.Head.h / 2, 0, 0, Math.PI * 2);
      if (fill) ctx.fill();
      return;
    }
    if (name.startsWith('Finger')) {
      this.handPath(ctx, name === 'FingerRight' ? 1 : -1);
      if (fill) ctx.fill();
      return;
    }
    const r = this.artRect(name);
    roundRect(ctx, r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * 0.45);
    if (fill) ctx.fill();
  }

  private partArt(ctx: CanvasRenderingContext2D, name: PartName, id: 1 | 2): void {
    const jersey = PAL.jersey[id];
    const shorts = PAL.shorts[id];
    switch (name) {
      case 'Head': {
        const rx = ART.Head.w / 2;
        const ry = ART.Head.h / 2;
        ctx.fillStyle = PAL.skin;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // Hair cap.
        ctx.fillStyle = PAL.hair[id];
        ctx.beginPath();
        ctx.ellipse(0, -ry * 0.28, rx * 1.02, ry * 0.78, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        // Face toward the net.
        const face = id === 1 ? 1 : -1;
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(face * 4.2, 0.5, 1.35, 0, Math.PI * 2);
        ctx.arc(face * 0.2, 0.5, 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8a4b3a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(face * 2.4, 4.2, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        return;
      }
      case 'Tors': {
        const r = this.artRect(name);
        ctx.fillStyle = jersey;
        roundRect(ctx, r.x, r.y, r.w, r.h, 7);
        ctx.fill();
        ctx.fillStyle = PAL.jerseyShade[id];
        ctx.fillRect(r.x + r.w * 0.38, r.y + 6, r.w * 0.24, r.h - 12);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(id), 0, 2);
        return;
      }
      case 'Ass': {
        const r = this.artRect(name);
        ctx.fillStyle = shorts;
        roundRect(ctx, r.x, r.y, r.w, r.h, 6);
        ctx.fill();
        return;
      }
      case 'LegLeft':
      case 'LegRight': {
        const r = this.artRect(name);
        ctx.fillStyle = PAL.skin;
        roundRect(ctx, r.x, r.y, r.w, r.h, r.w * 0.45);
        ctx.fill();
        // Shorts cover the top of the thigh.
        ctx.fillStyle = shorts;
        roundRect(ctx, r.x - 0.5, r.y, r.w + 1, r.h * 0.42, 4);
        ctx.fill();
        return;
      }
      case 'FootLeft':
      case 'FootRight': {
        const r = this.artRect(name);
        ctx.fillStyle = PAL.skinShade;
        roundRect(ctx, r.x, r.y, r.w, r.h, r.w * 0.45);
        ctx.fill();
        ctx.fillStyle = PAL.shoe;
        roundRect(ctx, r.x - 0.5, r.y + r.h - 7, r.w + 1, 7, 3);
        ctx.fill();
        return;
      }
      case 'ArmLeft':
      case 'ArmRight': {
        const r = this.artRect(name);
        ctx.fillStyle = PAL.skin;
        roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.5);
        ctx.fill();
        // Sleeve on the shoulder end.
        const shoulderSide = name === 'ArmRight' ? -1 : 1;
        ctx.fillStyle = jersey;
        const sw = r.w * 0.4;
        roundRect(ctx, shoulderSide < 0 ? r.x : r.x + r.w - sw, r.y - 0.4, sw, r.h + 0.8, r.h * 0.5);
        ctx.fill();
        return;
      }
      case 'HandLeft':
      case 'HandRight': {
        const r = this.artRect(name);
        ctx.fillStyle = PAL.skin;
        roundRect(ctx, r.x, r.y, r.w, r.h, r.h * 0.5);
        ctx.fill();
        return;
      }
      case 'FingerLeft':
      case 'FingerRight': {
        // The art box is measured across SPREAD fingers; a solid blob at that
        // size reads as a boxing glove (§15). Palm plus fingers instead.
        ctx.fillStyle = PAL.skin;
        this.handPath(ctx, name === 'FingerRight' ? 1 : -1);
        ctx.fill();
        return;
      }
    }
  }

  /** A small palm with three splayed fingers, spanning the 16.4 x 14.4 art box. */
  private handPath(ctx: CanvasRenderingContext2D, dir: 1 | -1): void {
    const tipX = dir * (ART.FingerRight.w / 2);
    const halfSpread = ART.FingerRight.h / 2 - 1.6;
    const hw = 1.35; // half the finger thickness
    ctx.beginPath();
    ctx.ellipse(dir * 0.5, 0, 5.2, 4.6, 0, 0, Math.PI * 2);
    for (const ty of [-halfSpread, 0, halfSpread]) {
      const bx = dir * 3.5;
      const by = ty * 0.45;
      const dx = tipX - bx;
      const dy = ty - by;
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * hw;
      const ny = (dx / len) * hw;
      ctx.moveTo(bx + nx, by + ny);
      ctx.lineTo(tipX + nx, ty + ny);
      ctx.lineTo(tipX - nx, ty - ny);
      ctx.lineTo(bx - nx, by - ny);
      ctx.closePath();
    }
  }

  private drawBall(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
    const pose = interp.pose(gw.ball.body, alpha);
    const v = gw.ball.velocity;
    const speed = Math.hypot(v.x, v.y);
    const r = BALL.radiusPx;

    // Trail sprite, scaled by speed/25 and rotated to the velocity (§9).
    if (speed > 3) {
      const s = Math.min(1.4, speed / 25);
      const ang = Math.atan2(v.y, v.x);
      ctx.save();
      ctx.translate(pose.x, pose.y);
      ctx.rotate(ang);
      const len = 70 * s;
      const grad = ctx.createLinearGradient(-len, 0, 0, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, 'rgba(255,255,255,0.55)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, -r * 0.85);
      ctx.lineTo(0, r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Motion blur: |vx|/7, or |angularVelocity|/11 below 4.5 m/s (§9).
    const blur = Math.abs(v.x) >= 4.5
      ? Math.abs(v.x) / 7
      : Math.abs(gw.ball.body.getAngularVelocity()) / 11;
    const ghosts = Math.min(3, Math.floor(blur));
    for (let i = ghosts; i >= 1; i--) {
      const back = (i * Math.min(speed, 20)) / 28 / 3 * 30;
      const ux = speed > 0 ? v.x / speed : 0;
      const uy = speed > 0 ? v.y / speed : 0;
      ctx.globalAlpha = 0.18 / i;
      this.ballArt(ctx, { x: pose.x - ux * back, y: pose.y - uy * back, a: pose.a });
    }
    ctx.globalAlpha = 1;
    this.ballArt(ctx, pose);
  }

  private ballArt(ctx: CanvasRenderingContext2D, pose: Pose): void {
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
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r - 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawExecuter(ctx: CanvasRenderingContext2D, e: Executer, interp: Interpolator, alpha: number): void {
    const pose = interp.pose(e.body, alpha);
    const r = EXECUTER.radiusPx;
    ctx.save();
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.a);
    if (!e.solid) {
      // Emerging from the button: grows to full size as it clears the wall.
      const p = Math.min(1, (e.age + alpha) / EXECUTER.emergeFrames);
      const k = 0.45 + 0.55 * easeOutCubic(p);
      ctx.scale(k, k);
    }
    if (e.kind === 'head') {
      this.drawHeadExecuter(ctx, e);
      ctx.restore();
      return;
    }
    ctx.fillStyle = PAL.executerSpike;
    ctx.beginPath();
    const spikes = 10;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2;
      const a0 = a - 0.18;
      const a1 = a + 0.18;
      ctx.moveTo(Math.cos(a0) * r * 0.85, Math.sin(a0) * r * 0.85);
      ctx.lineTo(Math.cos(a) * r * 1.55, Math.sin(a) * r * 1.55);
      ctx.lineTo(Math.cos(a1) * r * 0.85, Math.sin(a1) * r * 0.85);
    }
    ctx.fill();
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    g.addColorStop(0, '#6b6d78');
    g.addColorStop(1, PAL.executer);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawHeadExecuter(ctx: CanvasRenderingContext2D, e: Executer): void {
    const r = EXECUTER.radiusPx;
    const facing = e.target.head.getWorldCenter().x >= e.body.getWorldCenter().x ? 1 : -1;
    ctx.scale(facing, 1);
    const frame = e.punchFrame;
    const reach = frame < 0 ? 0 : frame <= EXECUTER.headImpactFrame
      ? frame / EXECUTER.headImpactFrame
      : Math.max(0, 1 - (frame - EXECUTER.headImpactFrame) / 8);
    const active = (e.punches + (frame >= EXECUTER.headImpactFrame ? 1 : 0)) % 2;

    // One longer arm jabs while the other guards.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < 2; i++) {
      const y = i === 0 ? -9 : 9;
      const extension = i === active ? reach * EXECUTER.headArmExtensionPx : 0;
      ctx.strokeStyle = '#934b48';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(21, y + (i === 0 ? -3 : 3));
      ctx.lineTo(EXECUTER.headArmRestPx - 1 + extension, y - (i === 0 ? -2 : 2));
      ctx.stroke();
      ctx.fillStyle = '#eab18f';
      ctx.beginPath();
      ctx.arc(EXECUTER.headArmRestPx + extension, y - (i === 0 ? -2 : 2), 5, 0, Math.PI * 2);
      ctx.fill();
    }

    const skin = ctx.createRadialGradient(-6, -7, 1, 0, 0, r);
    skin.addColorStop(0, '#f4c39e');
    skin.addColorStop(1, '#bf7265');
    ctx.fillStyle = skin;
    ctx.strokeStyle = '#663c40';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // A sharp brow, narrowed eyes and clenched teeth read even at game scale.
    ctx.strokeStyle = '#392b32';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(1, -8); ctx.lineTo(9, -5);
    ctx.moveTo(1, 0); ctx.lineTo(9, -2);
    ctx.stroke();
    ctx.fillStyle = '#392b32';
    ctx.beginPath();
    ctx.arc(9, -2, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff0d9';
    ctx.fillRect(5, 7, 8, 4);
    ctx.strokeStyle = '#6b3537';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(5, 7, 8, 4);
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
      const rgb = live ? PAL.prizeLiveGlow : PAL.prizeGlow;
      glow.addColorStop(0, `rgba(${rgb},${pulse})`);
      glow.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(x + w / 2 - h * 0.75, y + h / 2 - h * 0.75, h * 1.5, h * 1.5);

      // Face.
      ctx.fillStyle = live ? PAL.prizeLive : PAL.prize;
      roundRect(ctx, x, y, w, h, 2.5);
      ctx.fill();
      ctx.strokeStyle = live ? PAL.prizeLiveEdge : PAL.prizeEdge;
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

  /** A player pinned to the ceiling is far above the frame; mark where. */
  private drawOffscreenPlayers(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
    for (const p of [gw.p1, gw.p2]) {
      const pose = interp.pose(p.head, alpha);
      const sy = pose.y * VIEW.scale + VIEW.offsetY;
      if (sy > -6) continue;
      const sx = pose.x * VIEW.scale + VIEW.offsetX;
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

  /** The ball often flies above the frame; point at it from the top edge. */
  private drawOffscreenBall(ctx: CanvasRenderingContext2D, gw: GameWorld, interp: Interpolator, alpha: number): void {
    const pose = interp.pose(gw.ball.body, alpha);
    const sy = pose.y * VIEW.scale + VIEW.offsetY;
    if (sy > -BALL.radiusPx * VIEW.scale) return;
    const sx = pose.x * VIEW.scale + VIEW.offsetX;
    const heightM = (-sy / VIEW.scale / 30).toFixed(1);
    ctx.fillStyle = 'rgba(20,30,40,0.55)';
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

  private drawHud(ctx: CanvasRenderingContext2D, gw: GameWorld, hud: HudState): void {
    const g = gw.game;
    // Keep the HUD over the court and clear of the prize buttons, which sit at
    // the top of each wall (stage x ~6 and ~593) and glow ~30 px around.
    const leftX = 48;
    const rightX = RIGHT_WALL_INNER_PX * VIEW.scale + VIEW.offsetX - 42;
    const midX = (leftX + rightX) / 2;

    const side = (id: 1 | 2) => {
      const p = id === 1 ? gw.p1 : gw.p2;
      const x = id === 1 ? leftX : rightX;
      const align: CanvasTextAlign = id === 1 ? 'left' : 'right';
      const label = hud.singlePlayer ? (id === 1 ? 'YOU' : `CPU · LV ${g.level}`) : `PLAYER ${id}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(15,25,35,0.72)';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.fillText(label, x, 12);
      ctx.fillStyle = PAL.jersey[id];
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillText(String(g.score[id]), x, 22);

      // Touch pips. The third lights the warning (§11.3).
      const warn = p.contact >= MAX_TOUCHES;
      for (let i = 0; i < MAX_TOUCHES; i++) {
        const px = id === 1 ? x + 4 + i * 11 : x - 4 - i * 11;
        ctx.beginPath();
        ctx.arc(px, 62, 3.6, 0, Math.PI * 2);
        const on = i < Math.min(p.contact, MAX_TOUCHES);
        ctx.fillStyle = on ? (warn ? '#e63b2e' : 'rgba(15,25,35,0.75)') : 'rgba(15,25,35,0.16)';
        ctx.fill();
      }
      if (!hud.singlePlayer || id === 1) {
        const state = gw.rescueState(p);
        const hint = {
          ready: 'DIVE NOW', used: 'DIVE USED', held: 'WAIT FOR RALLY',
          otherSide: 'OPPONENT SIDE', rising: 'WAIT FOR FALL',
          far: 'GET CLOSER', high: 'BALL TOO HIGH',
        }[state];
        ctx.fillStyle = state === 'ready' ? 'rgba(10,110,140,0.95)' : 'rgba(15,25,35,0.45)';
        ctx.font = '700 8px system-ui, sans-serif';
        ctx.fillText(`${id === 1 ? 'C' : 'F'}: ${hint}`, x, 86);
      }
    };
    side(1);
    side(2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(15,25,35,0.55)';
    ctx.font = '700 8px system-ui, sans-serif';
    ctx.fillText(`FIRST TO ${OPTIONS.gameSet}`, midX, 10);

    // Serve clock: 6 - count (§11).
    if (g.phase === 'play' && gw.ball.ballOfPlayer !== 0) {
      const holder = gw.ball.ballOfPlayer;
      const secs = g.serveSecondsLeft;
      ctx.fillStyle = secs <= 2 ? '#e63b2e' : 'rgba(15,25,35,0.8)';
      ctx.font = '800 18px system-ui, sans-serif';
      ctx.fillText(String(secs), midX, 22);
      ctx.font = '700 8px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(15,25,35,0.6)';
      const who = hud.singlePlayer ? (holder === 1 ? 'YOUR SERVE' : 'CPU SERVE') : `P${holder} SERVE`;
      ctx.fillText(who, midX, 44);
      if (hud.showControlsHint && holder === 1) {
        ctx.fillText('JUMP, THEN TAP TO SERVE', midX, 55);
      }
    }

    if (hud.message) {
      ctx.textBaseline = 'middle';
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(hud.message, midX, 150);
      ctx.fillStyle = 'rgba(15,25,35,0.9)';
      ctx.fillText(hud.message, midX, 150);
    }

    for (const id of [1, 2] as const) {
      const live = gw.executers.filter((e) => !e.dead && e.target.id === id);
      if (live.length === 0) continue;
      const secs = Math.max(...live.map((e) => e.secondsLeft));
      ctx.textAlign = id === 1 ? 'left' : 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#e63b2e';
      ctx.font = '800 8px system-ui, sans-serif';
      const label = live.length > 1 ? `EXECUTERS ×${live.length} · ${secs}s` : `EXECUTER · ${secs}s`;
      ctx.fillText(label, id === 1 ? leftX : rightX, 72);
    }
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
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
  x: xPx * VIEW.scale + VIEW.offsetX,
  y: yPx * VIEW.scale + VIEW.offsetY,
});

export { toPx };
