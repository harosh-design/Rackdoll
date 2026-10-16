import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { CHAMELEON, COMET, FLOOR_TOP_PX, FPS, OPTIONS, SWING, TIME_STEP, toM, toPx } from '../src/sim/constants';
import { Executer } from '../src/sim/executer';
import { executerVariant } from '../src/sim/executerVariants';
import { fireAtButton, hazardWorld, jointErrPx, run } from './helpers';

describe('fire skull facing', () => {
  it('turns toward the player from every side, regardless of velocity or physical spin', () => {
    const gw = hazardWorld();
    const skull = new Executer({ world: gw.world, timers: gw.timers, target: gw.p1, side: 1,
      variant: executerVariant('comet'), origin: Vec2(toM(-100), toM(100)) });
    for (const [dx, dy] of [[-100, 0], [100, 0], [0, -100], [0, 100]]) {
      const head = gw.p1.head.getWorldCenter();
      const torso = gw.p1.tors.getWorldCenter();
      const aim = Vec2(torso.x, (head.y + torso.y) / 2);
      skull.body.setTransform(Vec2(aim.x + toM(dx), aim.y + toM(dy)), 1.7);
      skull.body.setLinearVelocity(Vec2(dx, dy));
      skull.knockbackFrames = 100;
      for (let f = 0; f < 30; f++) {
        const previous = skull.facingAngle;
        skull.update(TIME_STEP);
        expect(Math.abs(skull.facingAngle - previous)).toBeLessThanOrEqual(COMET.turnSpeed * TIME_STEP + 1e-9);
      }
      const desired = Math.atan2(-dy, -dx);
      const error = skull.facingAngle - desired;
      expect(Math.abs(Math.atan2(Math.sin(error), Math.cos(error)))).toBeLessThan(0.01);
      expect(skull.body.getAngle()).toBe(1.7);
    }
    skull.destroy();
  });
});

describe('wall chameleon', () => {
  /** A crawler level with the player, for precise tongue timing and impulse checks. */
  const setup = (side: 1 | 2 = 1) => {
    const gw = hazardWorld({ executerOrder: ['chameleon'] });
    const player = side === 1 ? gw.p1 : gw.p2;
    const origin = gw.ground.prizeButtons[side - 1].launchPoint();
    origin.y = player.tors.getWorldCenter().y;
    const e = new Executer({ world: gw.world, timers: gw.timers, target: player, side,
      variant: executerVariant('chameleon'), origin });
    gw.executers.push(e);
    return { gw, e, player };
  };

  const untilPhase = (e: Executer, phase: Executer['phase'], ball: typeof e.body | null = null) => {
    for (let f = 0; f < 200 && e.phase !== phase; f++) e.update(TIME_STEP, ball);
    expect(e.phase).toBe(phase);
  };

  it.each([1, 2] as const)('emerges from grave %i and descends along that wall for its full lifetime', side => {
    const gw = hazardWorld({ executerOrder: ['chameleon'], physics: { airDensity: 5 } });
    fireAtButton(gw, side);
    const e = gw.executers[0];
    const button = gw.ground.prizeButtons[side - 1];
    const wallX = button.launchPoint().x;
    let previousY = e.body.getPosition().y;
    let maxJointPx = 0;
    let frames = 0;
    while (!e.dead && frames < OPTIONS.myExLife * FPS) {
      gw.step();
      if (e.dead) break;
      const p = e.body.getPosition();
      expect(p.y).toBeGreaterThan(previousY);
      expect(e.body.getLinearVelocity().y).toBeGreaterThan(0);
      expect(e.body.getLinearVelocity().y).toBeLessThanOrEqual(toM(CHAMELEON.crawlSpeedPx));
      if (e.solid) expect(p.x).toBeCloseTo(wallX, 8);
      else expect(Math.abs(p.x - wallX)).toBeLessThanOrEqual(toM(CHAMELEON.emergeDistancePx));
      expect(toPx(p.y)).toBeLessThan(FLOOR_TOP_PX - 32);
      expect(e.body.getFixtureList()!.isSensor()).toBe(true);
      previousY = p.y;
      maxJointPx = Math.max(maxJointPx, jointErrPx(e.target));
      frames++;
    }
    expect(frames).toBeGreaterThan(OPTIONS.myExLife * FPS - 3);
    expect(e.dead).toBe(true);
    expect(button.armed).toBe(true);
    expect(e.hits).toBeGreaterThanOrEqual(2);
    expect(maxJointPx).toBeLessThan(15);
  });

  it.each([1, 2] as const)('briefly tugs the whole player toward wall %i with a bounded impulse', side => {
    const { gw, e, player } = setup(side);
    untilPhase(e, 'tongue-extend');
    expect(e.tongueTarget).toBe(player.tors);
    const before = player.bodies.map(body => body.getLinearVelocity().clone());
    untilPhase(e, 'tongue-pull');
    expect(e.hits).toBe(1);
    for (let f = 0; f < CHAMELEON.pullFrames; f++) e.update(TIME_STEP);
    const expected = (side === 1 ? -1 : 1) * CHAMELEON.playerPull * CHAMELEON.pullFrames * TIME_STEP;
    player.bodies.forEach((body, i) => {
      expect(body.getLinearVelocity().x - before[i].x).toBeCloseTo(expected, 6);
      expect(body.getLinearVelocity().y).toBeCloseTo(before[i].y, 6);
    });
    untilPhase(e, 'crawl');
    expect(e.tongueTarget).toBeNull();
    const hits = e.hits;
    for (let f = 0; f < CHAMELEON.cooldownFrames - 1; f++) e.update(TIME_STEP);
    expect(e.hits).toBe(hits);
    untilPhase(e, 'tongue-pull');
    expect(e.hits).toBe(hits + 1);
    run(gw, 30);
    expect(jointErrPx(player)).toBeLessThan(15);
  });

  it('chooses a nearer free ball and gently bends its flight without holding it up', () => {
    const { gw, e } = setup();
    const ball = gw.ball.body;
    const p = e.body.getPosition();
    ball.setTransform(Vec2(p.x + toM(90), p.y + toM(90)), 0);
    ball.setLinearVelocity(Vec2(0, 0));
    untilPhase(e, 'tongue-pull', ball);
    expect(e.tongueTarget).toBe(ball);
    for (let f = 0; f < CHAMELEON.pullFrames; f++) e.update(TIME_STEP, ball);
    expect(ball.getLinearVelocity().x).toBeLessThan(-1);
    expect(ball.getLinearVelocity().length()).toBeLessThanOrEqual(CHAMELEON.ballPull * CHAMELEON.pullFrames * TIME_STEP);
    expect(ball.getLinearVelocity().y).toBeGreaterThanOrEqual(-gw.world.getGravity().y * CHAMELEON.ballLiftMax * CHAMELEON.pullFrames * TIME_STEP - 1e-9);
    e.update(TIME_STEP, null);
    expect(e.tongueTarget).toBeNull();
    expect(e.phase).toBe('tongue-retract');
  });

  it('ignores held and out-of-play balls and freezes its descent and tongue while paused', () => {
    const { gw, e, player } = setup();
    player.power = 'shield';
    player.takeBall(gw.ball.body);
    gw.ball.ballOfPlayer = player.id;
    gw.game.phase = 'play';
    run(gw, 150);
    expect(e.hits).toBe(0);
    gw.world.destroyJoint(player.holdingJoint!);
    player.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.game.phase = 'goal';
    const p = e.body.getPosition();
    gw.ball.body.setTransform(Vec2(p.x + toM(70), p.y), 0);
    run(gw, 100);
    expect(e.hits).toBe(0);
    const age = e.age;
    const position = e.body.getPosition().clone();
    gw.paused = true;
    run(gw, 90);
    expect(e.age).toBe(age);
    expect(e.body.getPosition()).toEqual(position);
    gw.paused = false;
    run(gw, 1);
    expect(e.age).toBe(age + 1);
    expect(e.body.getPosition().y).toBeGreaterThan(position.y);
  });

  it('misses a target that escapes the aimed shot and never reaches across the net', () => {
    const { gw, e } = setup();
    const ball = gw.ball.body;
    const p = e.body.getPosition();
    ball.setTransform(Vec2(p.x + toM(90), p.y), 0);
    untilPhase(e, 'tongue-extend', ball);
    ball.setTransform(Vec2(p.x + toM(90), p.y + toM(CHAMELEON.catchRadiusPx + 1)), 0);
    untilPhase(e, 'tongue-retract', ball);
    expect(e.hits).toBe(0);
    expect(e.tongueTarget).toBeNull();
    gw.p1.power = 'shield';
    ball.setTransform(Vec2(toM(330), p.y), 0);
    for (let f = 0; f < 200; f++) e.update(TIME_STEP, ball);
    expect(e.phase).toBe('crawl');
    expect(e.tongueTarget).toBeNull();
    expect(e.hits).toBe(0);
  });

  it('respects shields, lets go before a round reset, and a swing interrupts the tongue', () => {
    const { gw, e, player } = setup();
    player.power = 'shield';
    for (let f = 0; f < 150; f++) e.update(TIME_STEP);
    expect(e.hits).toBe(0);
    player.power = null;
    untilPhase(e, 'tongue-pull');
    player.power = 'shield';
    e.update(TIME_STEP);
    expect(e.tongueTarget).toBeNull();
    player.power = null;
    untilPhase(e, 'tongue-pull');
    const y = e.body.getPosition().y;
    e.hitByPlayer(Vec2(100, -100));
    expect(e.tongueTarget).toBeNull();
    expect(e.knockbackFrames).toBe(SWING.executerKnockFrames);
    run(gw, SWING.executerKnockFrames);
    expect(e.body.getPosition().y).toBeGreaterThan(y);
    expect(e.body.getLinearVelocity().x).toBe(0);
    untilPhase(e, 'tongue-pull');
    gw.game.newRound();
    expect(e.tongueTarget).toBeNull();
    expect(e.phase).toBe('tongue-retract');
    gw.game.resetMatch();
    expect(e.dead).toBe(true);
    expect(gw.executers).toHaveLength(0);
  });
});
