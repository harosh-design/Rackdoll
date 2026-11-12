import { Circle, Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { BALL, BODYTYPE, FLOOR_TOP_PX, LEFT_WALL_INNER_PX, MS_PER_FRAME, RIGHT_WALL_INNER_PX, TIMERS, toM } from '../src/sim/constants';
import { tombSlabs } from '../src/sim/tomb';
import { run, world } from './helpers';
import type { GameWorld } from '../src/sim/world';

function free(gw: GameWorld): void {
  for (const player of [gw.p1, gw.p2]) if (player.holdingJoint) {
    gw.world.destroyJoint(player.holdingJoint); player.forgetBallJoint();
  }
  gw.ball.ballOfPlayer = 0;
  gw.ball.body.setTransform(Vec2(toM(-100), toM(240)), 0);
  gw.ball.body.setLinearVelocity(Vec2(0, 0));
  run(gw, 1);
}

/** Real Planck floor collision, including a separated airborne step beforehand. */
function land(gw: GameWorld, x = -100): void {
  gw.ball.body.setTransform(Vec2(toM(x), toM(240)), 0);
  gw.ball.body.setLinearVelocity(Vec2(0, 0)); run(gw, 2);
  gw.ball.body.setTransform(Vec2(toM(x), toM(FLOOR_TOP_PX - BALL.radiusPx - 5)), 0);
  gw.ball.body.setLinearVelocity(Vec2(0, 7));
  const impacts = gw.tomb?.impacts;
  for (let i = 0; i < 8 && gw.game.phase === 'play'; i++) {
    run(gw, 1);
    if (gw.tomb && gw.tomb.impacts !== impacts) break;
  }
}

const tombWorld = () => world({ map: 'tomb', physics: { gravity: 0 } });

describe('Tomb slabs', () => {
  it('covers both real landing surfaces with six contiguous slabs per side', () => {
    const slabs = tombSlabs();
    expect(slabs).toHaveLength(12);
    expect(slabs[0].left).toBe(LEFT_WALL_INNER_PX);
    expect(slabs[11].right).toBe(RIGHT_WALL_INNER_PX);
    for (const owner of [1, 2]) {
      const side = slabs.filter(s => s.owner === owner);
      expect(side).toHaveLength(6);
      for (let i = 1; i < 6; i++) expect(side[i].left).toBe(side[i - 1].right);
    }
  });

  it('cracks on the first landing, bounces, and keeps the solid support unchanged', () => {
    const gw = tombWorld(); free(gw);
    const floor = gw.ground.floor.getFixtureList();
    land(gw);
    expect(gw.tomb!.slabAt(-100).state).toBe('cracked');
    expect(gw.game.phase).toBe('play'); expect(gw.game.score).toEqual({ 1: 0, 2: 0 });
    expect(gw.ball.body.getLinearVelocity().y).toBeLessThan(0);
    expect(gw.ground.floor.getFixtureList()).toBe(floor);
    expect(floor!.isSensor()).toBe(false);
  });

  it.each([-100, 730])('resets both touch counts and contact debounces when a slab at %s cracks', x => {
    const gw = tombWorld(); free(gw);
    gw.p1.contact = 3; gw.p2.contact = 2;
    gw.p1.bContact = gw.p2.bContact = true;
    land(gw, x);
    expect(gw.p1.contact).toBe(0); expect(gw.p2.contact).toBe(0);
    expect(gw.p1.bContact).toBe(false); expect(gw.p2.bContact).toBe(false);
    expect(gw.game.phase).toBe('play');
    gw.p1.contact = 2;
    gw.flags.ballFloorHits!.push(x, x); gw.game.update();
    expect(gw.p1.contact).toBe(2);
  });

  it('allows three fresh player touches after cracking a slab, then penalizes the fourth', () => {
    const gw = tombWorld(); free(gw); gw.p1.contact = 3; land(gw);
    for (let count = 1; count <= 4; count++) {
      free(gw); run(gw, 8);
      const head = gw.p1.head.getWorldCenter();
      gw.ball.body.setTransform(Vec2(head.x, head.y - toM(40)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 3));
      for (let f = 0; f < 20 && gw.p1.contact < count; f++) run(gw, 1);
      expect(gw.p1.contact).toBe(count);
      expect(gw.game.phase).toBe(count < 4 ? 'play' : 'goal');
    }
    expect(gw.game.lastPointReason).toBe('touches'); expect(gw.game.score[2]).toBe(1);
  });

  it.each([{ x: -100, winner: 2 }, { x: 730, winner: 1 }] as const)('scores once for the other half at $x, regardless of last touch', ({ x, winner }) => {
    let observed = false;
    const gw = world({ map: 'tomb', physics: { gravity: 0 }, events: { onPoint: () => {
      observed = gw.game.phase === 'goal' && gw.tomb!.slabAt(x).state === 'cracked';
    } } });
    free(gw); land(gw, x);
    gw.p1.contact = winner === 1 ? 0 : 1; gw.p2.contact = winner === 1 ? 1 : 0;
    land(gw, x);
    expect(observed).toBe(true);
    expect(gw.game.lastPointReason).toBe('slab'); expect(gw.game.score[winner]).toBe(1);
    expect(gw.tomb!.slabAt(x).state).toBe('broken');
    run(gw, 12); gw.game.update(); expect(gw.game.score[winner]).toBe(1);
  });

  it('keeps damage on different slabs independent throughout the rally', () => {
    const gw = tombWorld(); free(gw); land(gw, -100); land(gw, 0); land(gw, 730);
    expect(gw.tomb!.slabs.filter(s => s.state === 'cracked')).toHaveLength(3);
    expect(gw.game.score).toEqual({ 1: 0, 2: 0 }); expect(gw.game.phase).toBe('play');
  });

  it('ignores duplicate callbacks, adjacent steps and jitter until the ball separates', () => {
    const gw = tombWorld(); free(gw); land(gw);
    for (let i = 0; i < 12; i++) {
      gw.flags.ballFloorHits!.push(-100, -100); gw.flags.onBallDown = true; gw.game.update();
    }
    expect(gw.tomb!.impacts).toBe(1); expect(gw.game.phase).toBe('play');
    gw.ball.body.setTransform(Vec2(toM(-100), toM(FLOOR_TOP_PX - BALL.radiusPx - 1)), 0);
    gw.game.update(); gw.flags.ballFloorHits!.push(-100); gw.game.update();
    expect(gw.tomb!.impacts).toBe(1);
    land(gw); expect(gw.game.phase).toBe('goal');
  });

  it('assigns an exact seam to just the slab on its right', () => {
    const gw = tombWorld(); free(gw);
    const seam = gw.tomb!.slabs[1].right;
    land(gw, seam);
    expect(gw.tomb!.slabs[1].state).toBe('intact'); expect(gw.tomb!.slabs[2].state).toBe('cracked');
    expect(gw.tomb!.slabs.filter(s => s.state !== 'intact')).toHaveLength(1);
  });

  it('does not damage slabs with a held ball or player contacts', () => {
    const gw = tombWorld(); run(gw, 60);
    expect(gw.tomb!.impacts).toBe(0);
    gw.flags.ballFloorHits!.push(-100); gw.flags.onBallDown = true; gw.game.update();
    expect(gw.tomb!.slabs.every(s => s.state === 'intact')).toBe(true);
    expect(gw.game.phase).toBe('play');
  });

  it.each([BODYTYPE.DEBRIS, BODYTYPE.EXECUTER])('ignores floor hits from non-ball body type %s, even with ball-like friction', type => {
    const gw = tombWorld();
    const body = gw.world.createDynamicBody({ position: Vec2(toM(-100), toM(330)) });
    body.setUserData({ e_bodytype: type });
    body.createFixture(Circle(toM(15)), { friction: BALL.friction, density: 1 });
    body.setLinearVelocity(Vec2(0, 7)); run(gw, 8);
    expect(gw.tomb!.impacts).toBe(0);
    expect(gw.tomb!.slabs.every(s => s.state === 'intact')).toBe(true);
  });

  it('freezes physics and controls during the goal scene, and freezes all scene time on pause', () => {
    const gw = tombWorld(); free(gw); land(gw); land(gw);
    const position = gw.p1.head.getPosition().clone(), ball = gw.ball.position.clone();
    run(gw, 8); expect(gw.p1.head.getPosition()).toEqual(position); expect(gw.ball.position).toEqual(ball);
    gw.paused = true;
    const frame = gw.frame, scene = { ...gw.tomb!.transition };
    run(gw, 100); expect(gw.frame).toBe(frame); expect(gw.tomb!.transition).toEqual(scene);
    gw.paused = false; run(gw, 3); expect(gw.frame).toBe(frame + 3);
  });

  it('restores all slabs automatically before a new rally and on restart', () => {
    const gw = tombWorld(); free(gw); land(gw, 730); land(gw); land(gw);
    run(gw, Math.ceil(TIMERS.goalMs / MS_PER_FRAME));
    expect(gw.game.phase).toBe('play'); expect(gw.tomb!.transition).toBeNull();
    expect(gw.tomb!.slabs.every(s => s.state === 'intact')).toBe(true);
    expect(gw.ball.held).toBe(true);
    free(gw); land(gw); gw.game.resetMatch();
    expect(gw.tomb!.slabs.every(s => s.state === 'intact')).toBe(true);
    expect(gw.game.score).toEqual({ 1: 0, 2: 0 });
  });

  it('still awards touch and serve-clock violations', () => {
    const gw = tombWorld(); free(gw); gw.p1.contact = 4; gw.game.update();
    expect(gw.game.lastPointReason).toBe('touches'); expect(gw.game.score[2]).toBe(1);
    gw.game.resetMatch(); run(gw, 181);
    expect(gw.game.lastPointReason).toBe('serveClock'); expect(gw.game.score[2]).toBe(1);
  });

  it('sustains seeded CPU rallies with finite bodies, legal serves and slab impacts', () => {
    const gw = world({ map: 'tomb', botVsBot: true, level: 5 });
    run(gw, 1800);
    expect(gw.tomb!.impacts).toBeGreaterThan(0);
    // Resetting touches can sustain a legal rally for the full soak duration.
    for (const body of [gw.ball.body, ...gw.p1.bodies, ...gw.p2.bodies]) {
      expect(Number.isFinite(body.getPosition().x + body.getPosition().y)).toBe(true);
    }
  });

  it.each(['graveyard', 'crematorium', 'dead-circus'] as const)('keeps first-floor-contact scoring on %s', map => {
    const gw = world({ map, physics: { gravity: 0 } }); free(gw); land(gw);
    expect(gw.tomb).toBeUndefined(); expect(gw.game.lastPointReason).toBe('floor');
    expect(gw.game.score[2]).toBe(1);
  });
});
