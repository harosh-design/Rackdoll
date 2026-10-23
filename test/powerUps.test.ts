import { KEYS } from '../src/sim/control';
import { Vec2 } from 'planck';
import { describe, expect, it, vi } from 'vitest';
import { FEATHER, JOINTS, LANDING_CENTRE_M, MAX_TOUCHES, NET_X_PX, PARTS, POWER, toM, toPx } from '../src/sim/constants';
import type { Player } from '../src/sim/player';
import { POWERS, type PowerId } from '../src/sim/powerUps';
import { jointErrPx, rng, run, world } from './helpers';

const headRadius = (p: Player) => p.head.getFixtureList()!.getShape().getRadius();

/** Worst distance, in px, between a joint's local anchors and the joint table's. */
function anchorDriftPx(p: Player): number {
  let max = 0;
  JOINTS.filter(def => p.isAttached(def.a) && p.isAttached(def.b)).forEach((def, i) => {
    const joint = p.revolutes[i];
    for (const [name, local] of [[def.a, joint.getLocalAnchorA()], [def.b, joint.getLocalAnchorB()]] as const) {
      const part = PARTS.find((q) => q.name === name)!;
      const dx = local.x - toM((def.dx - part.dx) * p.sizeScale);
      const dy = local.y - toM((def.dy - part.dy) * p.sizeScale);
      max = Math.max(max, toPx(Math.hypot(dx, dy)));
    }
  });
  return max;
}

describe('bee powers without floor gifts', () => {
  it('never grants floor pickups after goals, including every third point', () => {
    const gw = world();
    for (let goal = 1; goal <= 6; goal++) {
      const grip = gw.p1.holdingJoint ?? gw.p2.holdingJoint;
      if (grip) gw.world.destroyJoint(grip);
      gw.p1.forgetBallJoint();
      gw.p2.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
      // A prior physics step can leave a held-ball contact in the list.
      gw.p1.bContact = gw.p2.bContact = true;
      if (goal % 2 === 0) {
        // A four-touch fault scores just like a landed ball.
        gw.p2.contact = MAX_TOUCHES + 1;
      } else {
        gw.ball.body.setTransform(Vec2(toM(450), toM(340)), 0);
        gw.flags.onBallDown = true;
      }
      gw.game.update();
      expect(gw.game.score[1]).toBe(goal);
      gw.game.newRound();
      // Walking over the former gift locations no longer awards a power.
      gw.p1.standPlayer(220, 256);
      gw.p2.standPlayer(420, 256);
      gw.step();
      expect(gw.powerUps.active).toEqual({ 1: null, 2: null });
      expect(gw.p1.power).toBeNull();
      expect(gw.p2.power).toBeNull();
    }
  });

  it.each(POWERS)('restores the player thirty seconds after collecting %s', (kind) => {
    const gw = world();
    gw.powerUps.activate(1, kind, 2);
    expect(gw.powerUps.active[1]?.kind).toBe(kind);
    expect(gw.powerUps.active[2]).toBeNull();
    const active = gw.powerUps.active[1]!;
    expect(active.expiresAt - active.startedAt).toBe(30 * 30);
    gw.powerUps.tick(active.expiresAt - 1);
    expect(gw.powerUps.active[1]).not.toBeNull();
    gw.powerUps.tick(active.expiresAt);
    expect(gw.powerUps.active[1]).toBeNull();
    expect(gw.p1.power).toBeNull();
    expect(gw.p1.targetScale).toBe(1);
    run(gw, 30);
    expect(gw.p1.sizeScale).toBe(1);
  });

  it('grows and shrinks the real collision shapes over a few frames, then restores them', () => {
    const gw = world();
    const original = headRadius(gw.p1);
    gw.powerUps.activate(1, 'giant', 0);
    run(gw, 1);
    expect(headRadius(gw.p1)).toBeGreaterThan(original);
    expect(headRadius(gw.p1)).toBeLessThan(original * 1.5);
    run(gw, 20);
    expect(headRadius(gw.p1)).toBeCloseTo(original * 1.5);
    expect(gw.p1.revolutes).toHaveLength(12);
    gw.powerUps.activate(1, 'tiny', gw.frame);
    run(gw, 30);
    expect(headRadius(gw.p1)).toBeCloseTo(original / 1.5);
    gw.powerUps.clearPower(1);
    run(gw, 30);
    expect(headRadius(gw.p1)).toBeCloseTo(original);
    expect(gw.p1.revolutes).toHaveLength(12);
    expect(Number.isFinite(gw.p1.head.getWorldCenter().x)).toBe(true);
  });

  it('a new ability replaces the active one outright, with nothing left over', () => {
    const gw = world();
    const baseMass = gw.p1.bodies.map((b) => b.getMass());
    const counts = () => {
      let bodies = 0;
      let fixtures = 0;
      let joints = 0;
      for (let b = gw.world.getBodyList(); b; b = b.getNext()) {
        bodies++;
        for (let f = b.getFixtureList(); f; f = f.getNext()) fixtures++;
      }
      // The serve clock can drop and re-grip the ball meanwhile; skip that joint.
      for (let j = gw.world.getJointList(); j; j = j.getNext()) if (j.getBodyB() !== gw.ball.body) joints++;
      return { bodies, fixtures, joints };
    };
    const before = counts();
    const sequence: PowerId[] = ['giant', 'feather', 'tiny', 'giant', 'feather', 'speed', 'tiny', 'speed', 'feather'];
    for (const kind of sequence) {
      gw.powerUps.activate(1, kind, gw.frame);
      // Swap again before the resize has finished, as well as after.
      run(gw, kind === 'giant' ? 5 : 25);
      expect(gw.p1.power).toBe(kind);
      expect(gw.powerUps.active[1]).toMatchObject({ kind, expiresAt: gw.frame - (kind === 'giant' ? 5 : 25) + POWER.durationFrames });
      expect(gw.p1.targetScale).toBe(kind === 'giant' ? 1.5 : kind === 'tiny' ? 1 / 1.5 : 1);
      expect(counts()).toEqual(before);
    }
    // The last swap (tiny → speed → Updraft) must have settled back to full size.
    expect(gw.p1.sizeScale).toBe(1);
    expect(gw.p1.bodies.map((b) => b.getMass())).toEqual(baseMass.map((m) => expect.closeTo(m, 9)));

    // Speed after giant moves at 1.5x, not 1.5x on top of a giant's mass boost.
    const normal = world();
    const swapped = world();
    swapped.powerUps.activate(1, 'giant', 0);
    run(swapped, 20);
    swapped.powerUps.activate(1, 'speed', swapped.frame);
    run(swapped, 20);
    run(normal, 40);
    normal.p1.turn(Vec2(4, 0));
    swapped.p1.turn(Vec2(4, 0));
    expect(swapped.p1.ass.getLinearVelocity().x).toBeCloseTo(normal.p1.ass.getLinearVelocity().x * 1.5);
  });

  it('never bakes joint stretch into the skeleton across repeated resizes', () => {
    const gw = world();
    // Measure the intact skeleton independently of impalement at the spike.
    vi.spyOn(gw.netSpike, 'impacts').mockReturnValue([]);
    const r = rng(7);
    const keys = [KEYS[1].left, KEYS[1].jump, KEYS[1].right, KEYS[1].down];
    for (let cycle = 0; cycle < 40; cycle++) {
      for (const k of keys) gw.control.release(k);
      gw.control.press(keys[Math.floor(r() * keys.length)]);
      gw.powerUps.activate(1, (['giant', 'tiny', 'speed'] as const)[Math.floor(r() * 3)], gw.frame);
      run(gw, 3 + Math.floor(r() * 10));
      expect(anchorDriftPx(gw.p1)).toBeLessThan(1e-6);
    }
    for (const k of keys) gw.control.release(k);
    gw.powerUps.clearPower(1);
    run(gw, 60);
    gw.p1.standPlayer(100, 256);
    run(gw, 60);
    expect(anchorDriftPx(gw.p1)).toBeLessThan(1e-6);
    expect(jointErrPx(gw.p1)).toBeLessThan(2);
    expect(toPx(gw.p1.head.getWorldCenter().y)).toBeGreaterThan(250);
    expect(toPx(gw.p1.head.getWorldCenter().y)).toBeLessThan(275);
  });

  it('a giant growing against the spike keeps its head on its own half and its body parts finite', () => {
    for (const jump of [false, true]) {
      const gw = world();
      gw.game.update = () => {};
      gw.world.destroyJoint(gw.p1.holdingJoint!);
      gw.p1.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
      gw.ball.body.setTransform(Vec2(toM(-150), toM(100)), 0);
      gw.control.press(KEYS[1].right);
      run(gw, 90);
      if (jump) {
        gw.control.press(KEYS[1].jump);
        run(gw, 4);
        gw.control.release(KEYS[1].jump);
      }
      gw.powerUps.activate(1, 'giant', gw.frame);
      for (let f = 0; f < 150; f++) {
        gw.step();
        // Pinned limbs can stretch across the spike; the head stays on its rail.
        expect(toPx(gw.p1.head.getWorldCenter().x)).toBeLessThan(NET_X_PX);
        for (const body of [...gw.p1.bodies, ...gw.p1.detachedBodies]) {
          const position = body.getWorldCenter(), velocity = body.getLinearVelocity();
          expect(Number.isFinite(position.x + position.y + velocity.x + velocity.y + body.getAngle())).toBe(true);
        }
      }
    }
  });

  it.each(POWERS)('collecting %s still allows a hazard to knock the player back', (kind) => {
    const powered = world();
    powered.powerUps.activate(2, kind, 0);
    expect(powered.p2.knock(Vec2(2, -1), 10)).toBe(true);
    expect(powered.p2.recoilFrames).toBe(10);
  });

  it.each([1, 2] as const)('Updraft boosts player %i\'s jump only until it is replaced or expires', (owner) => {
    const jumpLift = (state: 'active' | 'replaced' | 'expired' | null) => {
      const gw = world();
      // Measure jump height without a held ball pulling on the ragdoll.
      gw.world.destroyJoint(gw.p1.holdingJoint!);
      gw.p1.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
      gw.ball.body.setActive(false);
      run(gw, 90);
      if (state) gw.powerUps.activate(owner, 'feather', gw.frame);
      if (state === 'replaced') gw.powerUps.activate(owner, 'speed', gw.frame);
      if (state === 'expired') gw.powerUps.tick(gw.powerUps.active[owner]!.expiresAt);
      const player = owner === 1 ? gw.p1 : gw.p2;
      const start = player.head.getWorldCenter().y;
      player.jump();
      let peak = start;
      for (let i = 0; i < 50; i++) {
        gw.step();
        peak = Math.min(peak, player.head.getWorldCenter().y);
      }
      return start - peak;
    };
    const normal = jumpLift(null);
    const heightRatio = jumpLift('active') / normal;
    expect(heightRatio).toBeGreaterThan(1.4);
    expect(heightRatio).toBeLessThan(1.65);
    expect(jumpLift('replaced')).toBeCloseTo(normal, 6);
    expect(jumpLift('expired')).toBeCloseTo(normal, 6);
  });

  it.each(POWERS)('collecting %s does not pull a nearby free ball toward the hands', (kind) => {
    const gw = world();
    const grip = gw.p1.holdingJoint!;
    gw.world.destroyJoint(grip);
    gw.p1.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.ball.body.setTransform(Vec2(toM(215), toM(280)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.powerUps.activate(1, kind, gw.frame);
    gw.step();
    expect(gw.ball.velocity.x).toBeCloseTo(0, 9);
  });

  it('a shrunken doll stands on the floor and its jump peaks as high as a full-size one', () => {
    const measure = (kind: PowerId | null) => {
      const gw = world();
      gw.game.update = () => {};
      if (kind) gw.powerUps.activate(1, kind, 0);
      run(gw, 120);
      const p = gw.p1;
      const sole = Math.max(...(['FootLeft', 'FootRight'] as const)
        .map((n) => toPx(p.part(n).getWorldCenter().y) + 11 * p.sizeScale));
      const start = p.head.getWorldCenter().y;
      p.jump();
      let peak = start;
      for (let i = 0; i < 60; i++) {
        gw.step();
        peak = Math.min(peak, p.head.getWorldCenter().y);
      }
      return { sole, lift: toPx(start - peak), apex: toPx(peak) };
    };
    const normal = measure(null);
    const tiny = measure('tiny');
    const giant = measure('giant');
    // It used to hang ~11 px above the floor, too high for jump() to fire.
    for (const m of [normal, tiny, giant]) expect(m.sole).toBeGreaterThan(351);
    expect(tiny.lift).toBeGreaterThan(150);
    expect(Math.abs(tiny.apex - normal.apex)).toBeLessThan(12);
  });

  it.each([1, 2] as const)('Updraft slows only player %i\'s half after they collect it', (owner) => {
    const drop = (kind: PowerId | null, xPx: number) => {
      const gw = world();
      gw.game.update = () => {};
      gw.world.destroyJoint(gw.p1.holdingJoint!);
      gw.p1.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
      if (kind) gw.powerUps.activate(owner, kind, 0);
      gw.ball.body.setTransform(Vec2(toM(xPx), toM(-100)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 0));
      run(gw, 10);
      return gw.ball.velocity.y;
    };
    const home = owner === 1 ? 100 : 500;
    const away = owner === 1 ? 500 : 100;
    expect(drop('feather', home)).toBeCloseTo(drop(null, home) * FEATHER.gravityScale, 3);
    expect(drop('feather', away)).toBeCloseTo(drop(null, away), 6);
  });

  it.each([1, 2] as const)('updates feather gravity as the ball crosses player %i\'s boundary', (owner) => {
    const gw = world();
    gw.game.update = () => {};
    gw.world.destroyJoint(gw.p1.holdingJoint!);
    gw.p1.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.powerUps.activate(owner, 'feather', 0);
    const direction = owner === 1 ? 1 : -1;
    gw.ball.body.setTransform(Vec2(LANDING_CENTRE_M - direction * toM(4), toM(-100)), 0);
    gw.ball.body.setLinearVelocity(Vec2(direction * 8, 0));
    gw.step();
    expect((gw.ball.position.x - LANDING_CENTRE_M) * direction).toBeGreaterThan(0);
    expect(gw.ball.body.getGravityScale()).toBe(FEATHER.gravityScale);
    gw.step();
    expect(gw.ball.body.getGravityScale()).toBe(1);

    gw.ball.body.setLinearVelocity(Vec2(-direction * 8, 0));
    run(gw, 3);
    expect((gw.ball.position.x - LANDING_CENTRE_M) * direction).toBeLessThan(0);
    expect(gw.ball.body.getGravityScale()).toBe(FEATHER.gravityScale);
  });

  it.each([1, 2] as const)('clears player %i\'s feather gravity when replaced or expired', (owner) => {
    const gw = world();
    gw.game.update = () => {};
    gw.world.destroyJoint(gw.p1.holdingJoint!);
    gw.p1.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.ball.body.setTransform(Vec2(toM(owner === 1 ? 100 : 500), toM(-100)), 0);
    gw.powerUps.activate(owner, 'feather', 0);
    gw.step();
    expect(gw.ball.body.getGravityScale()).toBe(FEATHER.gravityScale);
    gw.powerUps.activate(owner, 'speed', gw.frame);
    gw.step();
    expect(gw.ball.body.getGravityScale()).toBe(1);

    gw.powerUps.activate(owner, 'feather', gw.frame);
    gw.step();
    expect(gw.ball.body.getGravityScale()).toBe(FEATHER.gravityScale);
    gw.powerUps.tick(gw.powerUps.active[owner]!.expiresAt);
    gw.step();
    expect(gw.ball.body.getGravityScale()).toBe(1);
  });

  it('speed increases lateral movement impulse for either player', () => {
    const normal = world();
    const fast = world();
    fast.powerUps.activate(1, 'speed', 0);
    normal.p1.turn(Vec2(4, 0));
    fast.p1.turn(Vec2(4, 0));
    expect(fast.p1.ass.getLinearVelocity().x).toBeCloseTo(normal.p1.ass.getLinearVelocity().x * 1.5);
  });
});
