import { Vec2, type Body } from 'planck';
import { describe, expect, it } from 'vitest';
import { BODYTYPE, NET_TOP_PX, NET_X_PX, PARTS, toM } from '../src/sim/constants';
import { NetSpike } from '../src/sim/netSpike';
import { ud } from '../src/sim/types';
import { closedPoses } from '../src/render/dollPose';
import { Interpolator } from '../src/render/interp';
import { run, world } from './helpers';

const bladePosition = Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6));

describe('net blade collision', () => {
  it.each([1, 2] as const)('cuts player %s at the tip during the real game step without ending the rally', id => {
    const gw = world();
    const player = id === 1 ? gw.p1 : gw.p2;
    player.part('FingerLeft').setTransform(bladePosition, 0);
    gw.step();
    expect(player.isAttached('FingerLeft')).toBe(false);
    expect(player.injured).toBe(true);
    expect(gw.game.phase).toBe('play');
    expect(gw.game.score).toEqual({ 1: 0, 2: 0 });
  });

  it('detects a fast crossing even when neither endpoint touches the blade', () => {
    const gw = world();
    const blade = new NetSpike();
    const finger = gw.p1.part('FingerLeft');
    finger.setTransform(Vec2(toM(NET_X_PX - 35), bladePosition.y), 0);
    blade.capture([gw.p1]);
    finger.setTransform(Vec2(toM(NET_X_PX + 35), bladePosition.y), 0);
    expect(blade.hits(gw.p1)).toContain('FingerLeft');
  });

  it('leaves parts touching the side of the pole below the blade attached', () => {
    const gw = world();
    const blade = new NetSpike();
    gw.p1.part('FingerLeft').setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX + 25)), 0);
    blade.capture([gw.p1]);
    expect(blade.hits(gw.p1)).toEqual([]);
  });

  it('respects shield protection and ignores detached parts', () => {
    const gw = world();
    const blade = new NetSpike();
    gw.p1.part('FingerLeft').setTransform(bladePosition, 0);
    gw.p1.power = 'shield';
    blade.capture([gw.p1]);
    expect(blade.hits(gw.p1)).toEqual([]);
    expect(gw.p1.sever('FingerLeft')).toBe(false);
    gw.p1.power = null;
    expect(gw.p1.sever('FingerLeft')).toBe(true);
    expect(blade.hits(gw.p1)).toEqual([]);
  });
});

describe('playing with injuries', () => {
  it('detaches the whole limb beyond a cut while retaining its internal joints', () => {
    const gw = world();
    expect(gw.p1.sever('ArmRight')).toBe(true);
    expect(gw.p1.detachedBodies.map(body => ud(body).part).sort()).toEqual(['ArmRight', 'FingerRight', 'HandRight']);
    expect(gw.p1.bodies).toHaveLength(10);
    expect(gw.p1.revolutes).toHaveLength(9);
    expect(gw.p1.sever('ArmRight')).toBe(false);
    expect(gw.p1.isAttached('Tors')).toBe(true);
    expect(gw.p1.isAttached('ArmLeft')).toBe(true);
    expect(gw.p1.part('HandRight').getJointList()).not.toBeNull();
  });

  it.each([1, 2] as const)('keeps player %s serving after losing the holding hand and both arms', id => {
    const gw = world();
    const player = id === 1 ? gw.p1 : gw.p2;
    gw.game.win1 = id === 1;
    gw.game.newRound();
    const oldHand = player.servingFinger;
    player.sever(ud(oldHand).part!);
    expect(player.holdingJoint?.getBodyA()).not.toBe(oldHand);
    expect(player.bodies).toContain(player.holdingJoint?.getBodyA());
    player.sever('ArmLeft');
    player.sever('ArmRight');
    expect(player.servingFinger).toBe(player.tors);
    expect(player.holdingJoint?.getBodyA()).toBe(player.tors);
    gw.serve(player);
    expect(gw.ball.held).toBe(false);
    expect(gw.ball.ballOfPlayer).toBe(0);
    expect(player.contact).toBe(2);
  });

  it('leaves detached parts free of controls and lets them fall onto the court', () => {
    const gw = world();
    gw.p1.sever('FootLeft');
    const foot = gw.p1.part('FootLeft');
    foot.setTransform(Vec2(toM(-100), toM(150)), 0);
    foot.setLinearVelocity(Vec2(2, 0));
    foot.setAngularVelocity(3);
    gw.p1.turnDown();
    gw.p1.windUp(1);
    gw.p1.knock(Vec2(2, -2), 4);
    gw.p1.flip();
    gw.p1.endFlip();
    gw.game.newRound();
    expect(foot.getLinearVelocity()).toEqual(Vec2(2, 0));
    expect(foot.getAngularVelocity()).toBe(3);
    expect(foot.getPosition().y).toBe(toM(150));
    expect(gw.p1.isStrikingPart('FootLeft')).toBe(false);
    let reachedFloor = false;
    for (let i = 0; i < 70; i++) {
      gw.step();
      for (let edge = foot.getContactList(); edge; edge = edge.next) {
        if (edge.other === gw.ground.floor && edge.contact.isTouching()) reachedFloor = true;
      }
    }
    expect(reachedFloor).toBe(true);
  });

  it('does not count a detached hand hitting the ball as a player touch', () => {
    const gw = world();
    gw.p1.sever('FingerLeft');
    gw.serve(gw.p1);
    gw.p1.contact = gw.p2.contact = 0;
    const hand = gw.p1.part('FingerLeft');
    hand.setTransform(Vec2(toM(-100), toM(180)), 0);
    hand.setLinearVelocity(Vec2(0, 0));
    gw.ball.body.setTransform(Vec2(toM(-100), toM(167)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 2));
    let touchedHand = false;
    gw.world.on('begin-contact', contact => {
      const a = contact.getFixtureA().getBody(), b = contact.getFixtureB().getBody();
      if ((a === hand && b === gw.ball.body) || (b === hand && a === gw.ball.body)) touchedHand = true;
    });
    run(gw, 2);
    expect(ud(hand).e_bodytype).toBe(BODYTYPE.DEBRIS);
    expect(touchedHand).toBe(true);
    expect(gw.p1.contact).toBe(0);
    expect(gw.p2.contact).toBe(0);
  });

  it('preserves cuts and debris size through size powers and restores the complete body for a new match', () => {
    const gw = world();
    gw.p1.sever('LegLeft');
    const foot = gw.p1.part('FootLeft');
    const fixture = foot.getFixtureList();
    const position = foot.getPosition().clone();
    gw.p1.resizeTo(1.5, true);
    expect(gw.p1.isAttached('FootLeft')).toBe(false);
    expect(gw.p1.revolutes).toHaveLength(10);
    expect(foot.getFixtureList()).toBe(fixture);
    expect(foot.getPosition()).toEqual(position);
    expect(gw.p1.partScale('FootLeft')).toBe(1);
    gw.game.newRound();
    expect(gw.p1.injured).toBe(true);
    gw.game.resetMatch();
    expect(gw.p1.injured).toBe(false);
    expect(gw.p1.bodies).toHaveLength(13);
    expect(gw.p1.revolutes).toHaveLength(12);
    expect(gw.p1.sizeScale).toBe(1);
    expect(ud(foot).e_bodytype).toBe(BODYTYPE.PLAYER);
    run(gw, 30);
  });

  it('transfers the rail after losing the head mid-flip and keeps control over the surviving body', () => {
    const gw = world();
    run(gw, 60);
    gw.serve(gw.p1);
    gw.p1.flip();
    run(gw, 3);
    expect(gw.p1.sever('Head')).toBe(true);
    expect(gw.p1.head).toBe(gw.p1.part('Tors'));
    expect(gw.p1.railV.getBodyB()).toBe(gw.p1.head);
    gw.p1.resizeTo(1.5, true);
    gw.game.newRound();
    run(gw, 30);
    const before = gw.p1.ass.getLinearVelocity().x;
    gw.p1.turn(Vec2(4, 0));
    expect(gw.p1.ass.getLinearVelocity().x).toBeGreaterThan(before);
    gw.p1.jump();
    gw.p1.flip();
    run(gw, 60);
    gw.game.resetMatch();
    expect(gw.p1.head).toBe(gw.p1.part('Head'));
    for (const player of [gw.p1, gw.p2]) for (const body of player.parts.values()) {
      expect(Number.isFinite(body.getPosition().x + body.getPosition().y + body.getAngle())).toBe(true);
    }
  });

  it('can render and serve with only the surviving head without joining debris back to it', () => {
    const gw = world();
    gw.p1.sever('Tors');
    expect(gw.p1.bodies).toEqual([gw.p1.head]);
    expect(gw.p1.sever('Head')).toBe(false);
    gw.game.newRound();
    const beforeJump = gw.p1.head.getLinearVelocity().y;
    gw.p1.jump();
    expect(gw.p1.head.getLinearVelocity().y).toBeLessThan(beforeJump);
    gw.p1.turnDown();
    gw.p1.resizeTo(0.75, true);
    const interp = new Interpolator();
    const all: Body[] = [];
    for (let body = gw.world.getBodyList(); body; body = body.getNext()) all.push(body);
    interp.commit(all);
    const poses = closedPoses(interp, 1, [gw.p1, gw.p2], gw.ball.body);
    for (const def of PARTS) {
      const body = gw.p1.part(def.name);
      expect(Number.isFinite(poses.pose(body, 1).x)).toBe(true);
      if (!gw.p1.isAttached(def.name)) expect(poses.pose(body, 1)).toEqual(interp.pose(body, 1));
    }
    gw.serve(gw.p1);
    expect(gw.ball.held).toBe(false);
    run(gw, 90);
  });

  it('keeps the simulation finite through successive cuts of the rail host', () => {
    const gw = world();
    for (const name of ['Head', 'Tors', 'Ass', 'LegLeft'] as const) {
      expect(gw.p1.sever(name)).toBe(true);
      gw.p1.resizeTo(1.5, true);
      gw.game.newRound();
      gw.p1.turn(Vec2(4, 0));
      gw.p1.jump();
      gw.p1.flip();
      run(gw, 35);
      gw.p1.resizeTo(1, true);
      for (const body of gw.p1.parts.values()) {
        expect(Number.isFinite(body.getPosition().x + body.getPosition().y + body.getAngle())).toBe(true);
      }
    }
    expect(gw.p1.bodies).toEqual([gw.p1.part('FootLeft')]);
    gw.game.resetMatch();
    run(gw, 60);
    expect(gw.p1.bodies).toHaveLength(13);
    expect(gw.p1.revolutes).toHaveLength(12);
  });
});
