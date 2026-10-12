import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { AIR_HEATER, CENTER_OBSTACLES, ORIGINAL_PLAYER_HEIGHT_PX, normalizeCenterObstacle } from '../src/sim/centerObstacle';
import { NET_TOP_PX, NET_X_PX, PARTS, SPAWN_P1_PX, SPAWN_P2_PX, toM, toPx } from '../src/sim/constants';
import { ud } from '../src/sim/types';
import { hazardWorld, run, world } from './helpers';

describe('centre obstacle selection and round lifecycle', () => {
  it('defaults to the classic spike and accepts all four variants', () => {
    expect(world().centerObstacle.id).toBe('classic');
    expect(normalizeCenterObstacle('unknown')).toBe('classic');
    for (const option of CENTER_OBSTACLES) expect(world({ centerObstacle: option.id }).centerObstacle.id).toBe(option.id);
  });

  it.each([1, 2] as const)('heals both players before player %s receives the next serve', server => {
    const gw = world();
    gw.p1.sever('Head'); gw.p1.sever('ArmRight'); gw.p2.sever('LegLeft');
    gw.game.win1 = server === 1;
    gw.game.newRound();
    for (const player of [gw.p1, gw.p2]) {
      expect(player.injured).toBe(false);
      expect(player.bodies).toHaveLength(PARTS.length);
      expect(player.revolutes).toHaveLength(12);
      expect(player.head).toBe(player.part('Head'));
      for (const body of player.bodies) expect(ud(body).detachedScale).toBeUndefined();
    }
    expect(gw.ball.ballOfPlayer).toBe(server);
    expect((server === 1 ? gw.p1 : gw.p2).holdingJoint).not.toBeNull();
    run(gw, 20);
  });

  it('heals injuries when the point replay automatically starts the next round', () => {
    const gw = world();
    gw.p1.sever('ArmLeft'); gw.p2.sever('Head');
    gw.serve(gw.p1); gw.p1.contact = 4;
    gw.step();
    expect(gw.game.phase).toBe('goal');
    run(gw, 61);
    expect(gw.game.phase).toBe('play');
    expect(gw.p1.injured || gw.p2.injured).toBe(false);
    expect(gw.game.score).toEqual({ 1: 0, 2: 1 });
  });
});

describe('sharp spike', () => {
  it.each([1, 2] as const)('catches player %s at the tip without severing its skeleton or ending the rally', id => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const player = id === 1 ? gw.p1 : gw.p2;
    const hand = player.part('FingerLeft');
    hand.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6)), 0);
    gw.step();
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    expect(player.injured).toBe(false);
    expect(player.revolutes).toHaveLength(12);
    expect(gw.game.phase).toBe('play');
    run(gw, 25);
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    const pin = gw.centerObstacle.pins.get(hand)!;
    expect(toPx(Vec2.distance(pin.getAnchorA(), pin.getAnchorB()))).toBeLessThan(5);
    gw.game.win1 = id === 1;
    gw.game.newRound();
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(player.holdingJoint).not.toBeNull();
    run(gw, 20);
    expect(player.injured).toBe(false);
  });

  it('catches a fast crossing and clears all pins on a match reset', () => {
    const gw = world({ centerObstacle: 'sharp' });
    const hand = gw.p1.part('FingerLeft');
    hand.setTransform(Vec2(toM(NET_X_PX - 35), toM(NET_TOP_PX - 6)), 0);
    gw.centerObstacle.beforeStep([gw.p1]);
    hand.setTransform(Vec2(toM(NET_X_PX + 35), toM(NET_TOP_PX - 6)), 0);
    gw.centerObstacle.afterStep([gw.p1]);
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    gw.game.resetMatch();
    expect(gw.centerObstacle.pins.size).toBe(0);
  });

  it('ignores shields and harmless contacts below the point', () => {
    const gw = world({ centerObstacle: 'sharp' });
    const hand = gw.p1.part('FingerLeft');
    gw.p1.power = 'shield';
    hand.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6)), 0);
    gw.centerObstacle.beforeStep([gw.p1]); gw.centerObstacle.afterStep([gw.p1]);
    gw.p1.power = null;
    hand.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX + 25)), 0);
    gw.centerObstacle.beforeStep([gw.p1]); gw.centerObstacle.afterStep([gw.p1]);
    expect(gw.centerObstacle.pins.size).toBe(0);
  });
});

describe('air heater', () => {
  /** Free one player body from its joints to measure only the physical air field. */
  function airProbe(dx: number, dy = 0, scale = 1) {
    const gw = world({ centerObstacle: 'blower', physics: { gravity: 0 } });
    const player = gw.p1;
    player.resizeTo(scale, true);
    const body = player.part('FingerLeft');
    for (let edge = body.getJointList(); edge;) {
      const next = edge.next; gw.world.destroyJoint(edge.joint!); edge = next;
    }
    body.setTransform(Vec2(toM(NET_X_PX + dx), toM(NET_TOP_PX + dy)), 0);
    body.setLinearVelocity(Vec2(0, 0));
    gw.centerObstacle.beforeStep([player]);
    gw.world.step(1 / 28);
    return { gw, body };
  }

  it('uses a fixed radius of 30% of the original player height', () => {
    expect(ORIGINAL_PLAYER_HEIGHT_PX).toBe(109);
    expect(AIR_HEATER.rangePx).toBeCloseTo(32.7);
    for (const scale of [0.75, 1, 1.5]) {
      expect(airProbe(25, 40, scale).body.getLinearVelocity().x).toBeGreaterThan(0);
      expect(airProbe(50, 40, scale).body.getLinearVelocity().x).toBe(0);
    }
  });

  it('repels on both sides and above the column, with a weaker force farther away', () => {
    expect(airProbe(-20, 40).body.getLinearVelocity().x).toBeLessThan(0);
    expect(airProbe(20, 40).body.getLinearVelocity().x).toBeGreaterThan(0);
    expect(airProbe(0, -20).body.getLinearVelocity().y).toBeLessThan(0);
    expect(airProbe(12, 40).body.getLinearVelocity().x).toBeGreaterThan(airProbe(30, 40).body.getLinearVelocity().x);
  });

  it('leaves body parts attached and does not apply the air field to the ball', () => {
    const gw = world({ centerObstacle: 'blower', physics: { gravity: 0 } });
    gw.serve(gw.p1);
    gw.ball.body.setTransform(Vec2(toM(NET_X_PX + 20), toM(240)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.p1.part('FingerLeft').setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6)), 0);
    gw.centerObstacle.beforeStep([gw.p1, gw.p2]);
    gw.centerObstacle.afterStep([gw.p1, gw.p2]);
    expect(gw.ball.velocity).toEqual(Vec2(0, 0));
    expect(gw.p1.injured || gw.p2.injured).toBe(false);
  });
});

describe('rubber net', () => {
  it.each([1, 2] as const)('bends under player %s pressure toward the opposing half and returns after release', id => {
    const gw = hazardWorld({ centerObstacle: 'rubber' });
    const player = id === 1 ? gw.p1 : gw.p2;
    const sign = id === 1 ? 1 : -1;
    player.standPlayer(id === 1 ? 260 : 380, 256);
    let bend = 0;
    const tip = gw.centerObstacle.bodies.at(-1)!;
    for (let frame = 0; frame < 45; frame++) {
      player.turn(Vec2(sign * 4, 0)); gw.step();
      bend = Math.max(bend, sign * (toPx(tip.getPosition().x) - NET_X_PX));
    }
    expect(bend).toBeGreaterThan(25);
    expect(player.injured).toBe(false);
    const spawn = id === 1 ? SPAWN_P1_PX : SPAWN_P2_PX;
    player.standPlayer(spawn.x, spawn.y);
    run(gw, 180);
    expect(Math.abs(toPx(tip.getPosition().x) - NET_X_PX)).toBeLessThan(5);
    gw.game.newRound();
    for (const body of gw.centerObstacle.bodies) {
      expect(body.getAngle()).toBe(0);
      expect(toPx(body.getPosition().x)).toBe(NET_X_PX);
      expect(body.getLinearVelocity()).toEqual(Vec2(0, 0));
    }
  });

  it('also bends when hit by the ball', () => {
    const gw = hazardWorld({ centerObstacle: 'rubber' });
    gw.ball.body.setTransform(Vec2(toM(NET_X_PX - 35), toM(NET_TOP_PX + 12)), 0);
    gw.ball.body.setLinearVelocity(Vec2(12, 0));
    let bend = 0;
    for (let frame = 0; frame < 20; frame++) {
      gw.step(); bend = Math.max(bend, toPx(gw.centerObstacle.bodies.at(-1)!.getPosition().x) - NET_X_PX);
    }
    expect(bend).toBeGreaterThan(10);
  });
});

describe('obstacle physics under repeated play', () => {
  it.each(CENTER_OBSTACLES.map(option => option.id))('keeps %s finite through movement, flips and round resets', id => {
    const gw = world({ centerObstacle: id, hazards: true, bees: true });
    for (let frame = 0; frame < 900; frame++) {
      for (const player of [gw.p1, gw.p2]) {
        if (frame % 120 < 60) player.turn(Vec2(player.id === 1 ? 4 : -4, 0));
        if (frame % 60 === 0) player.jump();
        if (frame % 90 === 10) {
          if (gw.ball.ballOfPlayer === player.id) gw.serve(player);
          else gw.swing(player, 0.7);
        }
      }
      gw.step(); gw.reap();
      if (frame % 150 === 0) gw.game.newRound();
      for (let body = gw.world.getBodyList(); body; body = body.getNext()) {
        const p = body.getPosition(), v = body.getLinearVelocity();
        expect(Number.isFinite(p.x + p.y + v.x + v.y + body.getAngle())).toBe(true);
      }
    }
  });
});
