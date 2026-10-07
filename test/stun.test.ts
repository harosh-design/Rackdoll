import { Box, Circle, Vec2, World } from 'planck';
import { describe, expect, it } from 'vitest';
import { ACTIONS, BODYTYPE, CHARGE, FLIP, STUN } from '../src/sim/constants';
import { installContactListener, type ContactFlags } from '../src/sim/contacts';
import type { PlayerId } from '../src/sim/player';
import { hazardWorld, run, untilOpponentHit, world } from './helpers';

describe('head-hit stun', () => {
  it.each([1, 2] as const)('stuns player %s when the flip kick reaches their head', (defenderId) => {
    const gw = hazardWorld({ hazards: false });
    gw.p1.standPlayer(210, 256);
    gw.p2.standPlayer(420, 256);
    const defender = defenderId === 1 ? gw.p1 : gw.p2;
    const attacker = defenderId === 1 ? gw.p2 : gw.p1;
    gw.swing(attacker);
    expect(untilOpponentHit(gw, defenderId)).toBeGreaterThan(0);
    expect(defender.stunFrames).toBe(STUN.frames);
    expect(defender.controlScale).toBe(0.2);
    run(gw, STUN.frames - 1);
    expect(defender.controlScale).toBe(0.2);
    run(gw, 1);
    expect(defender.stunFrames).toBe(0);
    expect(defender.controlScale).toBe(1);
  });

  it('knocks back a body hit without stunning, and misses beyond the kick range', () => {
    const body = hazardWorld({ hazards: false });
    body.world.setGravity(Vec2(0, 0));
    body.p1.standPlayer(210, 190);
    body.p2.standPlayer(420, 256);
    body.swing(body.p1);
    expect(untilOpponentHit(body, 2)).toBeGreaterThan(0);
    expect(body.p2.stunFrames).toBe(0);

    const far = hazardWorld({ hazards: false });
    far.swing(far.p1);
    run(far, FLIP.maxFrames + 1);
    expect(far.opponentHitEffects[2].frame).toBe(-100);
    expect(far.p2.stunFrames).toBe(0);
  });

  it('records physical opposing leg-head contacts without involving the ball', () => {
    const physics = new World({ gravity: Vec2(0, 0) });
    const head = physics.createDynamicBody(Vec2(0, 0));
    head.createFixture(Circle(0.3), { density: 1, friction: 0.51 });
    head.setUserData({ e_bodytype: BODYTYPE.PLAYER, playerId: 2, part: 'Head' });
    const hand = physics.createDynamicBody(Vec2(0.25, 0));
    hand.createFixture(Box(0.1, 0.1), { density: 1, friction: 0.5 });
    hand.setUserData({ e_bodytype: BODYTYPE.PLAYER, playerId: 1, part: 'FootRight' });
    const flags: ContactFlags = { onBallDown: false, bYesPrize: false, prizeHits: [], playerHeadHits: [] };
    installContactListener(physics, flags);
    physics.step(1 / 30);
    expect(flags.playerHeadHits).toContainEqual({ attackerId: 1, part: 'FootRight' });
  });

  const kicks: Array<[PlayerId, 'FootLeft' | 'LegRight']> = [[1, 'FootLeft'], [1, 'LegRight'], [2, 'FootLeft'], [2, 'LegRight']];
  it.each(kicks)('recognizes a direct head hit by player %s with the %s', (id, part) => {
    const gw = hazardWorld({ hazards: false });
    const attacker = id === 1 ? gw.p1 : gw.p2;
    const defender = id === 1 ? gw.p2 : gw.p1;
    // The players are outside kick range, isolating the direct contact path.
    gw.flags.playerHeadHits!.push({ attackerId: id, part });
    gw.step();
    expect(defender.stunFrames).toBe(0);
    gw.swing(attacker, 1);
    gw.flags.playerHeadHits!.push({ attackerId: id, part: 'HandLeft' });
    gw.step();
    expect(defender.stunFrames).toBe(0);
    gw.flags.playerHeadHits!.push({ attackerId: id, part });
    gw.step();
    expect(defender.stunFrames).toBe(STUN.frames);
    run(gw, 5);
    expect(defender.stunFrames).toBe(STUN.frames - 5);
  });

  it('keeps the shield immune to both the kick and a direct head hit', () => {
    const gw = hazardWorld({ hazards: false });
    gw.p1.standPlayer(210, 256);
    gw.p2.standPlayer(420, 256);
    gw.powerUps.activate(2, 'shield', gw.frame);
    gw.swing(gw.p1);
    run(gw, FLIP.maxFrames);
    expect(gw.p2.stunFrames).toBe(0);
    expect(gw.opponentHitEffects[2].frame).toBe(-100);
    gw.game.newRound();
    // newRound holds the ball; release it before the direct swing.
    const grip = gw.p1.holdingJoint ?? gw.p2.holdingJoint;
    if (grip) gw.world.destroyJoint(grip);
    gw.p1.forgetBallJoint();
    gw.p2.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.swing(gw.p1);
    gw.flags.playerHeadHits!.push({ attackerId: 1, part: 'FootLeft' });
    gw.step();
    expect(gw.p2.stunFrames).toBe(0);
    expect(gw.opponentHitEffects[2].frame).toBe(-100);
  });

  it('freezes with pause, refreshes to three seconds, and clears on round/match reset', () => {
    const gw = hazardWorld({ hazards: false });
    gw.p1.stun();
    gw.paused = true;
    run(gw, 100);
    expect(gw.p1.stunFrames).toBe(STUN.frames);
    gw.paused = false;
    run(gw, 50);
    gw.p1.stun();
    run(gw, STUN.frames - 1);
    expect(gw.p1.stunFrames).toBe(1);
    gw.game.newRound();
    expect(gw.p1.controlScale).toBe(1);
    gw.p2.stun();
    gw.game.resetMatch();
    expect(gw.p2.controlScale).toBe(1);
  });
});

describe('weakened controls while stunned', () => {
  it.each(['turn', 'turnComp'] as const)('reduces %s to twenty percent', (action) => {
    const normal = world();
    const dazed = world();
    dazed.p1.stun();
    normal.p1[action](Vec2(ACTIONS.turnImpulse, 0));
    dazed.p1[action](Vec2(ACTIONS.turnImpulse, 0));
    expect(dazed.p1.ass.getLinearVelocity().x).toBeCloseTo(normal.p1.ass.getLinearVelocity().x * 0.2);
  });

  it('keeps held movement sluggish throughout the stun', () => {
    const distance = (stunned: boolean) => {
      const gw = hazardWorld({ hazards: false });
      const start = gw.p1.head.getWorldCenter().x;
      if (stunned) gw.p1.stun();
      gw.control.press(39);
      run(gw, 20);
      return gw.p1.head.getWorldCenter().x - start;
    };
    const normal = distance(false);
    const dazed = distance(true);
    expect(dazed).toBeGreaterThan(0);
    expect(dazed).toBeLessThan(normal * 0.4);
  });

  it('weakens jumping, crouching and the flip windup', () => {
    const normal = world();
    const dazed = world();
    dazed.p1.stun();
    normal.p1.jump();
    dazed.p1.jump();
    expect(dazed.p1.ass.getLinearVelocity().y).toBeCloseTo(normal.p1.ass.getLinearVelocity().y * 0.2);
    normal.p1.turnDown();
    dazed.p1.turnDown();
    expect(dazed.p1.part('FootLeft').getLinearVelocity().y).toBeCloseTo(normal.p1.part('FootLeft').getLinearVelocity().y * 0.2);
    const foot = (gw: typeof normal) => gw.p1.part('FootRight').getLinearVelocity().x;
    const n0 = foot(normal);
    const d0 = foot(dazed);
    normal.p1.windUp(1);
    dazed.p1.windUp(1);
    expect(foot(dazed) - d0).toBeCloseTo((foot(normal) - n0) * 0.2);
  });

  it('charges five times slower and restores the normal rate after stun expires', () => {
    const gw = hazardWorld({ hazards: false });
    gw.p1.stun();
    gw.control.press(32);
    run(gw, 10);
    expect(gw.control.chargeLevel(1)?.power).toBeCloseTo(2 / CHARGE.maxFrames);
    run(gw, STUN.frames - 11);
    const before = gw.control.chargeLevel(1)!.power;
    run(gw, 1);
    expect(gw.control.chargeLevel(1)!.power - before).toBeCloseTo(1 / CHARGE.maxFrames);
  });

  it('weakens the punch wave itself as well as the arm impulse', () => {
    const measure = (stunned: boolean) => {
      const gw = hazardWorld({ hazards: false });
      gw.p1.standPlayer(210, 256);
      gw.p2.standPlayer(420, 256);
      if (stunned) gw.p1.stun();
      gw.swing(gw.p1);
      run(gw, 3);
      return gw.p2.head.getLinearVelocity().x;
    };
    expect(measure(true)).toBeCloseTo(measure(false) * 0.2, 2);
  });
});
