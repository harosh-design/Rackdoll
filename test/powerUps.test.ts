import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { FEATHER, GIFT, JOINTS, MAX_TOUCHES, NET_X_PX, PARTS, toM, toPx } from '../src/sim/constants';
import type { Player } from '../src/sim/player';
import { POWERS, type PowerId } from '../src/sim/powerUps';
import { jointErrPx, rng, run, world } from './helpers';

const headRadius = (p: Player) => p.head.getFixtureList()!.getShape().getRadius();

/** Worst distance, in px, between a joint's local anchors and the joint table's. */
function anchorDriftPx(p: Player): number {
  let max = 0;
  JOINTS.forEach((def, i) => {
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

describe('goal gifts', () => {
  it('counts every scored point in threes, alternates sides, and expires after ten seconds', () => {
    const gw = world();
    for (let goal = 1; goal <= 6; goal++) {
      const grip = gw.p1.holdingJoint ?? gw.p2.holdingJoint;
      if (grip) gw.world.destroyJoint(grip);
      gw.p1.forgetBallJoint();
      gw.p2.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
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
      if (goal % 3 === 0) {
        expect(gw.powerUps.gift?.side).toBe(goal === 3 ? 1 : 2);
      } else {
        expect(gw.powerUps.gift).toBeNull();
      }
      if (goal === 3) gw.powerUps.tick(gw.frame + GIFT.lifeFrames, false);
    }
    expect(gw.powerUps.gift?.side).toBe(2);
    gw.powerUps.tick(gw.frame + GIFT.lifeFrames - 1, false);
    expect(gw.powerUps.gift).not.toBeNull();
    gw.powerUps.tick(gw.frame + GIFT.lifeFrames, false);
    expect(gw.powerUps.gift).toBeNull();
  });

  it('collects only on the selected side and restores the player after 30 seconds', () => {
    const gw = world();
    gw.powerUps.onGoal();
    gw.powerUps.onGoal();
    gw.powerUps.onGoal();
    gw.powerUps.onNewRound(0);
    gw.p2.standPlayer(GIFT.xPx[1], 256);
    gw.powerUps.tick(1, true);
    expect(gw.powerUps.gift?.side).toBe(1);
    gw.p1.standPlayer(GIFT.xPx[1], 256);
    gw.powerUps.tick(2, true);
    expect(gw.powerUps.gift).toBeNull();
    expect(POWERS).toContain(gw.powerUps.active[1]?.kind);
    expect(gw.powerUps.active[2]).toBeNull();
    const active = gw.powerUps.active[1]!;
    expect(active.expiresAt - active.startedAt).toBe(30 * 30);
    gw.powerUps.tick(active.expiresAt - 1, false);
    expect(gw.powerUps.active[1]).not.toBeNull();
    gw.powerUps.tick(active.expiresAt, false);
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
    const sequence: PowerId[] = ['giant', 'feather', 'tiny', 'giant', 'highJump', 'shield', 'tiny', 'speed', 'magnet'];
    for (const kind of sequence) {
      gw.powerUps.activate(1, kind, gw.frame);
      // Swap again before the resize has finished, as well as after.
      run(gw, kind === 'giant' ? 5 : 25);
      expect(gw.p1.power).toBe(kind);
      expect(gw.powerUps.active[1]).toMatchObject({ kind, expiresAt: gw.frame - (kind === 'giant' ? 5 : 25) + GIFT.powerFrames });
      expect(gw.p1.targetScale).toBe(kind === 'giant' ? 1.5 : kind === 'tiny' ? 1 / 1.5 : 1);
      expect(counts()).toEqual(before);
    }
    // The last swap (tiny → speed → magnet) must have settled back to full size.
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
    const r = rng(7);
    const keys = [37, 38, 39, 40];
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

  it('a giant growing against the net keeps every limb on its own side', () => {
    for (const jump of [false, true]) {
      const gw = world();
      gw.game.update = () => {};
      gw.world.destroyJoint(gw.p1.holdingJoint!);
      gw.p1.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
      gw.ball.body.setTransform(Vec2(toM(-150), toM(100)), 0);
      gw.control.press(39);
      run(gw, 90);
      if (jump) {
        gw.control.press(38);
        run(gw, 4);
        gw.control.release(38);
      }
      gw.powerUps.activate(1, 'giant', gw.frame);
      for (let f = 0; f < 150; f++) {
        gw.step();
        for (const b of gw.p1.bodies) expect(toPx(b.getWorldCenter().x)).toBeLessThan(NET_X_PX);
      }
    }
  });

  it('shield blocks a hazard’s knock', () => {
    const powered = world();
    powered.powerUps.activate(2, 'shield', 0);
    expect(powered.p2.knock(Vec2(2, -1), 10)).toBe(false);
    expect(powered.p2.recoilFrames).toBe(0);
  });

  it('high jump lifts higher and magnet hands pull a nearby free ball', () => {
    const jumpLift = (high: boolean) => {
      const gw = world();
      run(gw, 90);
      if (high) gw.powerUps.activate(1, 'highJump', gw.frame);
      const start = gw.p1.head.getWorldCenter().y;
      gw.p1.jump();
      let peak = start;
      for (let i = 0; i < 50; i++) {
        gw.step();
        peak = Math.min(peak, gw.p1.head.getWorldCenter().y);
      }
      return start - peak;
    };
    const heightRatio = jumpLift(true) / jumpLift(false);
    expect(heightRatio).toBeGreaterThan(1.4);
    expect(heightRatio).toBeLessThan(1.65);

    const gw = world();
    const grip = gw.p1.holdingJoint!;
    gw.world.destroyJoint(grip);
    gw.p1.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.ball.body.setTransform(Vec2(toM(215), toM(280)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.powerUps.activate(1, 'magnet', gw.frame);
    gw.step();
    expect(gw.ball.velocity.x).toBeLessThan(0);
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

  it('feather ball falls slower only over the feathered player\'s half', () => {
    const drop = (kind: PowerId | null, xPx: number) => {
      const gw = world();
      gw.game.update = () => {};
      gw.world.destroyJoint(gw.p1.holdingJoint!);
      gw.p1.forgetBallJoint();
      gw.ball.ballOfPlayer = 0;
      if (kind) gw.powerUps.activate(1, kind, 0);
      gw.ball.body.setTransform(Vec2(toM(xPx), toM(-100)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 0));
      run(gw, 10);
      return gw.ball.velocity.y;
    };
    expect(drop('feather', 100)).toBeCloseTo(drop(null, 100) * FEATHER.gravityScale, 3);
    expect(drop('feather', 500)).toBeCloseTo(drop(null, 500), 6);
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
