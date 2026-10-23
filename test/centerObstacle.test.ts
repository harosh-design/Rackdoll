import { Circle, Vec2, type Body } from 'planck';
import { describe, expect, it } from 'vitest';
import { AIR_HEATER, CENTER_OBSTACLES, ORIGINAL_PLAYER_HEIGHT_PX, SHARP_SPIKE, normalizeCenterObstacle } from '../src/sim/centerObstacle';
import { NET_TOP_PX, NET_X_PX, PARTS, SPAWN_P1_PX, SPAWN_P2_PX, TIME_STEP, toM, toPx, type PartName } from '../src/sim/constants';
import { KEYS } from '../src/sim/control';
import { Executer } from '../src/sim/executer';
import { EXECUTER_VARIANTS } from '../src/sim/executerVariants';
import type { Player } from '../src/sim/player';
import { ud } from '../src/sim/types';
import type { GameWorld } from '../src/sim/world';
import { fireAtButton, hazardWorld, run, world } from './helpers';

describe('centre obstacle selection and round lifecycle', () => {
  it('defaults to the sharp spike and accepts all three variants', () => {
    expect(world().centerObstacle.id).toBe('sharp');
    expect(normalizeCenterObstacle('unknown')).toBe('sharp');
    expect(normalizeCenterObstacle('classic')).toBe('sharp');
    expect(CENTER_OBSTACLES.map(option => option.id)).toEqual(['sharp', 'blower', 'rubber']);
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
    hand.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 10)), 0);
    gw.step();
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    expect(player.impaled).toBe(true);
    expect(gw.centerObstacle.bloodstains).toHaveLength(1);
    expect(player.injured).toBe(false);
    expect(player.skeletonJoints).toHaveLength(12);
    expect(gw.game.phase).toBe('play');
    run(gw, 25);
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    const pin = gw.centerObstacle.pins.get(hand)!;
    expect(toPx(Vec2.distance(pin.wound.getAnchorA(), pin.wound.getAnchorB()))).toBeLessThan(5);
    gw.game.win1 = id === 1;
    gw.game.newRound();
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(player.impaled).toBe(false);
    expect(player.revolutes).toHaveLength(12);
    expect(player.ligaments).toHaveLength(0);
    expect(gw.centerObstacle.bloodstains).toHaveLength(0);
    expect(player.holdingJoint).not.toBeNull();
    run(gw, 20);
    expect(player.injured).toBe(false);
  });

  it('catches a fast crossing and clears all pins on a match reset', () => {
    const gw = world({ centerObstacle: 'sharp' });
    const hand = gw.p1.part('FingerLeft');
    hand.setTransform(Vec2(toM(NET_X_PX - 35), toM(NET_TOP_PX - 10)), 0);
    gw.centerObstacle.beforeStep([gw.p1]);
    hand.setTransform(Vec2(toM(NET_X_PX + 35), toM(NET_TOP_PX - 10)), 0);
    gw.centerObstacle.afterStep([gw.p1]);
    expect(gw.centerObstacle.pins.has(hand)).toBe(true);
    gw.game.resetMatch();
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(gw.p1.impaled).toBe(false);
    expect(gw.centerObstacle.bloodstains).toHaveLength(0);
  });

  it.each([1, 2] as const)('leaves player %s untouched when the point only grazes a part', id => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const player = id === 1 ? gw.p1 : gw.p2;
    player.part('FingerLeft').setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 6)), 0);
    gw.step();
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(player.impaled).toBe(false);
    expect(player.stretched).toBe(false);
    expect(gw.centerObstacle.bloodstains).toHaveLength(0);
  });

  it('ignores harmless contacts below the point', () => {
    const gw = world({ centerObstacle: 'sharp' });
    const hand = gw.p1.part('FingerLeft');
    hand.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX + 25)), 0);
    gw.centerObstacle.beforeStep([gw.p1]); gw.centerObstacle.afterStep([gw.p1]);
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(gw.p1.impaled).toBe(false);
    expect(gw.centerObstacle.bloodstains).toHaveLength(0);
  });

  it('ages blood without adding another stain for the same pinned part', () => {
    const gw = world({ centerObstacle: 'sharp' });
    gw.p1.part('FingerLeft').setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 10)), 0);
    for (let frame = 0; frame < 30; frame++) {
      gw.centerObstacle.beforeStep([gw.p1]); gw.centerObstacle.afterStep([gw.p1]);
    }
    expect(gw.centerObstacle.pins.size).toBe(1);
    expect(gw.centerObstacle.bloodstains).toHaveLength(1);
    expect(gw.centerObstacle.bloodstains[0].age).toBe(29);
  });
});

describe('sharp spike struggle', () => {
  /** Lift the whole doll so one part (by default its net-side finger) sits 2 px down the point, and catch it there. */
  function catchPart(gw: GameWorld, player: Player, name: PartName = player.id === 1 ? 'FingerRight' : 'FingerLeft'): Body {
    const part = player.part(name);
    const delta = Vec2.sub(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 10)), part.getPosition());
    for (const body of [...player.bodies, player.prismBody]) {
      body.setTransform(Vec2.add(body.getPosition(), delta), body.getAngle());
      body.setLinearVelocity(Vec2(0, 0)); body.setAngularVelocity(0);
    }
    gw.centerObstacle.beforeStep([player]); gw.centerObstacle.afterStep([player]);
    expect(gw.centerObstacle.depthPx(part)).toBeCloseTo(2, 5);
    return part;
  }
  const pxPerFrame = toPx(SHARP_SPIKE.struggleSpeed * TIME_STEP);

  it.each([1, 2] as const)('lets player %s drive a caught part deeper with down and pull it off with up', id => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const player = id === 1 ? gw.p1 : gw.p2;
    const part = catchPart(gw, player);
    const { jump, down } = KEYS[id];

    gw.control.press(down); run(gw, 20); gw.control.release(down);
    const deep = gw.centerObstacle.depthPx(part)!;
    expect(deep).toBeCloseTo(2 + 20 * pxPerFrame, 1);
    // Each 10 px driven deeper bleeds again. Neighbours dragged onto the point are caught and bleed too.
    const deepestStain = Math.max(...gw.centerObstacle.bloodstains.map(stain => stain.height));
    expect(deepestStain).toBeGreaterThan(SHARP_SPIKE.topPx + deep - SHARP_SPIKE.bleedEveryPx);
    run(gw, 30);
    expect(gw.centerObstacle.depthPx(part)).toBeCloseTo(deep, 5);

    gw.control.press(jump);
    let frames = 0;
    while (gw.centerObstacle.pins.has(part) && frames < 90) { run(gw, 1); frames++; }
    gw.control.release(jump);
    // A deeper wound takes longer to pull out.
    expect(frames).toBe(Math.ceil(deep / pxPerFrame));
    expect(player.impaled).toBe(false);
    expect(player.injured).toBe(false);

    // The freed part is not caught again on its way off the point, and its hinges heal.
    run(gw, 30);
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(player.stretched).toBe(false);
    expect(player.revolutes).toHaveLength(12);
    expect(gw.game.phase).toBe('play');
  });

  it('stops a part at the deepest point and holds it there', () => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const part = catchPart(gw, gw.p1, 'FootRight');
    gw.control.press(KEYS[1].down); run(gw, 80); gw.control.release(KEYS[1].down);
    expect(gw.centerObstacle.depthPx(part)).toBeCloseTo(SHARP_SPIKE.maxDepthPx, 5);
    run(gw, 30);
    expect(gw.centerObstacle.depthPx(part)).toBeCloseTo(SHARP_SPIKE.maxDepthPx, 5);
    expect(gw.p1.impaled).toBe(true);
  });

  it('ignores sideways keys, and the CPU stays caught', () => {
    const gw = hazardWorld({ centerObstacle: 'sharp', singlePlayer: true });
    const part = catchPart(gw, gw.p1);
    const cpuPart = catchPart(gw, gw.p2);
    for (const key of [KEYS[1].left, KEYS[1].right, KEYS[2].jump]) {
      gw.control.press(key); run(gw, 25); gw.control.release(key);
    }
    expect(gw.centerObstacle.depthPx(part)).toBeCloseTo(2, 5);
    expect(gw.centerObstacle.depthPx(cpuPart)).toBeCloseTo(2, 5);
  });

  it('drives a caught part deeper when knocked down or sideways, but not when lifted', () => {
    const depthAfter = (dv: Vec2) => {
      const gw = hazardWorld({ centerObstacle: 'sharp' });
      const part = catchPart(gw, gw.p1);
      gw.p1.knock(dv, 12);
      run(gw, 40);
      return gw.centerObstacle.depthPx(part)!;
    };
    expect(depthAfter(Vec2(0, -4))).toBeCloseTo(2, 5);
    const sideways = depthAfter(Vec2(-6, 0));
    expect(sideways).toBeGreaterThan(15);
    expect(depthAfter(Vec2(6, 0))).toBeCloseTo(sideways, 5);
    expect(depthAfter(Vec2(0, 6))).toBeGreaterThan(sideways);
  });

  it('drives a caught part deeper when the opponent’s flip kick lands', () => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const part = catchPart(gw, gw.p1);
    (gw as unknown as { applyOpponentHit(attacker: 1 | 2, power: number, strength: number, head: boolean): void })
      .applyOpponentHit(2, 1, 1, false);
    run(gw, 40);
    expect(gw.centerObstacle.depthPx(part)).toBeGreaterThan(10);
  });

  it.each([1, 2] as const)('tears player %s’s caught hand off when it struggles away hard, leaving the hand on the spike', id => {
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    const player = id === 1 ? gw.p1 : gw.p2;
    const side = id === 1 ? 'Right' : 'Left';
    const hand = catchPart(gw, player, `Hand${side}`);
    const away = id === 1 ? KEYS[1].left : KEYS[2].right;
    gw.control.press(away);
    let frames = 0;
    while (!player.injured && frames < 120) { run(gw, 1); frames++; }
    gw.control.release(away);
    // It takes a sustained struggle, not one tug.
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(90);
    expect(player.isAttached(`Hand${side}`)).toBe(false);
    expect(player.isAttached(`Finger${side}`)).toBe(false);
    expect(player.isAttached(`Arm${side}`)).toBe(true);
    expect(player.impaled).toBe(false);
    expect(gw.game.phase).toBe('play');
    // The torn hand stays on the spike; the player's keys no longer move it.
    const depth = gw.centerObstacle.depthPx(hand)!;
    gw.control.press(KEYS[id].down); run(gw, 20); gw.control.release(KEYS[id].down);
    expect(gw.centerObstacle.depthPx(hand)).toBeCloseTo(depth, 5);
    gw.game.win1 = id === 1;
    gw.game.newRound();
    expect(gw.centerObstacle.pins.size).toBe(0);
    expect(player.injured).toBe(false);
    expect(player.revolutes).toHaveLength(12);
  });

  it('never tears off the head or torso, and needs struggling to tear a limb', () => {
    for (const name of ['Head', 'Tors'] as const) {
      const gw = hazardWorld({ centerObstacle: 'sharp' });
      catchPart(gw, gw.p1, name);
      gw.control.press(KEYS[1].left); run(gw, 120); gw.control.release(KEYS[1].left);
      expect(gw.p1.injured).toBe(false);
      expect(gw.p1.impaled).toBe(true);
    }
    // Hanging still, or knocked about by a hazard, without struggling.
    const gw = hazardWorld({ centerObstacle: 'sharp' });
    catchPart(gw, gw.p1, 'HandRight');
    for (let i = 0; i < 4; i++) { gw.p1.knock(Vec2(-6, 0), 12); run(gw, 30); }
    expect(gw.p1.injured).toBe(false);
    expect(gw.p1.impaled).toBe(true);
  });

  it('is driven deeper by a comet hitting the caught doll', () => {
    const gw = hazardWorld({ centerObstacle: 'sharp', executerOrder: ['comet'] });
    const part = catchPart(gw, gw.p1);
    run(gw, 20);
    fireAtButton(gw, 1);
    run(gw, 120);
    expect(gw.centerObstacle.depthPx(part)).toBeGreaterThan(10);
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

  it('increases the previous side acceleration by 15% and makes lift exactly one third as strong', () => {
    const gw = world({ map: 'crematorium', physics: { gravity: 0 } });
    for (const mass of [0.1, 20]) {
      for (const [dx, dy] of [[16, 40], [0, -16], [-16, 40]]) {
        const body = gw.world.createBody({ type: 'dynamic', position: Vec2(toM(NET_X_PX + dx), toM(NET_TOP_PX + dy)) });
        body.createFixture(Circle(toM(3)), { density: 1, isSensor: true });
        body.setMassData({ mass, center: Vec2(0, 0), I: 1 });
        gw.centerObstacle.beforeStep([gw.p1, gw.p2], true, undefined, 0.01);
        gw.world.step(0.01);
        const sideSpeed = 585 * 1.15 * (1 - 10 / AIR_HEATER.rangePx) * 0.01;
        expect(body.getLinearVelocity().x).toBeCloseTo(dx === 0 ? 0 : Math.sign(dx) * sideSpeed, 6);
        expect(body.getLinearVelocity().y).toBeCloseTo(dx === 0 ? -sideSpeed / 3 : 0, 6);
        gw.world.destroyBody(body);
      }
    }
    const diagonal = gw.centerObstacle.windAt(Vec2(toM(NET_X_PX + 20), toM(NET_TOP_PX - 20)));
    expect(diagonal.x).toBeGreaterThan(0);
    expect(diagonal.y / diagonal.x).toBeCloseTo(-1 / 3);
  });

  it('pushes the ball, detached limbs and unclassified new physical objects', () => {
    const gw = world({ centerObstacle: 'blower', physics: { gravity: 0 } });
    gw.serve(gw.p1);
    gw.ball.body.setTransform(Vec2(toM(NET_X_PX + 24), toM(240)), 0);
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    const finger = gw.p1.part('FingerLeft');
    gw.p1.sever('FingerLeft');
    finger.setTransform(Vec2(toM(NET_X_PX - 20), toM(270)), 0);
    finger.setLinearVelocity(Vec2(0, 0));
    const item = gw.world.createBody({ type: 'dynamic', position: Vec2(toM(NET_X_PX + 18), toM(295)) });
    item.createFixture(Circle(toM(3)), { density: 1 });
    gw.centerObstacle.beforeStep([gw.p1, gw.p2]);
    gw.world.step(0.01);
    expect(gw.ball.velocity.x).toBeGreaterThan(0);
    expect(finger.getLinearVelocity().x).toBeLessThan(0);
    expect(item.getLinearVelocity().x).toBeGreaterThan(0);
  });

  it.each(EXECUTER_VARIANTS)('pushes the $id executer, including sensors and kinematic bodies', variant => {
    const gw = world({ map: 'crematorium', physics: { gravity: 0 } });
    const origin = Vec2(toM(NET_X_PX + 28), toM(NET_TOP_PX + 40));
    const executer = new Executer({ world: gw.world, timers: gw.timers, target: gw.p1, side: 1, variant, origin });
    executer.body.setTransform(origin, 0);
    executer.body.setLinearVelocity(Vec2(0, 0));
    gw.centerObstacle.beforeStep([gw.p1, gw.p2], true, undefined, 0.01);
    gw.world.step(0.01);
    expect(executer.body.getLinearVelocity().x).toBeGreaterThan(0);
    expect(executer.body.getPosition().x).toBeGreaterThan(origin.x);
  });

  it('has no wind outside play, beyond its reach or on the other maps', () => {
    for (const map of ['graveyard', 'crematorium', 'dead-circus'] as const) {
      const gw = world({ map, physics: { gravity: 0 } });
      const body = gw.world.createBody({ type: 'dynamic', position: Vec2(toM(NET_X_PX + 20), toM(250)) });
      body.createFixture(Circle(toM(2)), { density: 1, isSensor: true });
      gw.centerObstacle.beforeStep([gw.p1, gw.p2], map !== 'crematorium');
      gw.world.step(0.01);
      expect(body.getLinearVelocity()).toEqual(Vec2(0, 0));
      expect(gw.centerObstacle.windAt(Vec2(toM(NET_X_PX + 60), toM(250)), toM(2))).toEqual(Vec2(0, 0));
    }
  });

  it.each([1, 2] as const)('cannot impale player %s even when deeply overlapping the former point', id => {
    const gw = world({ map: 'crematorium' });
    const player = id === 1 ? gw.p1 : gw.p2;
    for (const def of PARTS) {
      const body = player.part(def.name), original = body.getPosition().clone();
      body.setTransform(Vec2(toM(NET_X_PX), toM(NET_TOP_PX - 10)), 0);
      gw.centerObstacle.beforeStep([gw.p1, gw.p2], false);
      gw.centerObstacle.afterStep([gw.p1, gw.p2]);
      expect(gw.centerObstacle.blade.hits(player)).toEqual([]);
      expect(gw.centerObstacle.pins.size).toBe(0);
      expect(player.impaled || player.injured).toBe(false);
      body.setTransform(original, 0);
    }
    expect(gw.centerObstacle.bloodstains).toHaveLength(0);
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
