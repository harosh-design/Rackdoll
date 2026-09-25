import { Circle, Vec2, type Body, type Fixture, type Vec2Value, type World } from 'planck';
import { BODYTYPE, COLLISION, EXECUTER, GRAVITY, OPTIONS, SPAWN_P1_PX, TIMERS, toM, toPx } from './constants';
import { FrameTimer, type TimerSet } from './timer';
import type { Player, PlayerId } from './player';
import type { BodyUserData } from './types';

export interface ExecuterTuning {
  mass: number;
  maxForce: number;
  launchSpeed: number;
  emergeFrames: number;
  bullet: boolean;
}

export interface ExecuterOptions {
  world: World;
  timers: TimerSet;
  /** The player it hunts: the one on the side it was launched into. */
  target: Player;
  side: PlayerId;
  /** Where it comes out, in metres. */
  origin: Vec2Value;
  speed?: number;
  lifeSeconds?: number;
  tuning?: Partial<ExecuterTuning>;
  onDeath?: (e: Executer) => void;
}

/**
 * §13 Executer — a heavy spiked ball that hunts a player, reworked so it rams
 * the doll rather than tearing through it:
 *
 * - fired out of the button it came from, straight at its target;
 * - a sensor until it is clear of everything, so it can't spawn inside the
 *   ball that just pressed the button;
 * - then steered by a bounded force toward §13's target velocity instead of
 *   having its velocity overwritten every frame;
 * - no gravity: it hovers at head height, as the velocity overwrite made the
 *   original's do;
 * - no bullet CCD: it moves a few px a step, and Box2D's time-of-impact solve
 *   pushes doll parts without solving their joints.
 */
export class Executer {
  readonly body: Body;
  readonly target: Player;
  readonly side: PlayerId;
  dead = false;
  /** Frames since launch. */
  age = 0;
  /** False while it is still emerging from its button as a sensor. */
  solid = false;
  /** While pinning: unit direction of the surface it drives its player into. */
  pinDir: Vec2 | null = null;
  /** Ceiling pin: carrying its player up (or back down). */
  carrying = false;

  private readonly fixture: Fixture;
  private readonly timer: FrameTimer;
  private readonly timers: TimerSet;
  private readonly world: World;
  private readonly speed: number;
  private readonly lifeSeconds: number;
  private readonly tuning: ExecuterTuning;
  private readonly onDeath?: (e: Executer) => void;

  constructor(o: ExecuterOptions) {
    this.world = o.world;
    this.timers = o.timers;
    this.target = o.target;
    this.side = o.side;
    this.speed = o.speed ?? OPTIONS.myExSpeed;
    this.lifeSeconds = o.lifeSeconds ?? OPTIONS.myExLife;
    this.onDeath = o.onDeath;
    this.tuning = {
      mass: EXECUTER.mass,
      maxForce: EXECUTER.maxForce,
      launchSpeed: EXECUTER.launchSpeed,
      emergeFrames: EXECUTER.emergeFrames,
      bullet: EXECUTER.bullet,
      ...o.tuning,
    };

    this.body = o.world.createBody({
      type: 'dynamic',
      position: Vec2(o.origin.x, o.origin.y),
      angularDamping: 0,
      linearDamping: 0,
      gravityScale: 0,
      bullet: this.tuning.bullet,
    });
    this.fixture = this.body.createFixture({
      shape: Circle(toM(EXECUTER.radiusPx)),
      density: EXECUTER.density,
      friction: EXECUTER.friction,
      restitution: EXECUTER.restitution,
      isSensor: true,
      filterCategoryBits: COLLISION.EXECUTER,
      filterMaskBits: 0xffff,
    });
    this.body.setMassData({ mass: this.tuning.mass, center: Vec2(0, 0), I: EXECUTER.inertia });
    this.body.setUserData({ e_bodytype: BODYTYPE.EXECUTER, sprite: 'Executer' } as BodyUserData);

    // Fire it straight at its target.
    const d = this.toTarget();
    this.body.setLinearVelocity(Vec2(d.x * this.tuning.launchSpeed, d.y * this.tuning.launchSpeed));

    this.timer = o.timers.add(
      new FrameTimer(TIMERS.executerTickMs, o.lifeSeconds ?? OPTIONS.myExLife, () => {}, () => this.destroy()),
    );
    this.timer.start();
  }

  /** §13's aim point: the target's torso x, head y. Unit vector toward it. */
  private toTarget(): Vec2 {
    const p = this.body.getWorldCenter();
    const dx = this.target.tors.getWorldCenter().x - p.x;
    const dy = this.target.head.getWorldCenter().y - p.y;
    const len = Math.hypot(dx, dy);
    return len < 1e-9 ? Vec2(0, 0) : Vec2(dx / len, dy / len);
  }

  /** x2 lunge every Nth second of its life. */
  private get burst(): number {
    const n = this.timer.currentCount;
    return n > 0 && n % EXECUTER.burstEvery === 0 ? 2 : 1;
  }

  private overlapsAnything(): boolean {
    for (let ce = this.body.getContactList(); ce; ce = ce.next) {
      if (ce.contact.isTouching()) return true;
    }
    return false;
  }

  /** Distance from its centre to the nearest part of its player, px. */
  private nearestPartPx(): number {
    const c = this.body.getWorldCenter();
    let best = Infinity;
    for (const b of this.target.bodies) {
      const q = b.getWorldCenter();
      best = Math.min(best, Math.hypot(q.x - c.x, q.y - c.y));
    }
    return toPx(best);
  }

  /** §13's aim point, in metres. */
  private aimPoint(): Vec2 {
    return Vec2(this.target.tors.getWorldCenter().x, this.target.head.getWorldCenter().y);
  }

  /**
   * The surface it pins against, chosen as it closes in: the ceiling if it
   * arrives below its player's shoulders, otherwise its half's outer wall.
   */
  private choosePin(): Vec2 {
    const c = this.body.getWorldCenter();
    if (c.y > this.aimPoint().y + toM(30)) return Vec2(0, -1);
    return Vec2(this.side === 1 ? -1 : 1, 0);
  }

  /** Once per frame, after the step. `dt` is the step that just ran. */
  update(dt: number): void {
    if (this.dead) return;
    this.age += 1;

    if (!this.solid) {
      if (this.age < this.tuning.emergeFrames || this.overlapsAnything()) return; // coasting out
      this.fixture.setSensor(false);
      this.solid = true;
    }

    const near = this.nearestPartPx();
    if (!this.pinDir && near < EXECUTER.radiusPx + EXECUTER.engagePx) this.pinDir = this.choosePin();
    else if (this.pinDir && near > EXECUTER.radiusPx + EXECUTER.releasePx) {
      this.pinDir = null;
      this.carrying = false;
    }

    const vd = this.pinDir ? this.pinVelocity(this.pinDir) : this.huntVelocity();
    this.drive(vd, dt);
    if (this.pinDir) this.spin(this.pinDir, dt);
    if (this.pinDir && this.pinDir.y < 0) this.lift(dt);
  }

  /** §13: straight at the aim point at its speed, x2 in a burst. */
  private huntVelocity(): Vec2 {
    const d = this.toTarget();
    const s = this.speed * this.burst;
    return Vec2(d.x * s, d.y * s);
  }

  /**
   * Drive the player into the pin surface. Into a wall it pushes the torso
   * from the far side, going over the top first if it is on the wrong
   * side. Up into the ceiling it pushes under the shoulder, beside the neck:
   * the doll hangs from its head, so a push near the top lifts it, while a
   * push on the legs only swings it away like a pendulum.
   */
  private pinVelocity(dir: Vec2): Vec2 {
    const c = this.body.getWorldCenter();
    const gap = toM(EXECUTER.radiusPx + 14);
    const fast = this.speed * 2;
    const toward = (x: number, y: number, s: number) => {
      const dx = x - c.x;
      const dy = y - c.y;
      const len = Math.hypot(dx, dy) || 1;
      return Vec2((dx / len) * s, (dy / len) * s);
    };

    if (dir.y < 0) {
      // Ride up beside the shoulder; lift() does the carrying.
      const head = this.target.head.getWorldCenter();
      const side = c.x >= head.x ? 1 : -1;
      // Beside the shoulder, just clear of the hanging arm, so it rides with
      // the player instead of shoving them sideways into a wall.
      const ax = head.x + side * toM(EXECUTER.radiusPx + 34);
      const ay = head.y + toM(20);
      const d = Math.hypot(ax - c.x, ay - c.y);
      // Catch up faster than it carries, or it loses them going up or down.
      if (d > toM(20)) return toward(ax, ay, Math.max(fast, EXECUTER.liftSpeed * 1.6));
      // Alongside: keep station on the anchor while matching the climb.
      const hv = this.target.head.getLinearVelocity();
      return Vec2((ax - c.x) * 6 + hv.x, (ay - c.y) * 6 + hv.y);
    }

    // Into a wall it pushes the torso's middle: pushing at head height while the
    // player drives the hips the other way stretches the neck and waist.
    const tors = this.target.tors.getWorldCenter();
    const aim = Vec2(tors.x, tors.y);
    const rx = c.x - aim.x;
    const ry = c.y - aim.y;
    const along = rx * dir.x; // < 0: on the far side from the wall, as wanted
    if (along > -gap * 0.5) {
      // Wrong side: over the top of the player to the far side.
      return toward(aim.x - dir.x * gap, aim.y - toM(EXECUTER.radiusPx + 55), fast);
    }
    // Push toward the wall, sliding up or down to stay level with the aim point.
    return Vec2(dir.x * EXECUTER.pinSpeed, -ry * 4);
  }

  /**
   * Ceiling pin: carry the player up. A ragdoll hangs from its head, and a
   * round ball pushing on a limb only swings it away, so the lifting force goes
   * into the head, which rides a vertical rail, while the executer rides
   * alongside the shoulder. Nothing below the head is pulled on, so nothing
   * stretches. Same force budget as its drive; climbs at liftSpeed.
   */
  private lift(dt: number): void {
    const head = this.target.head;
    const c = this.body.getWorldCenter();
    const h = head.getWorldCenter();
    // The carry starts once it is riding alongside the shoulder, and then holds
    // until the pin ends (knocked more than releasePx clear) — not on a
    // per-frame position check, which a flailing arm at the ceiling defeats.
    if (!this.carrying) {
      const side = c.x >= h.x ? 1 : -1;
      const sx = h.x + side * toM(EXECUTER.radiusPx + 34);
      const sy = h.y + toM(20);
      if (Math.hypot(c.x - sx, c.y - sy) > toM(EXECUTER.radiusPx + 40) || c.y < h.y - toM(10)) return;
      this.carrying = true;
    }
    // A velocity servo on the whole doll's mass (it hangs from the head), so
    // the climb is a steady pinSpeed rather than kicks to a 0.35 kg head.
    let dollMass = 0;
    for (const b of this.target.bodies) dollMass += b.getMass();
    const vy = head.getLinearVelocity().y;
    // Near the end of its life it lowers the player again, starting just in
    // time to set them down at liftSpeed — otherwise they'd drop ~37 m from
    // the ceiling and land hard enough to wrench the doll apart.
    const heightM = h.y - toM(SPAWN_P1_PX.y);
    const secondsLeft = this.lifeFraction * this.lifeSeconds;
    const lowering = -heightM / EXECUTER.liftSpeed + 1 > secondsLeft;
    const target = lowering ? EXECUTER.liftSpeed : -EXECUTER.liftSpeed;
    let j = dollMass * (target - vy - GRAVITY.y * dt);
    j = Math.max(-this.tuning.maxForce * dt, Math.min(0, j));
    head.applyLinearImpulse(Vec2(0, j), h, true);
  }

  /** Force-limited: a player in the way stops it instead of being crushed. */
  private drive(vd: Vec2, dt: number): void {
    const v = this.body.getLinearVelocity();
    const m = this.body.getMass();
    let jx = m * (vd.x - v.x);
    let jy = m * (vd.y - v.y);
    const jMax = this.tuning.maxForce * dt;
    const j = Math.hypot(jx, jy);
    if (j > jMax) {
      jx *= jMax / j;
      jy *= jMax / j;
    }
    this.body.applyLinearImpulse(Vec2(jx, jy), this.body.getWorldCenter(), true);
  }

  /**
   * Spin so the surface touching the player runs toward the pin surface, and
   * friction drags them along with it.
   */
  private spin(dir: Vec2, dt: number): void {
    const c = this.body.getWorldCenter();
    const aim = dir.y < 0 ? this.target.head.getWorldCenter() : this.aimPoint();
    const tx = aim.x - c.x;
    const ty = aim.y - c.y;
    // Surface velocity at the point facing the player is w * (-ty, tx).
    const sign = -ty * dir.x + tx * dir.y >= 0 ? 1 : -1;
    const w = this.body.getAngularVelocity();
    const I = this.body.getInertia();
    let dL = I * (sign * EXECUTER.spinRate - w);
    const max = EXECUTER.spinTorque * dt;
    if (dL > max) dL = max;
    if (dL < -max) dL = -max;
    this.body.applyAngularImpulse(dL, true);
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    this.timer.stop();
    this.timers.remove(this.timer);
    this.world.destroyBody(this.body);
    this.onDeath?.(this);
  }

  /** Whole seconds of life left, for the HUD. */
  get secondsLeft(): number {
    return Math.max(0, this.timer.repeatCount - this.timer.currentCount);
  }

  /** 1 at launch, 0 at death, continuous — for the button's drain. */
  get lifeFraction(): number {
    const total = this.timer.repeatCount * this.timer.delayFrames;
    return Math.max(0, 1 - this.age / total);
  }
}
