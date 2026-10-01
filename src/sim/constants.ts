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
  /** The ball's own impulse is tiny: dv = (sign * 7, -5) m/s on a 0.1 kg ball. */
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
  /** Free balls inside this radius drift toward the striking hand during charge. */
  attractRadiusPx: 110,
  /** Maximum per-frame ball impulse at full charge, faded by distance. */
  attractImpulse: 0.014,
} as const;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Maps a 0..1 charge fraction to the 0..1 impulse scale actually applied. */
export const powerScale = (power: number): number =>
  CHARGE.minPower + (1 - CHARGE.minPower) * clamp01(power);

/**
 * The rally arm swing uses the selected side, flinging its
 * Arm/Hand/Finger together so the whole limb whips forward. At full charge
 * this is a hard smash — enough to knock back an opponent or an executer it
 * connects with; at minimum charge (a tap) it's a light dab.
 */
export const SWING = {
  /** Both hands share a 45-second recovery after each rally swing. */
  cooldownFrames: 45 * FPS,
  fingerImpulseX: 3.4,
  fingerImpulseY: -2.1,
  handImpulseX: 5.8,
  handImpulseY: -3.6,
  armImpulseX: 5.8,
  armImpulseY: -3.6,
  /** Forgiving frontal hit zone, measured from the attacker's head. */
  opponentReachPx: 180,
  opponentHeightPx: 115,
  opponentHitFrames: 11,
  /** Split the knockback between the head rail and hips to protect joints. */
  opponentImpulseX: 7.5,
  opponentImpulseY: -1.1,
  /** Release within two frames of a hand-ball contact for a perfect hit. */
  perfectFrames: 2,
  perfectBallImpulseX: 0.85,
  perfectBallImpulseY: -0.65,
  /** A hand contact during a swing throws an executer away from the player. */
  executerKnockSpeed: 7,
  executerKnockFrames: 14,
  /** Counter window when both players swing beside the net. */
  counterWindowFrames: 2,
  counterNetRangePx: 100,
  counterBallRangePx: 85,
  counterBallHeightPx: 100,
  counterHoldFrames: 3,
  counterBallSpeedX: 12,
  counterBallSpeedY: -9,
} as const;

/**
 * Not in the original. While charging a SWING (never a serve), a small tug
 * away from the opponent and upward, reapplied every held frame and scaled
 * by the charge fraction — so the arm visibly winds up (cocks back) instead
 * of sitting still while the power builds. Tiny relative to SWING: over a
 * full charge it settles the limb back against its joint limits rather than
 * flinging it.
 */
export const WINDUP = {
  fingerImpulseX: 0.18,
  fingerImpulseY: 0.1,
  handImpulseX: 0.14,
  handImpulseY: 0.08,
  armImpulseX: 0.1,
  armImpulseY: 0.06,
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
  /** Explicit, applied after CreateShape, overrides the density (§16.3). */
  mass: 0.1,
  inertia: 0.01,
  /** Four independent clamps in ball.update(), run LAST every frame (§9). */
  maxVx: 15,
  maxVy: 20,
} as const;

/**
 * Not in the original: the ball's bounce off any body part except the head,
 * about 30% less elastic than §9's restitution 1. The head keeps its 1.2.
 */
export const BALL_BODY_RESTITUTION = 0.7;

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

/** A gift appears after every three points and lasts ten real game seconds. */
export const GIFT = {
  goalsPerGift: 3,
  lifeFrames: 10 * FPS,
  powerFrames: 30 * FPS,
  xPx: { 1: 220, 2: 420 },
  yPx: 310,
  pickupRadiusPx: 24,
} as const;

/** Giant and tiny resize the doll this much per frame: 1 → 1.5 takes 13 frames. */
export const SIZE = {
  stepPerFrame: 0.04,
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
  /** §13 spawn points in METRES. Unused since the rework; kept for reference. */
  spawnM: { 1: { x: 3.5, y: -4 }, 2: { x: 17.5, y: -4 } },
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
  /** The x2 lunge fires every Nth second of its life (§13 cadence uncertain). */
  burstEvery: 3,
  /**
   * CCD on. A doll's hands whip past 25 m/s in a jump (31 px a step) and would
   * tunnel 20+ px into a non-bullet executer. The time-of-impact solve does not
   * solve joints, which is what made the 400 kg original tear the doll, but at
   * this mass it measures no worse than the doll alone.
   */
  bullet: true,
  /** Within this many px of a doll part, the step runs EXECUTER_ITERATIONS. */
  nearMarginPx: 40,
  /**
   * Pinning. Within engagePx of any part of its player (edge to centre), an
   * executer stops hunting, starts spinning, and tries to pin them against
   * their half's outer wall — or the ceiling, if it arrives below their
   * shoulders. It lets go beyond releasePx.
   */
  engagePx: 45,
  releasePx: 150,
  /** Speed it drives the player toward the wall at, m/s. */
  pinSpeed: 2.6,
  /** Speed it carries the player up to the ceiling at, m/s (~37 m to go). */
  liftSpeed: 5,
  /** Spin while pinning, rad/s, and the torque cap spinning it up, N·m. */
  spinRate: 14,
  spinTorque: 4,
  /** Head variant: hover beside the target and land a short punch each cycle. */
  headStandOffPx: 50,
  headChaseSpeed: 3.8,
  headPunchReachPx: 62,
  headImpactReachPx: 55,
  headPunchFrames: 24,
  headImpactFrame: 8,
  /** Each punch nudges both the rail-mounted head and the hips. */
  headPunchImpulse: 1.0,
  headPunchRecoilFrames: 10,
  headArmRestPx: 31,
  headArmExtensionPx: 12,
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

/** The champion reads the ball's trajectory and moves before it arrives. */
export const CHAMPION = {
  chaseImpulse: 11,
  aimGain: 3,
  swingReachPx: 85,
  jumpCooldownFrames: 18,
  minHeadXpx: 375,
  maxHeadXpx: 790,
} as const;

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
