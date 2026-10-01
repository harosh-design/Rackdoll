import { Vec2 } from 'planck';
import { CHARGE, toM, toPx } from '../src/sim/constants';
import type { ExecuterTuning } from '../src/sim/executer';
import type { Player } from '../src/sim/player';
import { GameWorld, type GameWorldOptions } from '../src/sim/world';

export const px = toPx;

export function world(opts: GameWorldOptions = {}): GameWorld {
  return new GameWorld({ singlePlayer: false, hazards: false, ...opts });
}

export function run(gw: GameWorld, frames: number): void {
  for (let i = 0; i < frames; i++) {
    gw.step();
    gw.reap();
  }
}

/** Run until the rally ends (or a cap), returning frames taken. */
export function untilPoint(gw: GameWorld, cap = 30 * 30): number {
  let f = 0;
  while (gw.game.phase === 'play' && f < cap) {
    gw.step();
    gw.reap();
    f++;
  }
  return f;
}

/**
 * Jump, then tap once airborne. Keep the prior flight time so the rally
 * physics checks see the ball released from the same part of the jump.
 */
export function jumpServe(gw: GameWorld, jumpKey = 38, serveKey = 32, delay = 4): void {
  gw.control.press(jumpKey);
  run(gw, delay);
  gw.control.release(jumpKey);
  run(gw, CHARGE.maxFrames);
  gw.control.press(serveKey);
  gw.step();
  gw.control.release(serveKey);
  gw.step();
}

/** Seeded LCG so soak tests are reproducible. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------
// Hazard helpers
// ---------------------------------------------------------------------------


/** A world with the rules frozen and the ball free, for hazard physics. */
export function hazardWorld(opts: GameWorldOptions = {}): GameWorld {
  const gw = world({ hazards: true, ...opts });
  gw.game.update = () => {};
  (gw.game as unknown as { delayTimer: { reset(): void } }).delayTimer.reset();
  const j = gw.p1.holdingJoint;
  if (j) {
    gw.world.destroyJoint(j);
    gw.p1.forgetBallJoint();
  }
  gw.ball.ballOfPlayer = 0;
  run(gw, 60);
  return gw;
}

/**
 * Fire the ball into a wall button and step until it lands. Returns how many
 * frames passed between the ball touching the button and the press.
 */
export function fireAtButton(gw: GameWorld, side: 1 | 2): number {
  const b = gw.ground.prizeButtons.find((p) => p.side === side)!;
  const before = b.pressedAt;
  const dir = side === 1 ? -1 : 1;
  gw.ball.body.setTransform(Vec2(toM(b.def.x - dir * 40), toM(b.def.y)), 0);
  gw.ball.body.setLinearVelocity(Vec2(dir * 12, 0));
  let touchedAt = -1;
  for (let f = 0; f < 30; f++) {
    gw.step();
    if (touchedAt < 0 && gw.flags.bYesPrize) touchedAt = f;
    if (b.pressedAt !== before) return f - touchedAt;
  }
  throw new Error('ball never reached the button');
}

export function jointErrPx(p: Player): number {
  let max = 0;
  for (const j of p.revolutes) {
    const a = j.getBodyA().getWorldPoint(j.getLocalAnchorA());
    const b = j.getBodyB().getWorldPoint(j.getLocalAnchorB());
    max = Math.max(max, Math.hypot(a.x - b.x, a.y - b.y));
  }
  return toPx(max);
}

const hold = (gw: GameWorld, c: number, on: boolean) => (on ? gw.control.press(c) : gw.control.release(c));

/** Scripted player 1 behaviour, kept well clear of the net. */
export const SCRIPTS: Record<string, (f: number, gw: GameWorld) => void> = {
  idle: () => {},
  pace: (f, gw) => {
    const x = toPx(gw.p1.ass.getWorldCenter().x);
    const right = Math.floor(f / 45) % 2 === 0;
    hold(gw, 39, right && x < 180);
    hold(gw, 37, !right && x > -120);
  },
  hop: (f, gw) => hold(gw, 38, f % 40 === 0),
  crouch: (f, gw) => hold(gw, 40, Math.floor(f / 30) % 2 === 0),
};

/**
 * Run a script for 25 s with (or without) an executer parked beside player 1,
 * and report the worst joint separation and executer/doll penetration.
 */
export function ramScenario(
  script: string,
  withExecuter: boolean,
  tuning?: Partial<ExecuterTuning>,
  contactIterations?: number,
): {
  maxJointPx: number;
  maxPenetrationPx: number;
  contactFrames: number;
  /** Frames with the executer more than 4 px into the doll. */
  deepFrames: number;
  /** Longest unbroken run of such frames. */
  longestDeepRun: number;
  /** Frames with a joint pulled more than 20 px apart. */
  tornFrames: number;
  /** Longest unbroken run of frames with a joint more than 15 px apart. */
  longestTear: number;
} {
  const gw = hazardWorld({ hazards: withExecuter, executerTuning: tuning, contactIterations });
  if (withExecuter) gw.ground.prizeButtons[0].launches = 1; // exercise the original ball variant
  fireAtButton(gw, 1);
  let maxJointPx = 0;
  let maxPenetrationPx = 0;
  let contactFrames = 0;
  let deepFrames = 0;
  let deepRun = 0;
  let longestDeepRun = 0;
  let tornFrames = 0;
  let tearRun = 0;
  let longestTear = 0;
  for (let f = 0; f < 30 * 25; f++) {
    SCRIPTS[script](f, gw);
    gw.step();
    gw.reap();
    const e = gw.executers[0];
    if (f === 20 && e) {
      const h = gw.p1.head.getWorldCenter();
      e.body.setTransform(Vec2(h.x + toM(70), h.y - toM(30)), 0);
    }
    const joint = jointErrPx(gw.p1);
    maxJointPx = Math.max(maxJointPx, joint);
    if (joint > 20) tornFrames++;
    tearRun = joint > 15 ? tearRun + 1 : 0;
    longestTear = Math.max(longestTear, tearRun);
    if (!e || e.dead || !e.solid) continue;
    let touching = false;
    let pen = 0;
    for (let ce = e.body.getContactList(); ce; ce = ce.next) {
      if (!ce.contact.isTouching() || !(ce.other!.getUserData() as { part?: string } | null)?.part) continue;
      touching = true;
      const wm = ce.contact.getWorldManifold(null)!;
      for (let i = 0; i < ce.contact.getManifold().pointCount; i++) {
        pen = Math.max(pen, toPx(-(wm.separations[i] ?? 0)));
      }
    }
    maxPenetrationPx = Math.max(maxPenetrationPx, pen);
    if (touching) contactFrames++;
    deepRun = pen > 4 ? deepRun + 1 : 0;
    if (pen > 4) deepFrames++;
    longestDeepRun = Math.max(longestDeepRun, deepRun);
  }
  return { maxJointPx, maxPenetrationPx, contactFrames, deepFrames, longestDeepRun, tornFrames, longestTear };
}
