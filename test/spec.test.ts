/**
 * The §17 build-order checks from RAGDOLL-VOLLEYBALL-SPEC.md, as assertions.
 * The spec's reference figures are sanity checks from a faithful port, not
 * targets to tune toward — so these assert ranges around them.
 */
import { Vec2, World, type Body } from 'planck';
import { describe, expect, it, vi } from 'vitest';
import { Ball } from '../src/sim/ball';
import { predictLanding } from '../src/sim/ai';
import {
  BALL, CHARGE, FLIP, GRAVITY, ITERATIONS, JOINTS, NET_TOP_PX, PARTS, PLAYER_FRICTION, SLIME, SWING, TIME_STEP, toM,
} from '../src/sim/constants';
import { ud } from '../src/sim/types';
import { installContactListener } from '../src/sim/contacts';
import { EXECUTER_VARIANTS, type ExecuterId } from '../src/sim/executerVariants';
import type { GameWorld } from '../src/sim/world';
import { Ground } from '../src/sim/ground';
import {
  fireAtButton, hazardWorld, jointErrPx, jumpServe, px, ramScenario, rng, run, SCRIPTS, untilOpponentHit, untilPoint, world,
} from './helpers';

describe('§17.1 world + court + ball', () => {
  it('bounces back to essentially its drop height, indefinitely', () => {
    const w = new World({ gravity: Vec2(GRAVITY.x, GRAVITY.y), allowSleep: true });
    new Ground(w);
    const ball = new Ball(w);
    installContactListener(w, { onBallDown: false, bYesPrize: false, prizeHits: [] });
    const apexes: number[] = [];
    let prevVy = 0;
    for (let i = 0; i < 30 * 60; i++) {
      w.step(TIME_STEP, ITERATIONS, ITERATIONS);
      ball.update();
      const vy = ball.velocity.y;
      if (prevVy < 0 && vy >= 0) apexes.push(px(ball.position.y));
      prevVy = vy;
    }
    expect(apexes.length).toBeGreaterThan(15);
    // Dropped from y = 20: every apex, first minute to last, stays near it.
    for (const a of apexes) expect(Math.abs(a - 20)).toBeLessThan(6);
  });

  it('the ball uses its explicit mass, not its density', () => {
    const gw = world();
    expect(gw.ball.body.getMass()).toBeCloseTo(BALL.mass, 6);
    expect(gw.ball.body.isBullet()).toBe(true);
  });
});

describe('§5 the ragdoll', () => {
  it('has 13 bodies and 12 limited revolute joints per player', () => {
    const gw = world();
    expect(PARTS).toHaveLength(13);
    expect(JOINTS).toHaveLength(12);
    for (const p of [gw.p1, gw.p2]) {
      expect(p.bodies).toHaveLength(13);
      expect(p.revolutes).toHaveLength(12);
      for (const j of p.revolutes) expect(j.isLimitEnabled()).toBe(true);
    }
  });

  it('marks each player by friction alone: 0.5 and 0.51', () => {
    const gw = world();
    for (const b of gw.p1.bodies) expect(b.getFixtureList()!.getFriction()).toBe(PLAYER_FRICTION[1]);
    for (const b of gw.p2.bodies) expect(b.getFixtureList()!.getFriction()).toBe(PLAYER_FRICTION[2]);
    expect(PLAYER_FRICTION[2]).toBe(0.51);
  });

  it('has no motors anywhere', () => {
    const gw = world();
    for (const p of [gw.p1, gw.p2]) {
      expect(p.railH.isMotorEnabled()).toBe(false);
      expect(p.railV.isMotorEnabled()).toBe(false);
      for (const j of p.revolutes) expect(j.isMotorEnabled()).toBe(false);
    }
  });
});

describe('§17.2 the doll + rails', () => {
  it('stands with no input: head ~260–280, feet on the floor, no topple', () => {
    const gw = world();
    run(gw, 150);
    for (const p of [gw.p1, gw.p2]) {
      const head = px(p.head.getWorldCenter().y);
      expect(head).toBeGreaterThan(250);
      expect(head).toBeLessThan(285);
      for (const f of ['FootLeft', 'FootRight'] as const) {
        const bottom = px(p.part(f).getWorldCenter().y) + 11;
        expect(bottom).toBeGreaterThan(340);
        expect(bottom).toBeLessThan(360);
      }
      // Hips stay below the head: it is hanging, not lying down.
      expect(px(p.ass.getWorldCenter().y)).toBeGreaterThan(head + 20);
    }
  });

  it('locks the head to its rail: upright, on the line, transients recover', () => {
    // jump() hits the HEAD at the FINGERTIPS (§16.7): a median ~300 rad/s spin
    // kick, up to ~2000 with asymmetric arms. The rail cancels nearly all of it,
    // but PrismBody is ~1:500 against the doll, so a sequential-impulse solver
    // can leave a residue for a frame or two (§18). Assert what matters: the
    // head stays upright in practice, and any excursion is a brief transient.
    const angles: number[] = [];
    let longestExcursion = 0;
    let maxGapPx = 0;
    for (const seed of [1, 2, 3]) {
      let resetAt = -10;
      let frame = 0;
      const gw = world({ events: { onNewRound: () => { resetAt = frame; } } });
      const r = rng(seed);
      const run = new Map<number, number>();
      for (frame = 0; frame < 900; frame++) {
        for (const c of [37, 38, 39, 40, 65, 68, 87, 83]) (r() < 0.2 ? gw.control.press(c) : gw.control.release(c));
        gw.step();
        if (gw.game.phase === 'matchOver') gw.game.resetMatch();
        // standPlayer() teleports the doll but, like the original, not PrismBody.
        if (frame - resetAt <= 1) continue;
        for (const p of [gw.p1, gw.p2]) {
          const deg = Math.abs(p.head.getAngle()) * 180 / Math.PI;
          angles.push(deg);
          const n = deg > 10 ? (run.get(p.id) ?? 0) + 1 : 0;
          run.set(p.id, n);
          longestExcursion = Math.max(longestExcursion, n);
          maxGapPx = Math.max(maxGapPx, px(Math.abs(p.head.getWorldCenter().x - p.prismBody.getWorldCenter().x)));
        }
      }
    }
    angles.sort((a, b) => a - b);
    expect(angles[Math.floor(angles.length * 0.5)]).toBeLessThan(0.5);
    expect(angles[Math.floor(angles.length * 0.99)]).toBeLessThan(6);
    expect(longestExcursion).toBeLessThanOrEqual(3); // frames
    expect(maxGapPx).toBeLessThan(12);
  });

  it('pulls PrismBody back under the head in one step after a round reset', () => {
    const gw = world();
    gw.control.press(39);
    run(gw, 90); // P1 is now pinned at the net-side limit
    gw.control.release(39);
    gw.p1.standPlayer(100, 256);
    expect(px(Math.abs(gw.p1.head.getWorldCenter().x - gw.p1.prismBody.getWorldCenter().x))).toBeGreaterThan(100);
    gw.step();
    expect(px(Math.abs(gw.p1.head.getWorldCenter().x - gw.p1.prismBody.getWorldCenter().x))).toBeLessThan(1);
    // ...without flinging the doll.
    expect(Math.abs(gw.p1.head.getLinearVelocity().x)).toBeLessThan(3);
  });

  it('keeps each player on their own half — both rails stop short of the net', () => {
    const gw = world();
    gw.control.press(39); // P1 runs right
    gw.control.press(65); // P2 runs left
    let p1Max = -1e9;
    let p2Min = 1e9;
    for (let i = 0; i < 30 * 8; i++) {
      gw.step();
      p1Max = Math.max(p1Max, px(gw.p1.prismBody.getWorldCenter().x));
      p2Min = Math.min(p2Min, px(gw.p2.prismBody.getWorldCenter().x));
    }
    expect(p1Max).toBeLessThan(320);
    expect(p1Max).toBeGreaterThan(250); // actually reached the limit (274)
    expect(p2Min).toBeGreaterThan(320);
    expect(p2Min).toBeLessThan(390); // actually reached the limit (368)
  });
});

describe('§17.3 controls', () => {
  it('holding right for one second carries the hips ~200 px', () => {
    const gw = world();
    run(gw, 90);
    const x0 = px(gw.p1.ass.getWorldCenter().x);
    gw.control.press(39);
    run(gw, 30);
    const travel = px(gw.p1.ass.getWorldCenter().x) - x0;
    expect(travel).toBeGreaterThan(140);
    expect(travel).toBeLessThan(260);
  });

  it('jump() lifts the head ~170 px — clearly above the 149 px net', () => {
    const gw = world();
    run(gw, 90);
    const y0 = px(gw.p1.head.getWorldCenter().y);
    gw.control.press(38);
    let peak = y0;
    for (let i = 0; i < 60; i++) {
      gw.step();
      peak = Math.min(peak, px(gw.p1.head.getWorldCenter().y));
    }
    expect(y0 - peak).toBeGreaterThan(149);
    expect(y0 - peak).toBeLessThan(220);
  });

  it('jump is consumed — it needs a fresh press', () => {
    const gw = world();
    run(gw, 90);
    gw.control.press(38);
    gw.step();
    expect(gw.control.isDown(38)).toBe(false);
  });

  it('jump only fires when the hips are low', () => {
    const gw = world();
    run(gw, 90);
    gw.control.press(38);
    run(gw, 8); // airborne now
    const vy = gw.p1.head.getLinearVelocity().y;
    gw.p1.jump(); // must be a no-op in the air
    expect(gw.p1.head.getLinearVelocity().y).toBe(vy);
  });
});

describe('§17.4 serve + rally rules', () => {
  it('holds the ball at the serving fingertip at level start', () => {
    const gw = world();
    expect(gw.ball.ballOfPlayer).toBe(1);
    expect(gw.ball.held).toBe(true);
    const f = gw.p1.servingFinger.getWorldCenter();
    const b = gw.ball.position;
    expect(px(Math.hypot(b.x - f.x, b.y - f.y))).toBeLessThan(1);
  });

  it('a jump-serve clears the hand and the net', () => {
    const gw = world();
    run(gw, 90);
    jumpServe(gw);
    expect(gw.ball.held).toBe(false);
    expect(gw.ball.ballOfPlayer).toBe(0);
    let apex = 1e9;
    let crossed = false;
    for (let i = 0; i < 90 && gw.game.phase === 'play'; i++) {
      gw.step();
      apex = Math.min(apex, px(gw.ball.position.y));
      if (px(gw.ball.position.x) > 320) crossed = true;
    }
    expect(apex).toBeLessThan(NET_TOP_PX);
    expect(crossed).toBe(true);
  });

  it('a serve spends the server’s touches: contact goes 2 then 3', () => {
    const gw = world();
    run(gw, 90);
    jumpServe(gw);
    expect(gw.p1.contact).toBeGreaterThanOrEqual(2);
    run(gw, 3); // past the 50 ms timer
    expect(gw.p1.contact).toBe(3);
  });

  it('a fresh player touch pops the ball up by 10 m/s', () => {
    const gw = world();
    run(gw, 60);
    // Release the ball by hand and drop it on player 2's head.
    jumpServe(gw);
    const head = gw.p2.head.getWorldCenter();
    gw.ball.body.setTransform(Vec2(head.x, head.y - toM(40)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 3));
    let touched = false;
    for (let i = 0; i < 20 && !touched; i++) {
      gw.step();
      if (gw.p2.contact > 0) touched = true;
    }
    expect(touched).toBe(true);
    expect(gw.p1.contact).toBe(0); // the other side's count resets
  });

  it('the floor ends the rally and scores on the correct side', () => {
    // Clear of both dolls (spawned at 100 and 500, arms reaching ±54).
    for (const [x, winner] of [[240, 2], [650, 1]] as const) {
      const gw = world();
      run(gw, 60);
      jumpServe(gw);
      gw.ball.body.setTransform(Vec2(toM(x), toM(300)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 5));
      untilPoint(gw);
      expect(gw.game.lastPointReason).toBe('floor');
      expect(gw.game.score[winner]).toBe(1);
    }
  });

  it('a fourth touch hands the point to the opponent', () => {
    const gw = world();
    run(gw, 60);
    jumpServe(gw);
    gw.p2.contact = 3;
    gw.p2.bContact = false;
    const head = gw.p2.head.getWorldCenter();
    gw.ball.body.setTransform(Vec2(head.x, head.y - toM(40)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 3));
    untilPoint(gw, 60);
    expect(gw.game.lastPointReason).toBe('touches');
    expect(gw.game.score[1]).toBe(1);
  });

  it('a held ball brushing the floor is not scored when it is served', () => {
    const gw = world();
    run(gw, 30);
    // Drag the held ball along the floor, as a fast walk with it can.
    gw.ball.body.setTransform(Vec2(gw.ball.position.x, toM(345)), 0);
    gw.step();
    expect(gw.flags.onBallDown).toBe(false);
    jumpServe(gw);
    run(gw, 3);
    expect(gw.game.phase).toBe('play');
  });

  it('the six-second serve clock gives the point away', () => {
    const gw = world();
    const frames = untilPoint(gw, 30 * 10);
    expect(gw.game.lastPointReason).toBe('serveClock');
    expect(gw.game.score[2]).toBe(1);
    expect(frames).toBeGreaterThanOrEqual(175);
    expect(frames).toBeLessThanOrEqual(185);
  });

  it('runs the goal replay in slow motion, then the winner serves', () => {
    const gw = world();
    untilPoint(gw, 30 * 10);
    expect(gw.game.timeStep).toBe(0.005);
    run(gw, 61);
    expect(gw.game.phase).toBe('play');
    expect(gw.game.timeStep).toBeCloseTo(TIME_STEP, 6);
    expect(gw.ball.ballOfPlayer).toBe(2); // player 2 won it
  });
});

describe('fixed serve and charged flip', () => {
  it('serves on press at fixed power, with no serve charge or swing on release', () => {
    const gw = world();
    run(gw, 90);
    gw.control.press(32);
    gw.step();
    expect(gw.ball.held).toBe(false);
    expect(gw.control.chargeLevel(1)).toBeNull();
    const swing = vi.spyOn(gw.p1, 'flip');
    run(gw, CHARGE.maxFrames);
    gw.control.release(32);
    gw.step();
    expect(swing).not.toHaveBeenCalled();
  });

  it('charges only a rally flip, then turns the doll a full backflip and re-locks the rail', () => {
    for (const id of [1, 2] as const) {
      const gw = hazardWorld({ hazards: false });
      const p = id === 1 ? gw.p1 : gw.p2;
      const key = id === 1 ? 32 : 82;
      gw.control.press(key);
      run(gw, CHARGE.maxFrames);
      expect(gw.control.chargeLevel(id)?.power).toBe(1);
      gw.control.release(key);
      gw.step();
      expect(p.flipping).toBe(true);
      expect(gw.swingEffects[id].power).toBe(1);
      // A backflip: player 1 (facing +x) turns anticlockwise, player 2 clockwise.
      const dir = id === 1 ? -1 : 1;
      const start = p.tors.getAngle();
      let turned = 0;
      let frames = 0;
      while (p.flipping && frames < FLIP.maxFrames + 2) {
        turned = Math.max(turned, (p.tors.getAngle() - start) * dir);
        gw.step();
        frames++;
      }
      expect(p.flipping).toBe(false);
      expect(frames).toBeLessThan(FLIP.maxFrames);
      expect(turned).toBeGreaterThan(Math.PI * 1.6);
      // The rail is back: the head is upright and rides its line again.
      run(gw, 10);
      expect(Math.abs(p.head.getAngle())).toBeLessThan(0.03);
      expect(px(Math.abs(p.head.getWorldCenter().x - p.prismBody.getWorldCenter().x))).toBeLessThan(1);
      expect(jointErrPx(p)).toBeLessThan(6);
    }
  });

  it('has no second attack key', () => {
    const gw = world();
    gw.control.press(16);
    run(gw, 5);
    gw.control.release(16);
    gw.step();
    expect(gw.ball.held).toBe(true);
    expect(gw.control.chargeLevel(1)).toBeNull();
    const rally = hazardWorld({ hazards: false });
    rally.control.press(16);
    run(rally, 5);
    expect(rally.control.chargeLevel(1)).toBeNull();
  });

  it('tucks the feet up and back during the windup, and locks steering while flipping', () => {
    const gw = hazardWorld({ hazards: false });
    const foot = gw.p1.part('FootLeft');
    const before = foot.getLinearVelocity().clone();
    gw.p1.windUp(1);
    expect(foot.getLinearVelocity().x).toBeLessThan(before.x);
    expect(foot.getLinearVelocity().y).toBeLessThan(before.y);

    gw.p1.flip();
    const spin = gw.p1.ass.getLinearVelocity().clone();
    gw.p1.turn(Vec2(4, 0));
    gw.p1.jump();
    expect(gw.p1.ass.getLinearVelocity()).toEqual(spin);
    expect(gw.p1.flip()).toBe(false);
  });

  it('slows physics only while charging', () => {
    const gw = hazardWorld({ hazards: false });
    const step = vi.spyOn(gw.world, 'step');
    gw.control.press(32);
    gw.step();
    gw.step();
    expect(step.mock.lastCall?.[0]).toBeCloseTo(TIME_STEP * CHARGE.windupTimeScale);
    run(gw, CHARGE.maxFrames);
    expect(step.mock.lastCall?.[0]).toBeCloseTo(TIME_STEP);
    gw.control.release(32);
    gw.step();
    expect(step.mock.lastCall?.[0]).toBeCloseTo(TIME_STEP);
  });

  it('has a 45-second flip cooldown, not shared across players', () => {
    const gw = hazardWorld({ hazards: false });
    const swing = vi.spyOn(gw.p1, 'flip');
    gw.control.press(32);
    run(gw, CHARGE.maxFrames);
    gw.control.release(32);
    gw.step();
    const firstHitFrame = gw.swingEffects[1].frame;
    expect(gw.swingCooldownFramesLeft(1)).toBe(SWING.cooldownFrames - 1);

    gw.control.press(32);
    run(gw, 3);
    expect(gw.control.chargeLevel(1)).toBeNull();
    gw.control.release(32);
    gw.step();
    expect(gw.swing(gw.p1, 1)).toBe(false);
    expect(swing).toHaveBeenCalledTimes(1);
    expect(gw.swing(gw.p2, 1)).toBe(true);

    run(gw, FLIP.maxFrames);
    gw.frame = firstHitFrame + SWING.cooldownFrames - 1;
    gw.control.press(32);
    gw.step();
    expect(gw.control.chargeLevel(1)).toBeNull();
    gw.step();
    expect(gw.control.chargeLevel(1)?.power).toBe(1 / CHARGE.maxFrames);
    gw.control.release(32);
    gw.step();
    expect(swing).toHaveBeenCalledTimes(2);
    expect(gw.swingEffects[1].power).toBe(1 / CHARGE.maxFrames);
  });

  it('holds the hit cooldown through a pause and resets it every round', () => {
    const gw = hazardWorld({ hazards: false });
    expect(gw.swing(gw.p1, 1)).toBe(true);
    expect(gw.swing(gw.p2, 1)).toBe(true);
    const remaining = gw.swingCooldownFramesLeft(1);
    gw.paused = true;
    run(gw, 30);
    expect(gw.swingCooldownFramesLeft(1)).toBe(remaining);
    gw.paused = false;
    run(gw, 30);
    expect(gw.swingCooldownFramesLeft(1)).toBe(remaining - 30);
    gw.game.newRound();
    expect(gw.swingCooldownFramesLeft(1)).toBe(0);
    expect(gw.swingCooldownFramesLeft(2)).toBe(0);
    gw.control.press(32);
    gw.step();
    gw.control.release(32);
    expect(gw.ball.held).toBe(false);
    gw.step();
    expect(gw.swing(gw.p1, 1)).toBe(true);
  });

  it('gently pulls a nearby free ball toward the kick point while charging', () => {
    const near = hazardWorld({ hazards: false });
    const idle = hazardWorld({ hazards: false });
    for (const gw of [near, idle]) {
      const hand = gw.p1.kickPoint;
      gw.ball.body.setTransform(Vec2(hand.x, hand.y - toM(50)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 0));
    }
    near.control.press(32);
    near.step();
    idle.step();
    expect(near.ball.velocity.y).toBeGreaterThan(idle.ball.velocity.y + 0.001);
  });

  it('knocks back a nearby opponent in proportion to flip charge', () => {
    const strike = (id: 1 | 2, power: number) => {
      const gw = hazardWorld({ hazards: false });
      gw.control.press(39);
      gw.control.press(65);
      run(gw, 90);
      gw.control.release(39);
      gw.control.release(65);
      const attacker = id === 1 ? gw.p1 : gw.p2;
      const defender = id === 1 ? gw.p2 : gw.p1;
      const sign = id === 1 ? 1 : -1;
      expect(Math.abs(px(defender.head.getWorldCenter().x - attacker.head.getWorldCenter().x)))
        .toBeLessThan(155);
      const before = defender.head.getLinearVelocity().x;
      const position = defender.head.getWorldCenter().x;
      gw.swing(attacker, power);
      expect(untilOpponentHit(gw, defender.id)).toBeGreaterThan(0);
      const speed = (defender.head.getLinearVelocity().x - before) * sign;
      run(gw, 4);
      expect(gw.opponentHitEffects[defender.id].frame).toBe(gw.frame - 5);
      const displacement = px(defender.head.getWorldCenter().x - position) * sign;
      return { speed, displacement };
    };

    for (const id of [1, 2] as const) {
      const tap = strike(id, 0);
      const full = strike(id, 1);
      expect(tap.speed).toBeGreaterThan(0);
      expect(full.speed).toBeGreaterThan(tap.speed * 2);
      expect(full.displacement).toBeGreaterThan(tap.displacement + 2);
    }
  });

  it('connects with an opponent near the edge of the kick reach', () => {
    const gw = hazardWorld({ hazards: false });
    gw.control.press(39);
    gw.control.press(65);
    run(gw, 90);
    gw.control.release(39);
    gw.control.release(65);

    const from = gw.p1.head.getWorldCenter();
    const target = gw.p2.tors.getWorldCenter();
    const shift = toM(215) - (target.x - from.x);
    for (const body of [...gw.p2.bodies, gw.p2.prismBody]) {
      const position = body.getPosition();
      body.setTransform(Vec2(position.x + shift, position.y), body.getAngle());
      body.setLinearVelocity(Vec2(0, 0));
      body.setAngularVelocity(0);
    }
    for (const body of [...gw.p1.bodies, gw.p1.prismBody]) {
      body.setLinearVelocity(Vec2(0, 0));
      body.setAngularVelocity(0);
    }

    gw.swing(gw.p1, 1);
    expect(untilOpponentHit(gw, 2)).toBeGreaterThan(0);
  });

  it('does not hit an opponent across the court', () => {
    const gw = hazardWorld({ hazards: false });
    gw.swing(gw.p1, 1);
    expect(untilOpponentHit(gw, 2)).toBe(-1);
    expect(gw.opponentHitEffects[2].frame).toBe(-100);
  });
});

describe('perfect contact, net counter, and desperate save', () => {
  it('kicks the ball only with the legs, and only during the flip', () => {
    const gw = hazardWorld({ hazards: false });
    gw.ball.body.setTransform(Vec2(toM(150), toM(120)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.flags.ballPlayerHits!.push({ playerId: 1, part: 'FootLeft' });
    gw.step();
    expect(gw.perfectEffects[1].frame).toBe(-100);
    gw.swing(gw.p1, 1);
    gw.flags.ballPlayerHits!.push({ playerId: 1, part: 'HandLeft' });
    gw.step();
    expect(gw.perfectEffects[1].frame).toBe(-100);
    gw.flags.ballPlayerHits!.push({ playerId: 1, part: 'FootRight' });
    gw.step();
    expect(gw.perfectEffects[1].frame).toBe(gw.frame - 1);
  });

  it('a flip that meets the ball kicks it over the net, harder with more charge', () => {
    const kick = (power: number) => {
      const gw = hazardWorld({ hazards: false });
      gw.world.setGravity(Vec2(0, 0));
      // Park the ball where the feet pass at the top of the turn.
      gw.swing(gw.p1, power);
      let hit = -1;
      for (let f = 0; f < FLIP.maxFrames && hit < 0; f++) {
        if (f === 0) {
          const k = gw.p1.kickPoint;
          gw.ball.body.setTransform(Vec2(k.x, k.y - toM(30)), 0);
          gw.ball.body.setLinearVelocity(Vec2(0, 0));
        }
        gw.step();
        if (gw.perfectEffects[1].frame >= 0) hit = f;
      }
      return { hit, vx: gw.ball.velocity.x };
    };
    const tap = kick(0);
    const full = kick(1);
    expect(full.hit).toBeGreaterThanOrEqual(0);
    expect(full.vx).toBeGreaterThan(6);
    expect(tap.hit).toBeGreaterThanOrEqual(0);
    expect(full.vx).toBeGreaterThan(tap.vx);

    // No flip, no kick.
    const late = hazardWorld({ hazards: false });
    late.swing(late.p1, 1);
    run(late, FLIP.maxFrames + 1);
    late.flags.ballPlayerHits!.push({ playerId: 1, part: 'FootLeft' });
    late.step();
    expect(late.perfectEffects[1].frame).toBe(-100);
  });

  it('counters two close swings by the net and sends the ball toward the weaker side', () => {
    const gw = hazardWorld({ hazards: false });
    gw.control.press(39);
    gw.control.press(65);
    run(gw, 90);
    gw.control.release(39);
    gw.control.release(65);
    const y = (gw.p1.head.getWorldCenter().y + gw.p2.head.getWorldCenter().y) / 2 - toM(70);
    gw.ball.body.setTransform(Vec2(toM(320), y), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.swing(gw.p1, 1);
    gw.swing(gw.p2, 0.5);
    gw.step();
    expect(gw.counterEffect.frame).toBe(gw.frame - 1);
    expect(gw.ball.velocity.x).toBe(0);
    run(gw, SWING.counterHoldFrames - 1);
    expect(gw.ball.velocity.x).toBeGreaterThan(0);
    expect(gw.opponentHitEffects[1].frame).toBe(-100);
    expect(gw.opponentHitEffects[2].frame).toBe(-100);
  });

  it('lets the computer prepare and answer a visible charge by the net', () => {
    const gw = hazardWorld({ singlePlayer: true, hazards: false });
    gw.ai!.update = () => {};
    gw.control.press(39);
    for (let i = 0; i < 90; i++) {
      gw.p2.turnComp(Vec2(-7, 0));
      gw.step();
    }
    gw.control.release(39);
    const y = (gw.p1.head.getWorldCenter().y + gw.p2.head.getWorldCenter().y) / 2 - toM(70);
    gw.ball.body.setTransform(Vec2(toM(320), y), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.flags.onBallDown = false;
    gw.control.press(32);
    run(gw, 6);
    gw.control.release(32);
    gw.step();
    expect(gw.swingEffects[2].frame).toBe(gw.frame - 1);
    gw.step();
    expect(gw.counterEffect.frame).toBe(gw.frame - 1);
  });

});

describe('ball off the body (not in the original)', () => {
  it('bounces 30% less elastic off every body part except the head', () => {
    const restitutionOff = (part: 'Head' | 'Tors' | 'ArmRight') => {
      const gw = hazardWorld({ hazards: false });
      const b = gw.p1.part(part).getWorldCenter();
      // Head from above; anything else from the net side, level with it.
      if (part === 'Head') {
        gw.ball.body.setTransform(Vec2(b.x, b.y - toM(40)), 0);
        gw.ball.body.setLinearVelocity(Vec2(0, 4));
      } else {
        gw.ball.body.setTransform(Vec2(b.x + toM(70), b.y), 0);
        gw.ball.body.setLinearVelocity(Vec2(-5, 0));
      }
      for (let i = 0; i < 20; i++) {
        gw.step();
        for (let ce = gw.ball.body.getContactList(); ce; ce = ce.next) {
          const d = ce.other!.getUserData() as { part?: string } | null;
          if (ce.contact.isTouching() && d?.part) return { part: d.part, e: ce.contact.getRestitution() };
        }
      }
      throw new Error('ball never touched ' + part);
    };
    const head = restitutionOff('Head');
    expect(head.part).toBe('Head');
    expect(head.e).toBeCloseTo(1.2, 6); // unchanged: max(ball 1, head 1.2)
    const tors = restitutionOff('Tors');
    expect(tors.part).not.toBe('Head');
    expect(tors.e).toBeCloseTo(0.7, 6);
  });
});

describe('§9 ball clamps', () => {
  it('clamps |vx| ≤ 15 and |vy| ≤ 20 every frame', () => {
    const gw = world();
    run(gw, 60);
    jumpServe(gw);
    gw.ball.body.setLinearVelocity(Vec2(80, -80));
    gw.ball.update();
    expect(gw.ball.velocity.x).toBe(15);
    expect(gw.ball.velocity.y).toBe(-20);
  });
});

describe('§17.5 AI + hazards', () => {
  it('the AI serves on its own, well before the clock runs out', () => {
    for (const level of [1, 6]) {
      const gw = world({ singlePlayer: true, level });
      gw.game.win1 = false;
      gw.game.newRound();
      expect(gw.ball.ballOfPlayer).toBe(2);
      let released = -1;
      for (let i = 0; i < 30 * 6 && released < 0; i++) {
        gw.step();
        if (gw.ball.ballOfPlayer === 0) released = i;
      }
      expect(released).toBeGreaterThan(0);
      expect(released).toBeLessThan(30 * 3);
      expect(gw.game.lastPointReason).not.toBe('serveClock');
    }
  });

});

describe('champion opponent', () => {
  const freeBall = (level: number, xPx: number, yPx: number, vx: number, vy: number) => {
    const gw = world({ singlePlayer: true, level, hazards: false });
    gw.world.destroyJoint(gw.p1.holdingJoint!);
    gw.p1.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.ball.body.setTransform(Vec2(toM(xPx), toM(yPx)), 0);
    gw.ball.body.setLinearVelocity(Vec2(vx, vy));
    return gw;
  };

  it('forecasts a long lob and a shot that rebounds from the net', () => {
    const clear = predictLanding(Vec2(toM(200), toM(100)), Vec2(8, 0));
    const blocked = predictLanding(Vec2(toM(200), toM(250)), Vec2(8, 0));
    expect(px(clear.x)).toBeGreaterThan(400);
    expect(px(clear.x)).toBeLessThan(600);
    expect(px(blocked.x)).toBeLessThan(320);
    expect(clear.seconds).toBeGreaterThan(1);
  });

  it('plans where the ball meets its head and sends a lob back over the net', () => {
    for (const [x, y, vx, vy] of [[200, 100, 8, 0], [150, 60, 6, -6], [260, 150, 4, -4]]) {
      const gw = freeBall(6, x, y, vx, vy);
      run(gw, 2);
      expect(gw.ai!.plan).not.toBeNull();
      let wasRight = false;
      let returned = false;
      for (let f = 0; f < 30 * 6 && gw.game.phase === 'play'; f++) {
        gw.step();
        const bx = px(gw.ball.position.x);
        if (bx > 340) wasRight = true;
        if (wasRight && bx < 300) returned = true;
      }
      expect(returned).toBe(true);
      expect(gw.game.score[1]).toBe(0);
    }
  });

  it('plays player 1 just as well, mirrored, in bot vs bot', () => {
    const gw = world({ botVsBot: true, level: 1, p1Level: 6, hazards: false });
    expect(gw.isCpu(1) && gw.isCpu(2)).toBe(true);
    while (gw.game.phase !== 'matchOver' && gw.frame < 30 * 60 * 5) {
      gw.step();
      gw.reap();
    }
    expect(gw.game.matchWinner ?? (gw.game.score[1] > gw.game.score[2] ? 1 : 2)).toBe(1);
    expect(gw.game.score[1]).toBeGreaterThan(gw.game.score[2] * 2);
  });

  it('still loses a point when the ball lands out of reach', () => {
    const gw = freeBall(6, 700, 330, 0, 12);
    const ordinary = freeBall(5, 700, 330, 0, 12);
    const headX = gw.p2.head.getWorldCenter().x;
    gw.step();
    ordinary.step();
    expect(gw.ball.position.x).toBeCloseTo(ordinary.ball.position.x, 6);
    expect(gw.ball.position.y).toBeCloseTo(ordinary.ball.position.y, 6);
    expect(gw.ball.velocity.y).toBeCloseTo(ordinary.ball.velocity.y, 6);
    run(gw, 2);
    expect(gw.game.lastPointReason).toBe('floor');
    expect(gw.game.score[1]).toBe(1);
    expect(Math.abs(px(gw.p2.head.getWorldCenter().x - headX))).toBeLessThan(100);
  });

  it('flips early at a falling ball so the legs meet it in front of the head', () => {
    const gw = freeBall(6, 500, 100, 0, 0);
    const head = gw.p2.head.getWorldCenter();
    // 45 px toward the net, falling into the kick zone over the next few frames.
    gw.ball.body.setTransform(Vec2(head.x - toM(45), head.y - toM(64)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 3));
    gw.step();
    expect(gw.swingEffects[2].frame).toBe(gw.frame - 1);
    expect(gw.p2.flipping).toBe(true);
  });

  it('loses on a fourth touch under the same rules as every other level', () => {
    const gw = world({ singlePlayer: true, level: 6, hazards: false });
    run(gw, 60);
    jumpServe(gw);
    gw.p2.contact = 3;
    gw.p2.bContact = false;
    const head = gw.p2.head.getWorldCenter();
    gw.ball.body.setTransform(Vec2(head.x, head.y - toM(40)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 3));
    untilPoint(gw, 60);
    expect(gw.game.lastPointReason).toBe('touches');
    expect(gw.game.score[1]).toBe(1);
  });
});

describe('hazards (reworked §13)', () => {
  const IDS = ['magnet', 'boxer', 'comet', 'spring', 'slime'] as const;

  /**
   * Mean speed over its first 15 s, after it has left the button; only while
   * in `phase`, if given (the slime spends most of its time riding its player).
   */
  const meanSpeed = (id: ExecuterId, phase?: string) => {
    const gw = hazardWorld({ executerOrder: [id] });
    fireAtButton(gw, 1);
    const e = gw.executers[0];
    let sum = 0;
    let n = 0;
    for (let f = 0; f < 30 * 15 && !e.dead; f++) {
      gw.step();
      if (f > 10 && (!phase || e.phase === phase)) {
        sum += e.body.getLinearVelocity().length();
        n++;
      }
    }
    return sum / n;
  };

  it('draws the five hazards in a shuffled order that both buttons share, and shows what comes next', () => {
    expect(EXECUTER_VARIANTS.map((v) => v.id).sort()).toEqual(['boxer', 'comet', 'magnet', 'slime', 'spring']);
    const gw = hazardWorld();
    const seen: string[] = [];
    for (let i = 0; i < 15; i++) {
      const side = i % 2 === 0 ? 1 : 2;
      const button = gw.ground.prizeButtons.find((b) => b.side === side)!;
      const upcoming = gw.executerQueue.peek(4).map((v) => v.id);
      fireAtButton(gw, side);
      const e = gw.executers.at(-1)!;
      // The preview was right, and the rest of it moves up one.
      expect(e.variant.id).toBe(upcoming[0]);
      expect(gw.executerQueue.peek(3).map((v) => v.id)).toEqual(upcoming.slice(1));
      expect(gw.executerLaunchEffect.variant).toBe(e.variant);
      expect(e.body.getMass()).toBeCloseTo(e.variant.mass, 4);
      expect(e.body.getFixtureList()!.getFriction()).toBe(e.variant.friction);
      seen.push(e.variant.id);
      e.destroy();
      gw.reap();
      run(gw, 20);
      expect(button.armed).toBe(true);
    }
    expect(gw.executerLaunches).toBe(15);
    // Each run of five has every hazard once; none comes twice in a row.
    for (let i = 0; i < seen.length; i += 5) expect(new Set(seen.slice(i, i + 5)).size).toBe(5);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    // And the order really is shuffled: other seeds, other orders.
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) =>
      world({ hazards: true, executerSeed: seed }).executerQueue.peek(8).map((v) => v.id).join()));
    expect(orders.size).toBeGreaterThan(2);
  });

  it('starts a fresh order for a new match', () => {
    const gw = hazardWorld();
    fireAtButton(gw, 1);
    expect(gw.executerLaunches).toBe(1);
    gw.game.resetMatch();
    expect(gw.executerLaunches).toBe(0);
    expect(gw.executers.every((e) => e.dead)).toBe(true);
    expect(gw.ground.prizeButtons[0].launches).toBe(0);
    expect(new Set(gw.executerQueue.peek(4).map((v) => v.id)).size).toBe(4);
  });

  it('the comet hunts fastest and the magnet slowest', () => {
    // The slime by its flight: stuck, it only moves as its player does.
    const speeds = Object.fromEntries(IDS.map((id) => [id, meanSpeed(id, id === 'slime' ? 'fly' : undefined)]));
    for (const id of IDS) {
      if (id !== 'comet') expect(speeds.comet).toBeGreaterThan(speeds[id]);
      if (id !== 'magnet') expect(speeds.magnet).toBeLessThan(speeds[id] / 2);
    }
  });

  it('the magnet drags a nearby player in, latches on, and slows their escape', () => {
    const parked = (distPx: number) => {
      const gw = hazardWorld({ executerOrder: ['magnet'] });
      fireAtButton(gw, 1);
      run(gw, 20);
      const e = gw.executers[0];
      const h = gw.p1.head.getWorldCenter();
      const t = gw.p1.tors.getWorldCenter();
      e.body.setTransform(Vec2(t.x + toM(distPx), (h.y + t.y) / 2), 0);
      e.body.setLinearVelocity(Vec2(0, 0));
      return { gw, e };
    };
    // Standing still, they are pulled a long way toward it in a second, and it latches.
    const idle = parked(120);
    const x0 = px(idle.gw.p1.ass.getWorldCenter().x);
    run(idle.gw, 30);
    expect(px(idle.gw.p1.ass.getWorldCenter().x) - x0).toBeGreaterThan(60);
    expect(idle.e.phase).toBe('latched');
    expect(idle.e.field).toBeGreaterThan(0.5);
    // Walking away from it is much slower than walking freely.
    const walk = (gw: GameWorld) => {
      const a = px(gw.p1.ass.getWorldCenter().x);
      gw.control.press(37);
      run(gw, 30);
      return a - px(gw.p1.ass.getWorldCenter().x);
    };
    const free = walk(hazardWorld({ hazards: false }));
    const held = walk(parked(60).gw);
    expect(held).toBeLessThan(free * 0.7);
  });

  it('the magnet bends a free ball toward it, but can never hold one up', () => {
    const setup = (hazards: boolean) => {
      const gw = hazardWorld({ hazards, executerOrder: ['magnet'] });
      if (hazards) fireAtButton(gw, 1);
      run(gw, 20);
      const e = gw.executers[0];
      e?.body.setTransform(Vec2(toM(60), toM(100)), 0);
      e?.body.setLinearVelocity(Vec2(0, 0));
      return gw;
    };
    // A ball dropped beside it curves in.
    const drift = (gw: GameWorld) => {
      gw.ball.body.setTransform(Vec2(toM(140), toM(60)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 0));
      run(gw, 8);
      return px(gw.ball.position.x) - 140;
    };
    expect(drift(setup(false))).toBeCloseTo(0, 0);
    expect(drift(setup(true))).toBeLessThan(-6);
    // A ball right underneath it slows, but still falls away from it.
    const gw = setup(true);
    const magnet = gw.executers[0].body;
    magnet.setTransform(Vec2(toM(-150), toM(0)), 0);
    gw.ball.body.setTransform(Vec2(toM(-150), toM(40)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    run(gw, 45);
    expect(px(gw.ball.position.y - magnet.getWorldCenter().y)).toBeGreaterThan(100);
    expect(gw.ball.velocity.y).toBeGreaterThan(2);
  });

  it('the boxer punches all over the body, not just the head', () => {
    const gw = hazardWorld({ executerOrder: ['boxer'] });
    fireAtButton(gw, 1);
    const e = gw.executers[0];
    const punched = new Set<string>();
    for (let f = 0; f < 30 * 20 && !e.dead; f++) {
      const aim = e.punchPart;
      const before = e.hits;
      gw.step();
      gw.reap();
      if (e.hits > before) punched.add(aim);
    }
    expect(punched.size).toBeGreaterThanOrEqual(5);
    expect([...punched].some((p) => p.startsWith('Leg') || p.startsWith('Foot'))).toBe(true);
    expect([...punched].some((p) => p.startsWith('Arm') || p.startsWith('Hand'))).toBe(true);
    expect([...punched].some((p) => p === 'Tors' || p === 'Ass')).toBe(true);
  });

  it('a punch nudges the player away during ordinary play', () => {
    for (const side of [1, 2] as const) {
      const gw = hazardWorld({ executerOrder: ['boxer'] });
      fireAtButton(gw, side);
      const e = gw.executers[0];
      const p = side === 1 ? gw.p1 : gw.p2;
      for (let i = 0; i < 30 * 20 && e.hits === 0; i++) {
        gw.step();
      }
      expect(e.hits).toBeGreaterThan(0);
      const direction = e.body.getWorldCenter().x < p.head.getWorldCenter().x ? 1 : -1;
      const before = px(p.head.getWorldCenter().x);
      gw.control.press(side === 1 ? 37 : 68);
      run(gw, 8);
      const recoilPx = (px(p.head.getWorldCenter().x) - before) * direction;
      expect(recoilPx).toBeGreaterThan(4);
      expect(recoilPx).toBeLessThan(40);
    }
  });

  it('the comet lines up on the ball’s side and rams its player away from the ball', () => {
    for (const ballSide of [1, -1] as const) {
      const gw = hazardWorld({ executerOrder: ['comet'] });
      fireAtButton(gw, 1);
      const e = gw.executers[0];
      const shifts: number[] = [];
      for (let f = 0; f < 30 * 12 && !e.dead; f++) {
        const t = gw.p1.tors.getWorldCenter();
        gw.ball.body.setTransform(Vec2(t.x + ballSide * toM(160), toM(120)), 0);
        gw.ball.body.setLinearVelocity(Vec2(0, 0));
        const before = e.hits;
        const x0 = px(gw.p1.ass.getWorldCenter().x);
        gw.step();
        gw.reap();
        if (e.hits === before) continue;
        expect(e.ramSide).toBe(ballSide);
        run(gw, 8);
        f += 8;
        shifts.push(px(gw.p1.ass.getWorldCenter().x) - x0);
      }
      expect(shifts.length).toBeGreaterThanOrEqual(5);
      const mean = shifts.reduce((a, b) => a + b, 0) / shifts.length;
      expect(mean * ballSide).toBeLessThan(-15);
    }
  });

  it('the spring slams harder after a longer run, rebounds, recovers and charges again', () => {
    const slam = (runUpPx: number) => {
      const gw = hazardWorld({ executerOrder: ['spring'] });
      fireAtButton(gw, 1);
      const e = gw.executers[0];
      // It settles level with its player before its first run.
      expect(e.phase).toBe('recover');
      for (let f = 0; f < 30 * 6 && e.phase !== 'charge'; f++) gw.step();
      expect(e.phase).toBe('charge');
      const h = gw.p1.head.getWorldCenter();
      const t = gw.p1.tors.getWorldCenter();
      e.body.setTransform(Vec2(t.x + toM(runUpPx + 20), (h.y + t.y) / 2), 0);
      e.body.setLinearVelocity(Vec2(0, 0));
      e.travel = 0;
      const x0 = px(gw.p1.ass.getWorldCenter().x);
      for (let f = 0; f < 90 && e.hits === 0; f++) gw.step();
      expect(e.hits).toBe(1);
      expect(e.phase).toBe('rebound');
      const rebound = e.body.getLinearVelocity().length();
      run(gw, 20);
      return { gw, e, power: e.lastImpact!.power, rebound, pushed: x0 - px(gw.p1.ass.getWorldCenter().x) };
    };
    const short = slam(50);
    const long = slam(200);
    expect(long.power).toBeGreaterThan(short.power + 0.25);
    expect(long.rebound).toBeGreaterThan(short.rebound + 1.5);
    expect(long.pushed).toBeGreaterThan(short.pushed * 2);
    expect(long.pushed).toBeGreaterThan(60);
    // Then it brakes to a stop, settles, and comes again.
    const phases: string[] = [];
    for (let f = 0; f < 30 * 5 && long.e.hits < 2; f++) {
      long.gw.step();
      if (phases.at(-1) !== long.e.phase) phases.push(long.e.phase);
    }
    expect(phases.slice(0, 2)).toEqual(['recover', 'charge']);
    expect(long.e.hits).toBe(2);
  });

  /** Which limb a part is on, as the slime sees it. */
  const limbOf = (b: Body) => ud(b).part!.replace(/^(Arm|Hand|Finger)/, 'arm').replace(/^(Leg|Foot)/, 'leg');

  /** A slime launched at `side`, stepped until it is stuck. */
  const stuckSlime = (side: 1 | 2) => {
    const gw = hazardWorld({ executerOrder: ['slime'] });
    fireAtButton(gw, side);
    const e = gw.executers[0];
    expect(e.phase).toBe('fly');
    for (let f = 0; f < 30 * 6 && e.phase !== 'stuck'; f++) gw.step();
    expect(e.phase).toBe('stuck');
    return { gw, e, player: side === 1 ? gw.p1 : gw.p2 };
  };

  it('the slime flies at a limb, sticks to it, and glues another limb to it', () => {
    const { gw, e, player } = stuckSlime(2);
    expect(player.bodies).toContain(e.host);
    // It rides on the part as a sensor, not as a heavy body jointed to it.
    expect(e.body.getFixtureList()!.isSensor()).toBe(true);
    const held = new Map<Body, number>();
    let longest = 0;
    for (let f = 0; f < SLIME.holdFrames - 1; f++) {
      gw.step();
      expect(e.phase).toBe('stuck');
      const a = e.host!.getWorldPoint(e.hostAnchor);
      expect(px(Vec2.distance(e.body.getWorldCenter(), a))).toBeLessThan(1);
      for (const bond of e.bonds) {
        // A part of another limb, and held to it.
        expect(limbOf(bond.part)).not.toBe(limbOf(e.host!));
        expect(px(Vec2.distance(bond.part.getWorldPoint(bond.local), a))).toBeLessThan(SLIME.glueReachPx + SLIME.breakPx);
        held.set(bond.part, (held.get(bond.part) ?? 0) + 1);
        longest = Math.max(longest, held.get(bond.part)!);
      }
    }
    // Standing still, the glue holds for seconds.
    expect(longest).toBeGreaterThan(60);
    // Then it lets go of everything by itself.
    gw.step();
    expect(e.phase).toBe('recover');
    expect(e.bonds).toHaveLength(0);
  });

  it('struggling tears the slime’s strands, which shortens its hold; it comes back after letting go', () => {
    const gw = hazardWorld({ executerOrder: ['slime'] });
    fireAtButton(gw, 1);
    const e = gw.executers[0];
    const stints: Array<{ frames: number; snaps: number }> = [];
    for (let f = 0; f < 30 * 25 && !e.dead; f++) {
      SCRIPTS.hop(f, gw);
      const was = e.phase;
      const snaps = e.snaps;
      gw.step();
      gw.reap();
      if (e.phase === 'stuck' && was !== 'stuck') stints.push({ frames: 0, snaps: 0 });
      if (was === 'stuck') {
        stints.at(-1)!.frames += 1;
        stints.at(-1)!.snaps += e.snaps - snaps;
      }
    }
    expect(stints.length).toBeGreaterThanOrEqual(2);
    expect(e.snaps).toBeGreaterThan(0);
    for (const s of stints.slice(0, -1)) {
      if (s.snaps > 0) expect(s.frames).toBeLessThan(SLIME.holdFrames);
      else expect(s.frames).toBe(SLIME.holdFrames);
    }
  });

  it('a flip spins the slime off and frees what it glued', () => {
    for (const side of [1, 2] as const) {
      for (const hand of ['Left', 'Right'] as const) {
        const gw = hazardWorld({ executerOrder: ['slime'] });
        fireAtButton(gw, side);
        const e = gw.executers[0];
        const player = side === 1 ? gw.p1 : gw.p2;
        run(gw, 20);
        // Splat it onto that hand.
        const finger = player.part(`Finger${hand}`).getWorldCenter();
        e.body.setTransform(Vec2(finger.x + toM(hand === 'Right' ? 20 : -20), finger.y), 0);
        e.body.setLinearVelocity(Vec2(0, 0));
        e.aimPart = `Hand${hand}`;
        run(gw, 30);
        expect(e.phase).toBe('stuck');
        expect(limbOf(e.host!)).toBe(`arm${hand}`);
        gw.swing(player, 1);
        run(gw, 3);
        expect(e.host).toBeNull();
        expect(e.bonds).toHaveLength(0);
        const away = e.body.getWorldCenter().x - player.head.getWorldCenter().x;
        expect(e.body.getLinearVelocity().x * away).toBeGreaterThan(0);
      }
    }
  });

  it('the shield won’t take the slime’s glue, and a new round shakes it off', () => {
    const gw = hazardWorld({ executerOrder: ['slime'] });
    gw.powerUps.activate(2, 'shield', gw.frame);
    fireAtButton(gw, 2);
    const e = gw.executers[0];
    let splats = 0;
    for (let f = 0; f < 30 * 8; f++) {
      const was = e.phase;
      gw.step();
      expect(e.phase).not.toBe('stuck');
      if (was === 'fly' && e.phase === 'recover') splats++;
    }
    expect(splats).toBeGreaterThan(0);

    const { gw: next, e: stuck } = stuckSlime(2);
    run(next, 60);
    next.game.newRound();
    expect(stuck.phase).toBe('recover');
    expect(stuck.host).toBeNull();
    expect(stuck.bonds).toHaveLength(0);
  });

  it('a flip whose legs meet any hazard throws it away', () => {
    for (const side of [1, 2] as const) {
      for (const id of IDS) {
        const gw = hazardWorld({ executerOrder: [id] });
        fireAtButton(gw, side);
        const e = gw.executers[0];
        const player = side === 1 ? gw.p1 : gw.p2;
        run(gw, 20);
        gw.swing(player, 1);
        let knocked = false;
        for (let f = 0; f < FLIP.maxFrames && !knocked; f++) {
          // Hold it where the feet sweep through until they get there.
          if (e.knockbackFrames === 0) {
            const k = player.kickPoint;
            e.body.setTransform(Vec2(k.x, k.y - toM(20)), 0);
            e.body.setLinearVelocity(Vec2(0, 0));
          }
          gw.step();
          knocked = e.knockbackFrames > 0;
        }
        expect(knocked, `${id} on side ${side}`).toBe(true);
        const away = e.body.getWorldCenter().x - player.head.getWorldCenter().x;
        expect(e.body.getLinearVelocity().x * away).toBeGreaterThan(0);
      }
    }
  });

  it('a ball on a button launches an executer out of it at once, into that button’s half', () => {
    for (const side of [1, 2] as const) {
      const gw = hazardWorld();
      const button = gw.ground.prizeButtons.find((b) => b.side === side)!;
      const frames = fireAtButton(gw, side);
      expect(frames).toBeLessThanOrEqual(1); // the step it touched, not after the rally
      expect(gw.executers).toHaveLength(1);
      const ex = gw.executers[0];
      expect(ex.side).toBe(side);
      expect(ex.target).toBe(side === 1 ? gw.p1 : gw.p2);
      // Out of the button's face, level with it.
      const p = ex.body.getWorldCenter();
      expect(Math.abs(px(p.y) - button.def.y)).toBeLessThan(20);
      expect(Math.abs(px(p.x) - button.def.x)).toBeLessThan(40);
      expect(button.armed).toBe(false);
    }
  });
  it('stays pressed while its executer lives, then pops back out armed', () => {
    const gw = hazardWorld();
    fireAtButton(gw, 1);
    const button = gw.ground.prizeButtons[0];
    const ex = gw.executers[0];
    expect(button.executers).toContain(ex);
    run(gw, 30 * 24);
    expect(button.armed).toBe(false);
    run(gw, 30 * 2);
    expect(ex.dead).toBe(true);
    expect(gw.executers).toHaveLength(0);
    expect(button.armed).toBe(true);
    expect(button.releasedAt).toBeGreaterThan(button.pressedAt);
  });

  it('every hit launches another executer — no limit — and one impact is one launch', () => {
    const gw = hazardWorld();
    const button = gw.ground.prizeButtons[1];
    for (let i = 0; i < 5; i++) {
      fireAtButton(gw, 2);
      run(gw, 20);
    }
    expect(gw.executers).toHaveLength(5);
    expect(button.executers).toHaveLength(5);
    expect(button.armed).toBe(false);
    // It stays pressed until the last of them dies.
    gw.executers[0].destroy();
    gw.reap();
    expect(button.armed).toBe(false);
    for (const e of gw.executers.slice()) e.destroy();
    gw.reap();
    expect(button.armed).toBe(true);
  });

  it('comes out as a sensor, so it cannot spawn inside the ball, then turns solid', () => {
    const gw = hazardWorld();
    fireAtButton(gw, 1);
    const ex = gw.executers[0];
    expect(ex.solid).toBe(false);
    expect(ex.body.getFixtureList()!.isSensor()).toBe(true);
    run(gw, 20);
    expect(ex.solid).toBe(true);
    expect(ex.body.getFixtureList()!.isSensor()).toBe(false);
  });

  it('with hazards off a button still clicks, launches nothing and pops back', () => {
    const gw = hazardWorld({ hazards: false });
    fireAtButton(gw, 1);
    const button = gw.ground.prizeButtons[0];
    expect(gw.executers).toHaveLength(0);
    expect(gw.executerLaunches).toBe(0);
    expect(button.armed).toBe(false);
    run(gw, 20);
    expect(button.armed).toBe(true);
  });

  it('never crosses to the other half, whatever its target does', () => {
    for (const side of [1, 2] as const) {
      for (const id of IDS) {
        const gw = hazardWorld({ executerOrder: [id] });
        fireAtButton(gw, side);
        const ex = gw.executers[0];
        const r = rng(side);
        const keys = side === 1 ? [37, 38, 39, 40] : [65, 68, 87, 83];
        for (let f = 0; f < 30 * 20 && !ex.dead; f++) {
          for (const c of keys) (r() < 0.1 ? gw.control.press(c) : gw.control.release(c));
          gw.step();
          const x = px(ex.body.getWorldCenter().x);
          if (side === 1) expect(x).toBeLessThan(320);
          else expect(x).toBeGreaterThan(320);
        }
      }
    }
  });

  it('hits and holds the doll without tearing it apart or passing through it', () => {
    // Deterministic scripts on the player's own half, each run with and
    // without each hazard parked at the doll. The doll's own motion already
    // stretches its joints (the original's jump is violent), so a hazard is
    // judged against that, not against zero. The hazards now throw the doll
    // around on purpose, so it meets its rail limits harder and more often:
    // a little more stretch is allowed, never a sustained tear.
    for (const name of Object.keys(SCRIPTS)) {
      const alone = ramScenario(name, null);
      for (const id of IDS) {
        const r = ramScenario(name, id);
        // It really was at the doll.
        if (id === 'magnet') expect(r.contactFrames).toBeGreaterThan(100);
        else expect(r.hits).toBeGreaterThanOrEqual(5);
        expect(r.longestTear).toBeLessThanOrEqual(alone.longestTear + 6);
        expect(r.tornFrames).toBeLessThanOrEqual(alone.tornFrames + 8);
        expect(r.maxJointPx).toBeLessThan(45);
        // It never sits inside the doll. A limb meeting it at speed — a
        // comet or spring at 10–16 m/s, a fingertip flung 25 m/s by a jump —
        // can overlap it for a single frame before the solver pushes it out,
        // and that is all.
        expect(r.longestDeepRun).toBeLessThanOrEqual(2);
        expect(r.deepFrames).toBeLessThanOrEqual(12);
        expect(r.maxPenetrationPx).toBeLessThan(40);
      }
    }
  });

  it('(negative control) the original 400 kg crusher does tear a standing doll', () => {
    const r = ramScenario('idle', 'crusher', undefined, 10);
    expect(r.maxJointPx).toBeGreaterThan(20);
    expect(r.longestTear).toBeGreaterThan(10); // sustained, not a blip
  });
});

describe('§17 soak', () => {
  it('90 s of random input: points on both sides, never a non-finite position', () => {
    const r = rng(12345);
    let points = 0;
    const gw = world({ hazards: true, events: { onPoint: () => { points++; } } });
    const codes = [37, 39, 38, 40, 32, 65, 68, 87, 83, 82];
    for (let i = 0; i < 30 * 90; i++) {
      for (const c of codes) (r() < 0.12 ? gw.control.press(c) : gw.control.release(c));
      gw.step();
      gw.reap();
      for (const b of gw.world.getBodyList() ? [gw.ball.body, ...gw.p1.bodies, ...gw.p2.bodies] : []) {
        const p = b.getPosition();
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`non-finite at frame ${i}`);
      }
      if (gw.game.phase === 'matchOver') gw.game.resetMatch();
    }
    expect(points).toBeGreaterThan(0);
  });

  it('scores on both sides across seeds', () => {
    let p1 = 0;
    let p2 = 0;
    for (const seed of [1, 2, 3]) {
      const r = rng(seed);
      const gw = world();
      for (let i = 0; i < 30 * 60; i++) {
        for (const c of [37, 39, 38, 40, 32, 65, 68, 87, 83, 82]) (r() < 0.12 ? gw.control.press(c) : gw.control.release(c));
        gw.step();
        if (gw.game.phase === 'matchOver') gw.game.resetMatch();
      }
      p1 += gw.game.score[1];
      p2 += gw.game.score[2];
    }
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(0);
  });

  it('is deterministic: same inputs, same world', () => {
    const snap = () => {
      const r = rng(99);
      const gw = world({ singlePlayer: true, hazards: true });
      for (let i = 0; i < 30 * 20; i++) {
        for (const c of [37, 39, 38, 32]) (r() < 0.15 ? gw.control.press(c) : gw.control.release(c));
        gw.step();
        gw.reap();
      }
      const b = gw.ball.position;
      return [b.x, b.y, gw.game.score[1], gw.game.score[2], gw.p2.head.getWorldCenter().x];
    };
    expect(snap()).toEqual(snap());
  });
});
