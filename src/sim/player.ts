import {
  Box, Circle, PrismaticJoint, RevoluteJoint, Vec2,
  type Body, type RevoluteJoint as RevoluteJointT, type Vec2Value, type World,
} from 'planck';
import {
  ACTIONS, BODYTYPE, clamp01, DEG, FLOOR_TOP_PX, JOINTS, PARTS, PLAYER_FRICTION, powerScale,
  PRISM_DENSITY, PRISM_FRICTION, PRISM_HALF_PX, PRISM_RESTITUTION, PRISM_Y_PX,
  RAIL_H_LIMITS, RAIL_V_LIMITS, SERVE, SIZE, SPAWN_P1_PX, SPAWN_P2_PX, STAND_POSE,
  SWING, toM, type JointDef, type PartName, WINDUP,
} from './constants';
import type { BodyUserData } from './types';
import type { PowerId } from './powerUps';

export type PlayerId = 1 | 2;
export type SwingHand = 'outside' | 'inside';

const PART_DEFS = new Map(PARTS.map((p) => [p.name, p]));

const norm = (v: Vec2): Vec2 => {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len < 1e-9) return Vec2(0, 0);
  return Vec2(v.x / len, v.y / len);
};

/**
 * §5, §6, §8. Thirteen bodies, twelve revolute joints, and the two prismatic
 * rails that make the doll hang rather than balance.
 */
export class Player {
  readonly id: PlayerId;
  readonly parts = new Map<PartName, Body>();
  readonly bodies: Body[] = [];
  /** The sensor body that rides the horizontal rail (§6). */
  readonly prismBody: Body;
  readonly railH: PrismaticJoint;
  readonly railV: PrismaticJoint;
  readonly revolutes: RevoluteJointT[] = [];

  /** Consecutive touches this rally. > 3 gives the point away (§11.3). */
  contact = 0;
  /** Debounce flag, cleared by a 200 ms timer (§11). */
  bContact = false;
  /** A short lateral stumble after an executer-head punch. */
  recoilFrames = 0;
  power: PowerId | null = null;
  /** Current collision scale. Eases toward targetScale in tickSize(). */
  sizeScale = 1;
  targetScale = 1;

  private readonly world: World;
  private ballJoint: RevoluteJointT | null = null;

  constructor(
    world: World,
    /** The world's shared static ground body — the original's GetGroundBody(). */
    groundBody: Body,
    xPx: number,
    yPx: number,
    id: PlayerId,
  ) {
    this.world = world;
    this.id = id;
    const friction = PLAYER_FRICTION[id];

    // --- §5 the 13 bodies, in the original's creation order ------------------
    for (const p of PARTS) {
      const body = world.createBody({
        type: 'dynamic',
        position: Vec2(toM(xPx + p.dx), toM(yPx + p.dy)),
        angularDamping: 0,
        linearDamping: 0,
      });
      body.createFixture({
        shape:
          p.shape.kind === 'box'
            ? Box(toM(p.shape.hw), toM(p.shape.hh))
            : Circle(toM(p.shape.r)),
        density: p.density,
        // Friction is the player's identity (§5, §16.2).
        friction,
        restitution: p.restitution,
      });
      body.resetMassData(); // the original's SetMassFromShapes()
      const data: BodyUserData = {
        e_bodytype: BODYTYPE.PLAYER,
        part: p.name,
        playerId: id,
        sprite: p.name,
      };
      body.setUserData(data);
      this.parts.set(p.name, body);
      this.bodies.push(body);
    }

    // --- §5 the 12 revolute joints, all with limits enabled ------------------
    // The reference angle is whatever the pose is at creation (arms out
    // horizontally), so limits are relative to the spawn pose.
    for (const j of JOINTS) {
      const bodyA = this.part(j.a);
      const bodyB = this.part(j.b);
      const anchor = Vec2(toM(xPx + j.dx), toM(yPx + j.dy));
      this.revolutes.push(
        world.createJoint(
          new RevoluteJoint(
            {
              enableLimit: true,
              lowerAngle: j.lower * DEG,
              upperAngle: j.upper * DEG,
              enableMotor: false,
              maxMotorTorque: 0,
              motorSpeed: 0,
            },
            bodyA,
            bodyB,
            anchor,
          ),
        )!,
      );
    }

    // --- §6 the rails --------------------------------------------------------
    // A tiny sensor body, ~0.004 kg, i.e. negligible next to the doll.
    this.prismBody = world.createBody({
      type: 'dynamic',
      position: Vec2(toM(xPx), toM(PRISM_Y_PX)),
      fixedRotation: true,
      angularDamping: 0,
      linearDamping: 0,
    });
    this.prismBody.createFixture({
      shape: Box(toM(PRISM_HALF_PX), toM(PRISM_HALF_PX)),
      density: PRISM_DENSITY,
      friction: PRISM_FRICTION,
      restitution: PRISM_RESTITUTION,
      isSensor: true, // so it never collides with anything
    });
    this.prismBody.resetMassData();
    this.prismBody.setUserData({ e_bodytype: null, playerId: id } as BodyUserData);

    // Horizontal rail: world's static ground body <-> PrismBody, axis (1,0).
    // The limits are what keep each player on their own half; both stop just
    // short of the net.
    const hl = RAIL_H_LIMITS[id];
    this.railH = world.createJoint(
      new PrismaticJoint(
        {
          enableLimit: true,
          lowerTranslation: hl.lower,
          upperTranslation: hl.upper,
          enableMotor: false, // §16.6 — the rails constrain, they never drive
          maxMotorForce: 0,
          motorSpeed: 0,
        },
        groundBody,
        this.prismBody,
        this.prismBody.getWorldCenter(),
        Vec2(1, 0),
      ),
    )!;

    // Vertical rail: PrismBody <-> Head, axis (0,-1), limits [0.2, 55] m.
    // A prismatic joint locks relative rotation, so with PrismBody at fixed
    // rotation the head can never rotate; and the horizontal rail locks
    // PrismBody's y, so the head only ever moves along one vertical line.
    this.railV = world.createJoint(
      new PrismaticJoint(
        {
          enableLimit: true,
          lowerTranslation: RAIL_V_LIMITS.lower,
          upperTranslation: RAIL_V_LIMITS.upper,
          enableMotor: false,
          maxMotorForce: 0,
          motorSpeed: 0,
        },
        this.prismBody,
        this.part('Head'),
        this.part('Head').getWorldCenter(),
        Vec2(0, -1),
      ),
    )!;
  }

  part(name: PartName): Body {
    const b = this.parts.get(name);
    if (!b) throw new Error(`no such part: ${name}`);
    return b;
  }

  get head(): Body { return this.part('Head'); }
  get tors(): Body { return this.part('Tors'); }
  get ass(): Body { return this.part('Ass'); }
  get attackFactor(): number { return this.power === 'smash' ? 1.8 : 1; }
  private get massFactor(): number { return this.sizeScale * this.sizeScale; }

  /**
   * Set the size the doll grows or shrinks toward. `immediate` snaps instead,
   * which is only safe when the doll is re-stood straight after.
   */
  resizeTo(scale: number, immediate = false): void {
    this.targetScale = scale;
    if (immediate) this.setSizeScale(scale);
  }

  /**
   * One step of easing toward targetScale. Growing in one jump teleports a
   * limb straight through the 2 px net; small steps let the solver push it
   * back out on the correct side.
   */
  tickSize(): void {
    if (this.sizeScale === this.targetScale) return;
    const step = SIZE.stepPerFrame;
    this.setSizeScale(this.sizeScale < this.targetScale
      ? Math.min(this.targetScale, this.sizeScale + step)
      : Math.max(this.targetScale, this.sizeScale - step));
  }

  /** Resize the actual ragdoll fixtures and joint anchors around its feet. */
  setSizeScale(scale: number): void {
    if (scale === this.sizeScale) return;
    const ratio = scale / this.sizeScale;
    const left = this.part('FootLeft').getWorldCenter();
    const right = this.part('FootRight').getWorldCenter();
    // Keep the rail-mounted head on its horizontal line while the soles keep
    // their height; scaling around the feet in x would pull the head off rail.
    const pivot = Vec2(this.head.getWorldCenter().x, (left.y + right.y) / 2 + toM(11 * this.sizeScale));
    const transform = (p: Vec2Value) => Vec2(pivot.x + (p.x - pivot.x) * ratio, pivot.y + (p.y - pivot.y) * ratio);
    const referenceAngles = this.revolutes.map((joint) => joint.getReferenceAngle());
    for (const joint of this.revolutes) this.world.destroyJoint(joint);
    this.revolutes.length = 0;

    for (const def of PARTS) {
      const body = this.part(def.name);
      const fixture = body.getFixtureList()!;
      body.destroyFixture(fixture);
      const s = scale;
      body.createFixture({
        shape: def.shape.kind === 'box'
          ? Box(toM(def.shape.hw * s), toM(def.shape.hh * s))
          : Circle(toM(def.shape.r * s)),
        density: def.density,
        friction: PLAYER_FRICTION[this.id],
        restitution: def.restitution,
      });
      body.resetMassData();
      body.setTransform(transform(body.getWorldCenter()), body.getAngle());
    }

    // Anchors come from the joint table, not the current pose: a joint that
    // is stretched mid-jump would otherwise bake the stretch into the
    // skeleton, and it would accumulate with every resize.
    const localAnchor = (name: PartName, def: JointDef) => {
      const part = PART_DEFS.get(name)!;
      return Vec2(toM((def.dx - part.dx) * scale), toM((def.dy - part.dy) * scale));
    };
    JOINTS.forEach((def, i) => {
      this.revolutes.push(this.world.createJoint(new RevoluteJoint({
        bodyA: this.part(def.a),
        bodyB: this.part(def.b),
        localAnchorA: localAnchor(def.a, def),
        localAnchorB: localAnchor(def.b, def),
        enableLimit: true,
        lowerAngle: def.lower * DEG,
        upperAngle: def.upper * DEG,
        referenceAngle: referenceAngles[i],
        enableMotor: false,
        maxMotorTorque: 0,
        motorSpeed: 0,
      }))!);
    });
    this.sizeScale = scale;
    if (this.ballJoint) {
      this.ballJoint.getBodyB().setTransform(this.servingFinger.getWorldCenter(), 0);
    }
  }
  /** The hand that holds the ball: right for player 1, left for player 2. */
  get servingFinger(): Body {
    return this.id === 1 ? this.part('FingerRight') : this.part('FingerLeft');
  }
  /** The outside hand winds up and swings across the body. */
  get strikingFinger(): Body {
    return this.id === 1 ? this.part('FingerLeft') : this.part('FingerRight');
  }

  swingSide(hand: SwingHand): 'Left' | 'Right' {
    return (this.id === 1) === (hand === 'outside') ? 'Left' : 'Right';
  }

  swingFinger(hand: SwingHand): Body {
    return this.part(`Finger${this.swingSide(hand)}`);
  }

  // -------------------------------------------------------------------------
  // §8 Player actions. Exact, in the original's order.
  //
  // Box2D's ApplyImpulse(impulse, point) adds the FULL linear impulse
  // regardless of the point; the point only contributes torque. jump() leans
  // on this.
  // -------------------------------------------------------------------------

  jump(): void {
    const ass = this.ass;
    // Only when the hips are low, i.e. grounded.
    const threshold = FLOOR_TOP_PX - (FLOOR_TOP_PX - ACTIONS.jumpHipsBelowPx) * this.sizeScale;
    if (!(ass.getWorldCenter().y > toM(threshold))) return;

    const head = this.head;
    const d = Vec2.sub(head.getWorldCenter(), this.tors.getWorldCenter());
    const v = Vec2.mul(norm(d), ACTIONS.jumpLeanImpulse * this.massFactor);
    // The rail and ragdoll joints absorb much of the extra impulse. A 2x
    // launch impulse produces about 1.5x measured head height.
    const lift = ACTIONS.jumpLift * this.massFactor * (this.power === 'highJump' ? 2 : 1);

    ass.setLinearVelocity(Vec2(0, 0));
    head.setLinearVelocity(Vec2(0, 0));
    head.applyLinearImpulse(Vec2(0, -lift), head.getWorldCenter(), true);
    // §16.7 — applied to the HEAD, at the fingertips' positions. Not a slip.
    head.applyLinearImpulse(v, this.part('FingerLeft').getWorldCenter(), true);
    head.applyLinearImpulse(v, this.part('FingerRight').getWorldCenter(), true);
    ass.applyLinearImpulse(Vec2(0, -lift), head.getWorldCenter(), true);
  }

  /**
   * Sideways movement. Zeroing the hips' velocity first and then kicking is
   * what gives the game its twitchy feel (§1.6).
   */
  turn(impulse: Vec2Value): void {
    if (this.recoilFrames > 0) return;
    const ass = this.ass;
    const head = this.head;
    ass.setLinearVelocity(Vec2(0, 0));
    const boost = this.massFactor * (this.power === 'speed' ? 1.5 : 1);
    const moved = Vec2(impulse.x * boost, impulse.y * boost);
    if (head.getWorldCenter().y * 30 > ACTIONS.groundedHeadPx) {
      ass.applyLinearImpulse(moved, ass.getWorldCenter(), true); // grounded
    } else {
      head.applyLinearImpulse(moved, head.getWorldCenter(), true); // airborne
    }
  }

  /** The AI's softer variant. Note the inverted grounded/airborne branches. */
  turnComp(impulse: Vec2Value): void {
    if (this.recoilFrames > 0) return;
    const ass = this.ass;
    const head = this.head;
    ass.setLinearVelocity(Vec2(0, 0));
    head.setLinearVelocity(Vec2(0, 0));
    const boost = this.massFactor * (this.power === 'speed' ? 1.5 : 1);
    const moved = Vec2(impulse.x * boost, impulse.y * boost);
    if (head.getWorldCenter().y * 30 > ACTIONS.groundedHeadPx) {
      const half = Vec2(moved.x * 0.5, moved.y * 0.5);
      head.applyLinearImpulse(half, head.getWorldCenter(), true);
      ass.applyLinearImpulse(half, ass.getWorldCenter(), true);
    } else {
      ass.applyLinearImpulse(moved, ass.getWorldCenter(), true);
    }
  }

  /** AI only. */
  turnUp(): void {
    const head = this.head;
    if (head.getWorldCenter().y * 30 > ACTIONS.turnUpHeadPx) {
      head.applyLinearImpulse(Vec2(0, -ACTIONS.turnUpImpulse), head.getWorldCenter(), true);
    }
  }

  turnDown(): void {
    const fl = this.part('FootLeft');
    const fr = this.part('FootRight');
    fl.applyLinearImpulse(Vec2(0, ACTIONS.turnDownImpulse), fl.getWorldCenter(), true);
    fr.applyLinearImpulse(Vec2(0, ACTIONS.turnDownImpulse), fr.getWorldCenter(), true);
  }

  /** AI only, lean toward a body. Applied twice, identically. */
  turnHands(target: Body): void {
    const head = this.head;
    const d = Vec2.sub(target.getWorldCenter(), head.getWorldCenter());
    const v = Vec2.mul(norm(d), ACTIONS.turnHandsImpulse);
    head.applyLinearImpulse(v, head.getWorldCenter(), true);
    head.applyLinearImpulse(v, head.getWorldCenter(), true);
  }

  setLinVelZero(): void {
    for (const b of this.bodies) b.setLinearVelocity(Vec2(0, 0));
    this.prismBody.setLinearVelocity(Vec2(0, 0));
  }

  /** Apply a small whole-doll recoil without locking out jump or swing. */
  receiveHeadPunch(impulse: Vec2Value, frames: number): void {
    if (this.power === 'shield') return;
    this.head.applyLinearImpulse(impulse, this.head.getWorldCenter(), true);
    this.ass.applyLinearImpulse(impulse, this.ass.getWorldCenter(), true);
    this.recoilFrames = Math.max(this.recoilFrames, frames);
  }

  tickRecoil(): void {
    if (this.recoilFrames > 0) this.recoilFrames -= 1;
  }

  /** §8 standPlayer(x, y) — the round reset. */
  standPlayer(xPx: number, yPx: number): void {
    this.recoilFrames = 0;
    this.setLinVelZero();
    for (const p of STAND_POSE) {
      const footOffset = 101;
      this.part(p.name).setTransform(Vec2(
        toM(xPx + p.dx * this.sizeScale),
        toM(yPx + footOffset + (p.dy - footOffset) * this.sizeScale),
      ), 0);
    }
    // Deliberately NOT reset: PrismBody's position, and every part's angular
    // velocity. The original leaves both. The rails pull PrismBody back into
    // line within a step or two — it is ~500x lighter than the doll, so the
    // position solver moves it rather than the head.
    this.setLinVelZero();
  }

  // -------------------------------------------------------------------------
  // §8 Holding and serving
  // -------------------------------------------------------------------------

  takeBall(ballBody: Body): void {
    if (ballBody.getJointList() != null) return;
    const hand = this.servingFinger;
    ballBody.setTransform(hand.getWorldCenter(), 0);
    this.ballJoint = this.world.createJoint(
      new RevoluteJoint(
        {
          // Limits are set but NOT enabled — faithful to the original.
          lowerAngle: SERVE.ballJointLower * DEG,
          upperAngle: SERVE.ballJointUpper * DEG,
          enableLimit: false,
        },
        hand,
        ballBody,
        ballBody.getWorldCenter(),
      ),
    ) as RevoluteJointT;
  }

  get holdingJoint(): RevoluteJointT | null {
    return this.ballJoint;
  }

  /** Called when someone else destroys the joint (e.g. the serve clock). */
  forgetBallJoint(): void {
    this.ballJoint = null;
  }

  /**
   * §8 pas() — the serve. Most of it is the hand being flung and hitting the
   * ball; the ball's own impulse is tiny (dv = 7, -5 m/s).
   * Every serve gets the same impulse, regardless of button hold time.
   * Returns true if the serve actually happened.
   */
  pas(ballBody: Body, ballOfPlayer: number, serveCentreM: number): boolean {
    if (ballBody.getJointList() == null || this.ballJoint == null) return false;
    if (ballOfPlayer !== this.id) return false;
    const x = ballBody.getWorldCenter().x;
    // Must still be on your own half.
    if (this.id === 1 && !(x < serveCentreM)) return false;
    if (this.id === 2 && !(x > serveCentreM)) return false;

    const sign = this.id === 1 ? 1 : -1;
    this.world.destroyJoint(this.ballJoint);
    this.ballJoint = null;

    const hand = this.servingFinger;
    hand.applyLinearImpulse(
      Vec2(sign * SERVE.handImpulseX * this.massFactor * this.attackFactor,
        SERVE.handImpulseY * this.massFactor * this.attackFactor),
      hand.getWorldCenter(),
      true,
    );
    ballBody.applyLinearImpulse(
      Vec2(sign * SERVE.ballImpulseX * this.attackFactor, SERVE.ballImpulseY * this.attackFactor),
      ballBody.getWorldCenter(),
      true,
    );
    return true;
  }

  /**
   * The rally hit uses the selected arm. Arm/Hand/Finger
   * are all flung together so the
   * whole limb whips forward instead of just the fingertip. `power` is the
   * 0..1 charge fraction the button was held for, scaled via powerScale() —
   * a fully charged swing hits hard enough to knock back anything it connects
   * with (the opponent, an executer).
   */
  swingArm(power = 1, swingHand: SwingHand = 'outside'): void {
    const sign = this.id === 1 ? 1 : -1;
    const scale = powerScale(power) * this.massFactor * this.attackFactor;
    const side = this.swingSide(swingHand);
    const finger = this.part(`Finger${side}`);
    const hand = this.part(`Hand${side}`);
    const arm = this.part(`Arm${side}`);

    finger.applyLinearImpulse(
      Vec2(sign * SWING.fingerImpulseX * scale, SWING.fingerImpulseY * scale),
      finger.getWorldCenter(),
      true,
    );
    hand.applyLinearImpulse(
      Vec2(sign * SWING.handImpulseX * scale, SWING.handImpulseY * scale),
      hand.getWorldCenter(),
      true,
    );
    arm.applyLinearImpulse(
      Vec2(sign * SWING.armImpulseX * scale, SWING.armImpulseY * scale),
      arm.getWorldCenter(),
      true,
    );
  }

  /**
   * Not in the original, and never called for a serve charge — only while
   * charging a swing. A small tug away from the opponent and upward, meant to
   * be called every held frame with the current 0..1 charge fraction: the arm
   * visibly winds up (cocks back) as the power builds, settling against its
   * joint limits rather than flying anywhere.
   */
  windUpArm(power: number, swingHand: SwingHand = 'outside'): void {
    const sign = this.id === 1 ? 1 : -1; // the swing's forward direction
    const k = clamp01(power);
    const side = this.swingSide(swingHand);
    const finger = this.part(`Finger${side}`);
    const hand = this.part(`Hand${side}`);
    const arm = this.part(`Arm${side}`);

    finger.applyLinearImpulse(
      Vec2(-sign * WINDUP.fingerImpulseX * k, -WINDUP.fingerImpulseY * k),
      finger.getWorldCenter(),
      true,
    );
    hand.applyLinearImpulse(
      Vec2(-sign * WINDUP.handImpulseX * k, -WINDUP.handImpulseY * k),
      hand.getWorldCenter(),
      true,
    );
    arm.applyLinearImpulse(
      Vec2(-sign * WINDUP.armImpulseX * k, -WINDUP.armImpulseY * k),
      arm.getWorldCenter(),
      true,
    );
  }

}

export const spawnFor = (id: PlayerId) => (id === 1 ? SPAWN_P1_PX : SPAWN_P2_PX);
