/**
 * Every number in this file was transcribed from RAGDOLL-VOLLEYBALL-SPEC.md,
 * which in turn was read out of the original game's AS3 bytecode.
 * Section references (§n) point at that document.
 *
 * UNITS. The original works in stage pixels and divides by PHYS_SCALE to get
 * physics metres. Anything named `*_PX` is stage pixels; everything the physics
 * engine sees is metres. Box2D here is y-DOWN: +y is toward the floor, so a
 * NEGATIVE y impulse pushes a body UP the screen.
 */

// ---------------------------------------------------------------------------
// §3 World
// ---------------------------------------------------------------------------

/** Stage pixels per physics metre (`m_physScale`). */
export const PHYS_SCALE = 30;

/** Gravity, y-down. Note: 10, not 9.81. */
export const GRAVITY = { x: 0, y: 10 };

/** `m_iterations`. Box2DFlash 2.0 had one count; planck splits vel/pos. */
export const ITERATIONS = 10;

/**
 * `m_timeStep` during play: 1/28 s, taken once per 30 fps frame.
 * The game therefore runs ~7% fast against its own clock. Do not "fix" this (§16.5).
 */
export const TIME_STEP = 0.035714;

/** `m_timeStep` during the goal replay (§3). */
export const TIME_STEP_GOAL = 0.005;

/** SWF frame rate; one world Step per ENTER_FRAME. */
export const FPS = 30;

/** Milliseconds of wall clock per simulated frame, used to convert Flash Timers. */
export const MS_PER_FRAME = 1000 / FPS;

/** px -> m */
export const toM = (px: number): number => px / PHYS_SCALE;
/** m -> px */
export const toPx = (m: number): number => m * PHYS_SCALE;

// ---------------------------------------------------------------------------
// §4 Court. `e_bodytype` is the game's own tag, read by the contact rules (§10).
// ---------------------------------------------------------------------------

export const BODYTYPE = {
  PLAYER: 1,
  WALL: 2, // walls and net
  BALL: 3,
  PRIZE: 7,
  GROUND: 15,
  EXECUTER: 777,
} as const;

export type BodyType = (typeof BODYTYPE)[keyof typeof BODYTYPE];

/** Static court geometry, centres and half extents in stage pixels. */
export const COURT = {
  leftWall: { x: -265, y: -230, hw: 50, hh: 650, friction: 0.2, type: BODYTYPE.WALL },
  rightWall: { x: 890, y: -230, hw: 50, hh: 650, friction: 0.2, type: BODYTYPE.WALL },
  ceiling: { x: 320, y: -900, hw: 600, hh: 50, friction: 0.2, type: null },
  ground: { x: 320, y: 405, hw: 600, hh: 50, friction: 0.2, type: BODYTYPE.GROUND },
  // friction 2.5 is what makes dolls stick to the net
  net: { x: 320, y: 281, hw: 1, hh: 75, friction: 2.5, type: BODYTYPE.WALL },
} as const;

/** Derived surfaces you actually use (§4). */
export const FLOOR_TOP_PX = 355;
export const NET_X_PX = 320;
export const NET_TOP_PX = 206;
export const NET_BOTTOM_PX = 356;
export const LEFT_WALL_INNER_PX = -215;
export const RIGHT_WALL_INNER_PX = 840;

/** Spawns (§4). */
export const SPAWN_P1_PX = { x: 100, y: 256 };
export const SPAWN_P2_PX = { x: 500, y: 256 };
export const SPAWN_BALL_PX = { x: 200, y: 20 };

/** Court centre for rules, in METRES (§4). Two different values, both faithful. */
export const SERVE_CENTRE_M = 10.7; // serve legality
export const LANDING_CENTRE_M = 10.6; // which side the ball landed on

// ---------------------------------------------------------------------------
// §5 The ragdoll — 13 bodies.
// Offsets are from the spawn point, in stage pixels. Shapes are HALF extents.
// ---------------------------------------------------------------------------

export interface PartDef {
  name: PartName;
  dx: number;
  dy: number;
  shape: { kind: 'box'; hw: number; hh: number } | { kind: 'circle'; r: number };
  density: number;
  restitution: number;
}

export type PartName =
  | 'HandLeft' | 'HandRight' | 'ArmLeft' | 'ArmRight' | 'Tors' | 'Head'
  | 'FingerLeft' | 'FingerRight' | 'FootLeft' | 'FootRight'
  | 'LegLeft' | 'LegRight' | 'Ass';

/**
 * Naming note (§5): `Arm` is the upper arm, `Hand` is the forearm, `Finger` is
 * the hand, `Leg` is the thigh, `Foot` is the shin-and-foot, `Ass` is the hips.
 * Creation order is the original's — it decides body ordering in the solver.
 */
export const PARTS: readonly PartDef[] = [
  { name: 'HandLeft',    dx: -41, dy: 18, shape: { kind: 'box', hw: 12, hh: 4 },  density: 1,   restitution: 1 },
  { name: 'HandRight',   dx:  41, dy: 18, shape: { kind: 'box', hw: 12, hh: 4 },  density: 1,   restitution: 1 },
  { name: 'ArmLeft',     dx: -22, dy: 18, shape: { kind: 'box', hw: 12, hh: 4 },  density: 1,   restitution: 1 },
  { name: 'ArmRight',    dx:  22, dy: 18, shape: { kind: 'box', hw: 12, hh: 4 },  density: 1,   restitution: 1 },
  { name: 'Tors',        dx:   0, dy: 32, shape: { kind: 'box', hw: 10, hh: 17 }, density: 0.1, restitution: 1 },
  { name: 'Head',        dx:   0, dy:  2, shape: { kind: 'circle', r: 10 },       density: 1,   restitution: 1.2 },
  { name: 'FingerLeft',  dx: -54, dy: 18, shape: { kind: 'box', hw: 4, hh: 4 },   density: 1,   restitution: 1 },
  { name: 'FingerRight', dx:  54, dy: 18, shape: { kind: 'box', hw: 4, hh: 4 },   density: 1,   restitution: 1 },
  { name: 'FootLeft',    dx:  -7, dy: 90, shape: { kind: 'box', hw: 5, hh: 11 },  density: 1,   restitution: 1 },
  { name: 'FootRight',   dx:   7, dy: 90, shape: { kind: 'box', hw: 5, hh: 11 },  density: 1,   restitution: 1 },
  { name: 'LegLeft',     dx:  -7, dy: 69, shape: { kind: 'box', hw: 5, hh: 13 },  density: 1,   restitution: 1 },
  { name: 'LegRight',    dx:   7, dy: 69, shape: { kind: 'box', hw: 5, hh: 13 },  density: 1,   restitution: 1 },
  { name: 'Ass',         dx:   0, dy: 50, shape: { kind: 'box', hw: 10, hh: 6 },  density: 1,   restitution: 1 },
];

/**
 * §5 / §16.2 — friction IS the player id. `game.update` reads the contacting
 * fixture's friction to decide whose touch it was. Do not tidy up the 0.51.
 */
export const PLAYER_FRICTION: Record<1 | 2, number> = { 1: 0.5, 2: 0.51 };

/** §5 Joints — 12 revolute, all with limits enabled. Angles in degrees. */
export interface JointDef {
  a: PartName;
  b: PartName;
  dx: number;
  dy: number;
  lower: number;
  upper: number;
}

/**
 * Body A/B order is the original's and matters: the joint angle is
 * angleB - angleA - referenceAngle, so swapping them mirrors the limits.
 */
export const JOINTS: readonly JointDef[] = [
  { a: 'Tors',        b: 'Head',        dx:   0, dy: 10, lower:  -30, upper:  30 },
  { a: 'Ass',         b: 'Tors',        dx:   0, dy: 45, lower:  -30, upper:  30 },
  { a: 'ArmRight',    b: 'Tors',        dx:  12, dy: 18, lower: -100, upper:  85 },
  { a: 'ArmLeft',     b: 'Tors',        dx: -12, dy: 18, lower:  -85, upper: 100 },
  { a: 'ArmRight',    b: 'HandRight',   dx:  31, dy: 18, lower:  -10, upper: 100 },
  { a: 'ArmLeft',     b: 'HandLeft',    dx: -31, dy: 18, lower: -100, upper:  10 },
  { a: 'FingerRight', b: 'HandRight',   dx:  53, dy: 18, lower:  -10, upper:  40 },
  { a: 'FingerLeft',  b: 'HandLeft',    dx: -53, dy: 18, lower:  -40, upper:  10 },
  { a: 'LegLeft',     b: 'Ass',         dx:  -6, dy: 56, lower:  -30, upper:   3 },
  { a: 'LegRight',    b: 'Ass',         dx:   6, dy: 56, lower:   -3, upper:  30 },
  { a: 'LegRight',    b: 'FootRight',   dx:   6, dy: 80, lower:  -10, upper:  25 },
  { a: 'LegLeft',     b: 'FootLeft',    dx:  -6, dy: 80, lower:  -25, upper:  10 },
];

// ---------------------------------------------------------------------------
// §6 The rails — why the doll stands up
// ---------------------------------------------------------------------------

/** PrismBody sits at (railX, -645) px; railX is the player's spawn x. */
export const PRISM_Y_PX = -645;
export const PRISM_HALF_PX = 1;
export const PRISM_DENSITY = 1;
export const PRISM_FRICTION = 0.1;
export const PRISM_RESTITUTION = 1;

/** Horizontal rail limits, in METRES. These keep each player on their own half. */
export const RAIL_H_LIMITS: Record<1 | 2, { lower: number; upper: number }> = {
  1: { lower: -13, upper: 5.8 },
  2: { lower: -4.4, upper: 14 },
};

/** Vertical rail limits, in METRES, axis (0,-1) from PrismBody to Head. */
export const RAIL_V_LIMITS = { lower: 0.2, upper: 55 };

// ---------------------------------------------------------------------------
// §8 Player actions
// ---------------------------------------------------------------------------

export const ACTIONS = {
  /** jump() only fires when the hips are below this (i.e. grounded), in px. */
  jumpHipsBelowPx: 296,
  /** Magnitude of the normalized Head-minus-Tors impulse in jump(). */
  jumpLeanImpulse: 13,
  /** The flat (0,-4) impulses in jump(). */
  jumpLift: 4,
  /** turn() / turnComp() sideways impulse magnitude. */
  turnImpulse: 4,
  /** Above this head height (px) the doll is "grounded" for turn()/turnComp(). */
  groundedHeadPx: 200,
  /** turnUp() only fires below this head height (px). AI only. */
  turnUpHeadPx: 255,
  /** turnUp() impulse. */
  turnUpImpulse: 1.5,
  /** turnDown() impulse, applied to each foot. */
  turnDownImpulse: 1,
  /** turnHands() lean magnitude. AI only. */
  turnHandsImpulse: 4.5,
} as const;

/** §8 standPlayer(x, y) — the round reset. Offsets in px, all at angle 0. */
export const STAND_POSE: ReadonlyArray<{ name: PartName; dx: number; dy: number }> = [
  { name: 'Head',        dx:   0, dy:  2 },
  { name: 'Tors',        dx:   0, dy: 28 }, // 4 px higher than at construction
  { name: 'ArmRight',    dx:  22, dy: 18 },
  { name: 'ArmLeft',     dx: -22, dy: 18 },
  { name: 'HandRight',   dx:  41, dy: 18 },
  { name: 'HandLeft',    dx: -41, dy: 18 },
  { name: 'FingerRight', dx:  54, dy: 18 },
  { name: 'FingerLeft',  dx: -54, dy: 18 },
  { name: 'Ass',         dx:   0, dy: 47 }, // 3 px higher than at construction
  { name: 'LegLeft',     dx:  -7, dy: 69 },
  { name: 'LegRight',    dx:   7, dy: 69 },
  { name: 'FootLeft',    dx:  -7, dy: 90 },
  // Original bug, faithfully kept: the right foot is placed at -7, same as the
  // left. The parts separate on the next step; harmless.
  { name: 'FootRight',   dx:  -7, dy: 90 },
];

/** §8 takeBall / pas — the serve. */
export const SERVE = {
  /** Ball joint limits, set but NOT enabled. Degrees. */
  ballJointLower: -40,
  ballJointUpper: 40,
  /** Fixed underhand flick for every serve. */
  handImpulseX: 1,
  handImpulseY: -1.5,
  /** The ball's own impulse is tiny: dv = (sign * 7, -5) m/s on the original 0.1 kg ball. */
  ballImpulseX: 0.7,
  ballImpulseY: -0.5,
} as const;

/**
 * The button serves immediately while the ball is held. During a rally, a
 * held button winds up an arm swing; release fires it.
 */
export const CHARGE = {
  /** Frames of hold to reach full power. 24 @ 30 fps ≈ 0.8 s. */
  maxFrames: 24,
  /** Power fraction delivered by a bare tap; scales up to 1 at full charge. */
  minPower: 0.35,
  /** Physics runs at 60% speed while a swing is charging. */
  windupTimeScale: 0.6,
  /** Free balls inside this radius drift toward the kick point during charge. */
  attractRadiusPx: 110,
  /** Maximum per-frame ball impulse at full charge, faded by distance. */
  attractImpulse: 0.014,
} as const;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Maps a 0..1 charge fraction to the 0..1 impulse scale actually applied. */
export const powerScale = (power: number): number =>
  CHARGE.minPower + (1 - CHARGE.minPower) * clamp01(power);

/**
 * The rally attack is a front flip toward the opponent: the doll lunges at
 * the net and spins one full turn, its feet coming over the top and down in
 * front of it. Whatever the
 * legs meet on the way round — the ball, the opponent, an executer — is hit.
 * A fully charged flip hits hard; a tap is a light kick.
 */
export const SWING = {
  /** A 45-second recovery after each rally flip. */
  cooldownFrames: 45 * FPS,
  /** Frontal hit zone for the flip's kick, measured from the attacker's head. */
  opponentReachPx: 225,
  opponentHeightPx: 115,
  /** A kick level with the head counts as a head hit; lower hits only shove. */
  opponentHeadHeightPx: 28,
  /** Split the knockback between the head rail and hips to protect joints. */
  opponentImpulseX: 7.5,
  opponentImpulseY: -1.1,
  /** A leg contact during a flip throws an executer away from the player. */
  executerKnockSpeed: 7,
  executerKnockFrames: 14,
  /** Counter window when both players flip beside the net. */
  counterWindowFrames: 2,
  counterNetRangePx: 100,
  counterBallRangePx: 85,
  counterBallHeightPx: 100,
  counterHoldFrames: 3,
  counterBallSpeedX: 12,
  counterBallSpeedY: -9,
} as const;

/** Head hits leave controls at one fifth of their usual strength for three seconds. */
export const STUN = {
  frames: 3 * FPS,
  controlScale: 0.2,
} as const;

/**
 * Not in the original. The flip itself. The head normally rides a prismatic
 * rail that forbids it to rotate; for the flip that rail is swapped for a
 * wheel joint (same line, free rotation) whose motor keeps the spin going,
 * then swapped back once the doll has come all the way round.
 */
export const FLIP = {
  /** Spin, rad/s. Flailing limbs slow it, so a turn takes about 0.75 s. */
  spin: 17,
  /** The spin eases off over the last part of the turn so it lands upright. */
  easeGain: 9,
  minSpin: 2.5,
  /** Within this of a full turn (rad) the rail locks again. */
  settleRad: 0.06,
  /** Motor torque that keeps a flailing ragdoll turning. */
  maxMotorTorque: 300,
  /** Upward hop, m/s, given to the whole doll at take-off. */
  lift: 8,
  /** Lunge toward the net, m/s, given to the whole doll at take-off. */
  forwardSpeed: 4,
  /** Give up and lock the rail after this many frames, wherever it is. */
  maxFrames: 30,
  /** Where the feet come over and down: this far ahead of and above the head. */
  kickAheadPx: 70,
  kickAbovePx: 55,
  /** Legs and feet are the striking parts. */
  strikingParts: ['FootLeft', 'FootRight', 'LegLeft', 'LegRight'] as const,
  /**
   * Where the legs meet the ball they send it off at this velocity (m/s,
   * toward the opponent), scaled by the charge — whichever way the feet were
   * moving at the time.
   */
  kickSpeedX: 12,
  kickSpeedY: -9,
  /** The opponent counts as hit once the legs have come over the top (rad). */
  opponentFromRad: Math.PI * 1.1,
} as const;

/**
 * Not in the original. While charging a flip (never a serve), the doll tucks:
 * its feet are drawn up and back a little each held frame, scaled by the
 * charge fraction, settling against the joint limits.
 */
export const WINDUP = {
  footImpulseX: 0.06,
  footImpulseY: 0.12,
} as const;

// ---------------------------------------------------------------------------
// §9 Ball
// ---------------------------------------------------------------------------

export const BALL = {
  radiusPx: 15,
  density: 0.1,
  /** The contact listener identifies the ball by this friction value (§10). */
  friction: 0.05,
  restitution: 1,
  /**
   * Explicit, applied after CreateShape, overrides the density (§16.3).
   * Not the original's 0.1 kg / 0.01: 15% heavier, inertia scaled to match.
   */
  mass: 0.115,
  inertia: 0.0115,
  /** Four independent clamps in ball.update(), run LAST every frame (§9). */
  maxVx: 15,
  maxVy: 20,
} as const;

/**
 * Not in the original: the ball's bounce off any body part except the head,
 * about 30% less elastic than §9's restitution 1. The head keeps its 1.2.
 */
export const BALL_BODY_RESTITUTION = 0.7;

/**
 * Not in the original: the ball takes on the jersey colour of whoever touched
 * it last (or holds it to serve), so it is always clear whose ball it is.
 */
export const BALL_TINT = {
  /** Frames the colour takes to change over. */
  fadeInFrames: 4,
  /** How strongly the jersey colour covers the white ball. */
  alpha: 0.82,
} as const;

/** §11.1 — every fresh player touch pops the ball up by 10 m/s. */
export const TOUCH_IMPULSE = { x: 0, y: -1 };

// ---------------------------------------------------------------------------
// §10 Contact rules — ball speed scaling by what it hit
// ---------------------------------------------------------------------------

export const BALL_VX_SCALE_PRIZE = 0.4;
export const BALL_VX_SCALE_WALL = 0.6;

// ---------------------------------------------------------------------------
// §11 Game rules. Flash Timer(delay_ms, repeatCount).
// ---------------------------------------------------------------------------

export const TIMERS = {
  /** Debounce so one hit counts once. */
  contactMs: 200,
  /** Goal replay before the next round. */
  goalMs: 2000,
  /** The six-second serve clock: 1000 ms x 6. */
  delayMs: 1000,
  delayRepeat: 6,
  /** See pas(): contact goes 2 -> 3 after this. */
  serveTouchMs: 50,
  /** AI serve sequencer: 700 ms x 5. */
  aiPasMs: 700,
  aiPasRepeat: 5,
  /** Prize -> executer spawn delay. */
  prizeMs: 2000,
  /** Executer lifetime tick. */
  executerTickMs: 1000,
} as const;

/** §11.3 — contact > 3 hands the point to the opponent. 3 lights the warning. */
export const MAX_TOUCHES = 3;

/** Powers collected from bees last thirty seconds. */
export const POWER = {
  durationFrames: 30 * FPS,
} as const;

/**
 * Bees: gifts on the wing. Every 12–20 s of play one
 * flies in from a screen edge and crosses to the other. The ball meeting one
 * gives its power to whoever holds the ball or touched it last. Frames and
 * world px.
 */
export const BEES = {
  firstFrames: 8 * FPS,
  intervalFrames: { min: 12 * FPS, max: 20 * FPS },
  maxAlive: 2,
  /** A full-size bee's hit radius; the giant and tiny bees scale it. */
  radiusPx: 15,
  /** The flight's centre line: above the net top, below the HUD. */
  altitudePx: { top: -70, bottom: 130 },
  /** Bees start and leave this far beyond the screen edge. */
  edgeMarginPx: 60,
  /** A ball that moved further than this in one frame was reset, not flying. */
  maxSweepPx: 60,
  /** How long a popped bee's burst lasts. */
  popFrames: 18,
} as const;

/** Feather ball: over its holder's half, the free ball falls at this fraction of gravity. */
export const FEATHER = { gravityScale: 0.4 } as const;

/** Giant and tiny resize the doll this much per frame: 1 → 1.5 takes 13 frames. */
export const SIZE = {
  stepPerFrame: 0.04,
  /**
   * Extra jump lift per unit of shrink. At ⅔ size that is ×1.2, which brings
   * the smaller doll's head to the same peak as a full-size jump.
   */
  shrunkJumpBoost: 0.6,
} as const;

// ---------------------------------------------------------------------------
// §13 Hazards
// ---------------------------------------------------------------------------

/**
 * Prize buttons: two static targets at the far left and right. Pixels.
 * `side` is the half of the court the button sits on — the side its
 * executer launches into.
 */
export const PRIZE_BUTTONS = [
  { x: -211, y: -245, hw: 3, hh: 35, friction: 0.4, side: 1 },
  { x: 837, y: -245, hw: 3, hh: 35, friction: 0.4, side: 2 },
] as const;

/**
 * The hazard, reworked from §13. A ball on a button launches an executer at
 * once, out of that button, into that button's half — rather than §13's
 * "2 s after the rally, against whoever lost it".
 */
export const EXECUTER = {
  radiusPx: 18, // = 0.6 m
  friction: 0.3,
  density: 1,
  restitution: 1,
  /**
   * §13 sets 400 kg. Against a ~2.75 kg doll that tears the ragdoll's joints
   * apart in any iterative solver (measured: 36 px of joint separation where
   * the doll alone shows 4). This mass still makes it 60x the ball — shots
   * bounce off it like a wall — while the doll's joints and rails hold.
   */
  mass: 6,
  inertia: 0.1,
  /**
   * Steering is a bounded force toward §13's target velocity, not a velocity
   * overwrite. An overwrite makes it unstoppable: it crushes the doll into its
   * rail limits. Newtons.
   */
  maxForce: 45,
  /** Speed it is fired out of the button at, m/s. */
  launchSpeed: 6,
  /**
   * Frames it stays a sensor after launch. The ball has just bounced off the
   * button it comes out of, and spawning a solid body inside the ball would
   * fling it. It turns solid once this has passed and it overlaps nothing.
   */
  emergeFrames: 6,
  /**
   * CCD on. A doll's hands whip past 25 m/s in a jump (31 px a step) and would
   * tunnel 20+ px into a non-bullet executer. The time-of-impact solve does not
   * solve joints, which is what made the 400 kg original tear the doll, but at
   * this mass it measures no worse than the doll alone.
   */
  bullet: true,
  /** Within this many px of a doll part, the step runs EXECUTER_ITERATIONS. */
  nearMarginPx: 40,
} as const;

/**
 * Magnet: the slowest hunter, with a strong field. Its player is dragged
 * toward it, their arms reach for it, and a free ball curves in. Once it
 * touches them it latches and holds still, so they have to fight their way
 * clear or knock it off with a swing.
 */
export const MAGNET = {
  /** Reach of the field, px from its centre to the doll's centre of mass. */
  fieldPx: 240,
  /**
   * Sideways pull on the whole doll at point blank, m/s², fading linearly to
   * zero at the edge. Every part gets the same acceleration, so the field
   * moves the doll without stretching it. Horizontal only: lifting the doll
   * toward a magnet that hovers at its chest would carry it up off the floor.
   */
  playerPull: 30,
  /** Extra pull on the hands and fingers, so the arms visibly reach for it. */
  handPull: 22,
  /**
   * Pull on a free ball at point blank, as a multiple of the ball's own
   * gravity. Its upward part is capped below gravity (ballLiftMax), so it can
   * bend a ball's flight hard but never hold one up and stall the rally.
   */
  ballPull: 1.6,
  ballLiftMax: 0.5,
  /** It latches on contact and lets go once its player is this far clear, px. */
  releasePx: 34,
} as const;

/**
 * Comet: the fastest hunter. It circles to a run-up point on the side of its
 * player nearest the ball, then dashes through them, knocking them away from
 * where they need to be. It glances off, brakes, and lines up again.
 */
export const COMET = {
  /** Speed it circles to its run-up point at, m/s. Faster than anything else hunts. */
  stalkSpeed: 9,
  /** Force budget while lining up, N: it turns on a dime. */
  stalkForce: 160,
  /** The run-up point: this far to the side of its player, px, and this far up. */
  runUpPx: 150,
  runUpRisePx: 12,
  /** With less room than this to that side (a wall), it rams from the other side. */
  minRunUpPx: 80,
  /** Clearance it keeps over the head when crossing to the other side, px. */
  overheadPx: 95,
  /** Gives up lining up after this long and dashes from where it is. */
  maxStalkFrames: 75,
  /** Dash: top speed, m/s, and the force budget getting there, N. */
  dashSpeed: 16,
  dashForce: 380,
  /** Fraction of each frame's steer that goes toward the target mid-dash. */
  dashHoming: 0.12,
  dashFrames: 24,
  /**
   * Knock at full dash speed: the whole doll's change of speed, m/s, and the
   * extra jolt to the part it struck.
   */
  knockSpeed: 5,
  knockJolt: 4,
  /** Upward share of the knock. */
  knockLift: 0.25,
  /** Frames the player stumbles and cannot steer after a hit. */
  stumbleFrames: 12,
  /** After a dash it brakes for this long before lining up again. */
  recoverFrames: 10,
  brakeForce: 160,
} as const;

/**
 * Spring: it charges its player, building speed the whole way, and slams
 * into them. The longer and faster the run, the harder the push and the
 * harder it rebounds itself. It flies back, brakes gradually, settles, then
 * charges again.
 */
export const SPRING = {
  /** Acceleration while charging, m/s², and the speed it tops out at. */
  accel: 8,
  topSpeed: 11,
  /** A run this long counts in full toward the impact, px. */
  fullTravelPx: 320,
  /** Impact strength: mostly the speed it reached, partly the distance run. */
  speedShare: 0.65,
  /**
   * Push at full strength: the whole doll's change of speed, m/s, and the
   * extra jolt to the part it struck.
   */
  pushSpeed: 8,
  pushJolt: 4,
  pushLift: 0.3,
  /** Stumble frames at full strength. */
  stumbleFrames: 16,
  /** It rebounds at this fraction of its impact speed, plus a minimum, m/s. */
  reboundScale: 0.6,
  reboundMin: 3,
  /** Free flight after the rebound, frames at full strength. */
  reboundFrames: 8,
  /** Then it brakes at this rate, m/s², and recovers this many frames at least. */
  brake: 14,
  recoverFrames: 24,
  /** Speed it rises or sinks at to line up with its player's chest, m/s. */
  settleSpeed: 6,
} as const;

/**
 * Boxer: it hovers a fist's length from one part of its player and throws
 * jabs, picking a new part — head, body, an arm, a leg, a foot — after every
 * blow that lands.
 */
export const BOXER = {
  standOffPx: 48,
  chaseSpeed: 4,
  punchReachPx: 62,
  impactReachPx: 56,
  punchFrames: 22,
  impactFrame: 8,
  /** Each blow shoves the whole doll a little, m/s... */
  punchSpeed: 0.75,
  /** ...and jolts the part it lands on, m/s. */
  partJolt: 6,
  recoilFrames: 10,
  /** The boxer rocks back off each blow, N·s. */
  recoilImpulse: 2,
  armRestPx: 31,
  armExtensionPx: 14,
} as const;

/**
 * Slime: a glob of glue. It flies at one of its player's limbs and sticks to
 * whatever part it reaches first, weighing it down. Stuck, it reels the
 * nearest part of another limb in on a strand and glues it into itself, two
 * at most, so a hand ends up stuck to the other hand, a leg or the head.
 *
 * The glue is a capped spring, not a joint: a joint welding a 0.07 kg hand to
 * a leg fights the doll's own joint limits and tears it. Strain hard enough
 * (a jump, a knock) and a strand stretches and snaps, which also shortens how
 * long the slime holds on. A swing that reaches it flings it off; otherwise
 * it lets go by itself, re-forms and flies in again.
 */
export const SLIME = {
  /** Flight speed, m/s, the force budget getting there, N, and a bob across its path. */
  flySpeed: 4.5,
  flyForce: 90,
  bobSpeed: 1.4,
  bobFrames: 16,
  /** The glob's weight on the part it is stuck to, N. */
  weight: 3,
  /** Frames after it sticks before it reaches for a second part. */
  gripFrames: 8,
  /** It reels in the nearest part it can glue within this, px... */
  reelReachPx: 110,
  /**
   * ...drawing the two together at up to this speed, m/s, with at most this
   * force, N: enough to lift a hanging arm (~5 N) up to a slime on the head.
   */
  reelSpeed: 3,
  reelForce: 8,
  /** ...and gives up on one it can't bring in after this many frames. */
  reelFrames: 45,
  /** Parts it glues at once, besides the one it is stuck to... */
  maxBonds: 2,
  /** ...once one comes within this of the glue's core, px. */
  glueReachPx: 12,
  /**
   * Glue spring: closes the gap at this rate, 1/s, with at most this force,
   * N. Measured: at this strength a doll glued hand to thigh stretches its
   * joints no more on landings and wall hits than it does on its own.
   */
  glueRate: 5,
  glueForce: 10,
  /** The glue cures from the gap it caught at down to this one, px, at this rate, px a frame. */
  glueRestPx: 3,
  cureRatePx: 1.5,
  /** Stretched this far past its rest length, a strand snaps, px. */
  breakPx: 24,
  /** A part that tore free can't be glued again for this long, frames. */
  regrabFrames: 30,
  /** It holds on this long, frames. Every strand snapped takes `snapCostFrames` off. */
  holdFrames: 6 * 30,
  snapCostFrames: 45,
  /** Letting go, it springs clear at this, m/s, then brakes and re-forms before the next flight. */
  peelSpeed: 3,
  recoverFrames: 30,
  brakeForce: 60,
} as const;

/**
 * Solver iterations for a step with an executer at a doll. The original's 10
 * everywhere else. Measured: with this, a doll rammed by an executer tears no
 * more than one standing, pacing, hopping or crouching alone.
 */
export const EXECUTER_ITERATIONS = 20;

/** Friction between an executer and a doll (executer 0.3, doll 0.5 would mix to 0.39). */
export const EXECUTER_DOLL_FRICTION = 0.05;

/**
 * Collision filtering. The original has none (§16.4) and every original body
 * keeps the defaults. The only filtered body is new: a barrier above the net
 * that stops executers — and nothing else — crossing to the other half.
 */
export const COLLISION = {
  DEFAULT: 0x0001,
  EXECUTER_BARRIER: 0x0002,
  EXECUTER: 0x0004,
} as const;

/** The executer-only barrier: from the net top up to the ceiling. Pixels. */
export const EXECUTER_BARRIER = { x: 320, top: -850, bottom: 206, hw: 1 } as const;

/** Button animation and timing, in frames (30 per second). */
export const PRIZE_ANIM = {
  /** How far the face sinks into the wall when pressed, world px. */
  pressDepthPx: 5,
  /** Frames the press takes to bottom out. */
  pressFrames: 3,
  /** Frames the pop back out takes. */
  releaseFrames: 9,
  /** With hazards off the button still clicks, then pops back after this. */
  momentaryFrames: 15,
  /** Contacts closer together than this are the same hit (one launch). */
  hitDebounceFrames: 6,
} as const;

// ---------------------------------------------------------------------------
// §14 Defaults (`options`)
// ---------------------------------------------------------------------------

export const OPTIONS = {
  /** Points to win a match. */
  gameSet: 10,
  AImaxSpeed: 7,
  myExLife: 25,
  compExLife: 25,
  myExSpeed: 1.3,
  compExSpeed: 1.3,
  soundVol: 1,
  musicVol: 1,
  quality: 0,
  Shadows: true,
  /** The sixth opponent is the champion challenge. */
  currentLevel: 1,
  maxLevel: 6,
  championLevel: 6,
} as const;

/**
 * The CPU player, every level. It reads the ball's flight, picks the touch
 * that is hardest for the opponent to answer (a drop into the strip by the
 * net no head can reach, a deep corner, a ball away from them) and gets there
 * first. It builds attacks over two touches: a set to itself by the net,
 * then a jump attack or a wound-up smash. BOT_LEVELS sets how well it does
 * each. Distances are px, in its own frame (itself on the right of the net).
 */
export const BOT = {
  /** Where it waits while the ball is on the other side. */
  readyXpx: 520,
  /** Its rail stops the head this close to the net. */
  minHeadXpx: 372,
  /** Head centre at rest at full size, and the head's radius. */
  headRestPx: 258,
  headRadiusPx: 10,
  /** How far ahead the flight forecast looks, frames. */
  horizonFrames: 120,
  /** Contact angles tried; positive is the net side of the head. Past ~45° the arm takes it. */
  minAngleDeg: -30,
  maxAngleDeg: 46,
  angleStepDeg: 2,
  /**
   * Fitted to real head contacts in play (median error 1.7 m/s): the head
   * rides a soft rail and gives way, so the ball comes off it at about
   * restitution 0.8, not the fixtures' 1.2.
   */
  headBounce: 0.8,
  /** Box2D mixes friction as sqrt(ball 0.05 × doll 0.5). */
  headFriction: Math.sqrt(0.05 * 0.5),
  /** A shot must land at least this far past the net. */
  netMarginPx: 12,

  /**
   * How it reads the opponent, as an ordinary defender: this many frames to
   * react to a shot, then this fast to the ball, px per frame. A real reply
   * also needs the head placed, so a shot it reaches with less than
   * `spareFrames` to spare still counts as partly winning.
   */
  oppReactFrames: 8,
  oppStepPx: 10,
  spareFrames: 45,
  /** The opponent's rail stops their head this far from the net, px. */
  oppNetGapPx: 50,
  /** A ball coming down this close to the opponent's back wall pins them there, px. */
  deepPx: 90,
  /** What makes a shot hard to answer. */
  threat: { reach: 0.7, deadZone: 0.6, deep: 0.3, pace: 0.2, drive: 0.4 },
  /**
   * A hard ball is harder to place. Its aim error grows by up to `deg` (less
   * its composure) with how fast the ball comes in flat, m/s, and with
   * `hurry`: the fraction of its top speed it needs to get there in time.
   * Measured before this, a defender lost 5–8% of possessions whatever the
   * ball did; the long, floaty flights let it reach everything.
   */
  pressure: { deg: 30, drive: 0.5, driveFromMs: 3, driveRangeMs: 8, hurry: 0.6, hurryFrom: 0.4, hurryRange: 0.5 },
  /** A shot that clears the net by this much counts as fully safe, px. */
  safeClearancePx: 90,
  /**
   * Small preferences: a central contact on the head, and getting there in
   * time. Past `steepFromDeg` the bounce model drifts (median error 1.8 m/s at
   * 40°, 4 m/s at 50°, against 0.7 m/s at 10°), so steep contacts cost more.
   */
  anglePenalty: 0.004,
  steepFromDeg: 30,
  steepPenalty: 0.02,
  latePenaltyPerPx: 0.02,
  /**
   * The head meets the ball a median 7° from where it meant to, so each shot
   * is scored with its neighbours this many degrees either side. A neighbour
   * that hits the net or lands on its own side counts as `failValue`; one
   * that stays up on its own side, with a touch to spare, as `recoverValue`.
   */
  robustDeg: 6,
  failValue: -0.5,
  recoverValue: -0.1,
  /** How much of failValue a fully aggressive level ignores. */
  riskAppetite: 0.7,
  /**
   * Each shot is also replayed leaving the head this much off in speed, m/s,
   * both ways, plus this much per degree of contact angle.
   */
  modelErrMs: 1,
  modelErrPerDeg: 0.04,
  /** A shot still in the air after this many frames is a moonball: it costs this much per frame. */
  hangFrames: 75,
  hangPenalty: 0.006,
  /**
   * The screen shows the court up to y ≈ -320. Every touch adds 10 m/s of
   * lift, so a rally of square headers climbs until each ball tops out
   * off-screen; an angled touch turns that fall into a low, hard drive. A shot
   * peaking above `apexFreePx` costs this much per 100 px higher.
   */
  apexFreePx: -100,
  apexPenaltyPer100Px: 0.2,

  /**
   * A set: a touch that stays on its own side and comes back down where it
   * can attack from. It must come down at least `setMinFrames` later,
   * ideally this far from the net, px.
   */
  setMinFrames: 22,
  setNearNetPx: [30, 150],
  /** A set hanging in the air longer than this slows the game: it costs this much per frame. */
  setHangFrames: 45,
  setHangPenalty: 0.008,
  /** A set ball is worth its best attack, discounted for the extra touch. */
  setDiscount: 0.92,
  /** Value of a set by the net beyond the header (the smash and jump it allows). */
  setNetBonus: 0.12,
  /** With a set in mind, take one that is worth at most this much less than the best shot... */
  setTolerance: 0.25,
  /** ...if it comes down at least this well placed (0..1, see setNearNetPx). */
  setMinNear: 0.4,
  /** Ply-two forecasts use this coarser angle step. */
  setAngleStepDeg: 4,

  /** A ball coming down within this far of the net and this upright can be attacked. */
  attackNetPx: 160,
  attackMaxVx: 6,
  /**
   * Smash: the CPU stands with a ball dropping this far ahead of and below
   * the head and kicks it over with a ~0.45 flip. Full-size px; negative
   * "below" is above the head.
   */
  smash: { aheadPx: 30, belowPx: -10, power: 0.45, windupFrames: 10 },
  /**
   * Jump attack: with the ball dropping ~40 px on the net side of the head,
   * the net-side arm rises into it 6–14 frames into a jump and bats it over.
   * It jumps when the ball will be `leadRisePx` above its standing head in
   * `leadFrames`.
   */
  jump: { aheadPx: 40, leadFrames: 10, leadRisePx: 117, windowFrames: 2 },
  /** A ball it cannot get its head under in time, it lunges at with a light flip. */
  lunge: { latePx: 24, power: 0.35 },
  /**
   * The flip's kick zone: the feet come over and down through this box in
   * front of and above the head 9–17 frames after take-off, so the CPU flips
   * when the ball will be in it `leadFrames` from now. Full-size px;
   * negative "below" is above.
   */
  flipZone: { leadFrames: 13, aheadPx: [40, 120], belowPx: [-85, -25] },

  /** Steering: turnComp moves the head ~1.4 px per frame per unit impulse. */
  pxPerImpulse: 1.4,
  deadbandPx: 1.5,
  /** With three touches spent, keep this far from where the ball comes down. */
  dodgePx: 90,
  /**
   * Serving: it walks to its spot at this pace, px per frame, to within
   * `serveArrivePx`, then waits until head and hips are slower than
   * `serveStillMs` for `serveSettleFrames` before jumping. After
   * `serveMaxWalkFrames` it serves from wherever it is.
   */
  serveStepPx: 8,
  serveArrivePx: 6,
  serveStillMs: 0.4,
  serveSettleFrames: 4,
  serveMaxWalkFrames: 50,
} as const;

/** How well each level plays. Level 6 is the champion. */
export interface BotSkill {
  /** Top head speed while steering, px per frame. */
  stepPx: number;
  /** Frames before it reacts to the opponent's touch. */
  reactFrames: number;
  /** Spread of its aim, degrees of head-contact angle. */
  aimErrorDeg: number;
  /** 0 plays it safe, 1 plays every ball for the winner. */
  aggression: number;
  /** Net clearance it insists on, px. */
  netClearancePx: number;
  /** Chance it builds the attack with a set when it has the touches. */
  setChance: number;
  /** Chance it attacks a ball up at the net with a jump. */
  jumpChance: number;
  /** Chance it smashes a ball up at the net when its swing is ready. */
  smashChance: number;
  /** Lunges at balls out of its head's reach with a swing. */
  lunges: boolean;
  /** How far its waiting spot wanders, px. */
  readyJitterPx: number;
  /**
   * Reading the opponent's shot: its first guess at the ball's speed is off
   * by up to this much, m/s, and the error fades out over this many frames.
   * A perfect reader reaches everything; every touch sends the ball up at
   * 10 m/s or more, so each shot hangs for two seconds or longer.
   */
  readErrMs: number;
  readFrames: number;
  /** 0..1: how little a hard or hurried ball throws its aim (see BOT.pressure). */
  composure: number;
}

export const BOT_LEVELS: Record<number, BotSkill> = {
  1: {
    stepPx: 8, reactFrames: 9, aimErrorDeg: 13, aggression: 0.3, netClearancePx: 44,
    setChance: 0.15, jumpChance: 0.25, smashChance: 0.25, lunges: false, readyJitterPx: 40, readErrMs: 3.5, readFrames: 70, composure: 0.1,
  },
  2: {
    stepPx: 9, reactFrames: 7, aimErrorDeg: 10, aggression: 0.45, netClearancePx: 38,
    setChance: 0.25, jumpChance: 0.35, smashChance: 0.35, lunges: false, readyJitterPx: 35, readErrMs: 3, readFrames: 64, composure: 0.25,
  },
  3: {
    stepPx: 10, reactFrames: 5, aimErrorDeg: 8, aggression: 0.6, netClearancePx: 32,
    setChance: 0.35, jumpChance: 0.45, smashChance: 0.45, lunges: true, readyJitterPx: 30, readErrMs: 2.6, readFrames: 58, composure: 0.4,
  },
  4: {
    stepPx: 11, reactFrames: 4, aimErrorDeg: 6, aggression: 0.72, netClearancePx: 26,
    setChance: 0.45, jumpChance: 0.55, smashChance: 0.6, lunges: true, readyJitterPx: 25, readErrMs: 2.2, readFrames: 52, composure: 0.5,
  },
  5: {
    stepPx: 12, reactFrames: 2, aimErrorDeg: 4, aggression: 0.85, netClearancePx: 20,
    setChance: 0.5, jumpChance: 0.65, smashChance: 0.7, lunges: true, readyJitterPx: 20, readErrMs: 1.9, readFrames: 46, composure: 0.6,
  },
  6: {
    stepPx: 13, reactFrames: 0, aimErrorDeg: 1.5, aggression: 1, netClearancePx: 16,
    setChance: 0.55, jumpChance: 0.7, smashChance: 0.8, lunges: true, readyJitterPx: 15, readErrMs: 1.6, readFrames: 40, composure: 0.7,
  },
};

export const botSkill = (level: number): BotSkill =>
  BOT_LEVELS[Math.min(OPTIONS.maxLevel, Math.max(1, Math.round(level)))];

// ---------------------------------------------------------------------------
// §15 Rendering transform
// ---------------------------------------------------------------------------

/** The whole world sprite is scaled 0.56 and placed at (124, 180) on 640x400. */
export const VIEW = {
  scale: 0.56,
  offsetX: 124,
  offsetY: 180,
  stageW: 640,
  stageH: 400,
} as const;

/**
 * §13 Artwork bounds. The colliders are deliberately smaller than the art; a
 * doll drawn at collider size reads as long-armed and short-legged. Pixels.
 */
export const ART: Record<string, { w: number; h: number }> = {
  Head:        { w: 21.1, h: 21.6 },
  Tors:        { w: 23.4, h: 42.3 },
  Ass:         { w: 26.5, h: 17.5 },
  ArmLeft:     { w: 27.9, h: 9.9 },
  ArmRight:    { w: 27.9, h: 9.9 },
  HandLeft:    { w: 24.3, h: 8.1 },
  HandRight:   { w: 24.3, h: 8.1 },
  FingerLeft:  { w: 16.4, h: 14.4 },
  FingerRight: { w: 16.4, h: 14.4 },
  LegLeft:     { w: 13, h: 35 },
  LegRight:    { w: 13, h: 35 },
  FootLeft:    { w: 8.9, h: 33.7 },
  FootRight:   { w: 8.9, h: 33.7 },
  Ball:        { w: 31.4, h: 28.8 },
};

export const DEG = Math.PI / 180;
