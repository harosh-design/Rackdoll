import { Circle, Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { CHAMELEON, COMET, EXECUTER, FLOOR_TOP_PX, FPS, OPTIONS, SPRING, SWING, TIME_STEP, toM, toPx } from '../src/sim/constants';
import { Executer } from '../src/sim/executer';
import { executerVariant } from '../src/sim/executerVariants';
import { fireAtButton, hazardWorld, jointErrPx, run } from './helpers';

describe('fire skull', () => {
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

  it('completes a visible diving somersault after both hits and missed dashes before attacking again', () => {
    for (const miss of [false, true]) {
      const gw = hazardWorld({ executerOrder: ['comet'] });
      fireAtButton(gw, 1);
      const e = gw.executers[0];
      let sawDash = false;
      for (let f = 0; f < 180 && e.phase !== 'loop'; f++) {
        gw.step();
        if (e.phase === 'dash') {
          sawDash = true;
          if (miss) {
            // Move the committed dash clear of every limb and let it time out.
            e.body.setTransform(Vec2(toM(-80), toM(-300)), 0);
            e.phaseAge = COMET.dashFrames;
          }
        }
      }
      expect(sawDash).toBe(true);
      expect(e.phase).toBe('loop');
      expect(e.hits).toBe(miss ? 0 : 1);
      const hits = e.hits, facing = e.facingAngle, ys: number[] = [];
      for (let f = 1; f <= COMET.loopFrames; f++) {
        gw.step();
        ys.push(e.body.getPosition().y);
        expect(e.hits).toBe(hits);
        if (f < COMET.loopFrames) expect(e.phase).toBe('loop');
      }
      expect(Math.abs(e.facingAngle - facing)).toBeCloseTo(Math.PI * 2, 6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(toM(20));
      expect(e.phase).toBe('recover');
      run(gw, COMET.recoverFrames);
      expect(e.phase).toBe('stalk');
    }
  });
});

describe('bouncing bone spring', () => {
  it.each([1, 2] as const)('falls from grave %i, bounces toward its player and keeps ricocheting with breathing room', side => {
    const gw = hazardWorld({ executerOrder: ['spring'] });
    fireAtButton(gw, side);
    const e = gw.executers[0];
    expect(e.phase).toBe('drop');
    expect(e.body.getGravityScale()).toBe(1);
    let lastY = e.body.getPosition().y;
    for (let f = 0; f < 100 && !e.lastBounce; f++) {
      gw.step();
      if (!e.lastBounce) {
        expect(e.body.getPosition().y).toBeGreaterThan(lastY);
        expect(e.hits).toBe(0);
      }
      lastY = e.body.getPosition().y;
    }
    expect(e.lastBounce).not.toBeNull();
    expect(e.lastBounce!.ny).toBe(-1);
    expect(e.lastBounce!.yPx).toBeCloseTo(FLOOR_TOP_PX, -1);
    expect(e.body.getLinearVelocity().y).toBeLessThan(0);
    expect(e.body.getLinearVelocity().x * (side === 1 ? 1 : -1)).toBeGreaterThan(2);
    let lastBounce = e.lastBounce!.age, bounces = 1, lastHit = -Infinity, separated = false;
    for (let f = 0; f < 420; f++) {
      const hits = e.hits;
      gw.step();
      if (e.lastBounce!.age !== lastBounce) { bounces++; lastBounce = e.lastBounce!.age; }
      if (e.hits > hits) {
        expect(e.age - lastHit).toBeGreaterThanOrEqual(SPRING.reboundFrames);
        lastHit = e.age;
        expect(e.phase).toBe('rebound');
      }
      if (e.age - lastHit === 12) {
        separated ||= Math.abs(toPx(e.body.getPosition().x - e.target.tors.getPosition().x)) > 85;
      }
      expect(toPx(e.body.getPosition().y)).toBeLessThanOrEqual(FLOOR_TOP_PX - EXECUTER.radiusPx + 2);
    }
    expect(bounces).toBeGreaterThan(8);
    expect(e.hits).toBeGreaterThanOrEqual(2);
    expect(separated).toBe(true);
  });

  it('keeps falling and accelerating along its flight instead of steering or hovering in the air', () => {
    const gw = hazardWorld({ executerOrder: ['spring'] });
    fireAtButton(gw, 1);
    const e = gw.executers[0];
    run(gw, 65);
    e.body.setTransform(Vec2(toM(230), toM(-100)), 0);
    e.body.setLinearVelocity(Vec2(3, 0));
    e.travel = 0;
    run(gw, 10);
    expect(e.body.getLinearVelocity().x).toBeGreaterThan(3);
    expect(e.body.getLinearVelocity().y).toBeGreaterThan(3);
    expect(toPx(e.body.getPosition().x)).toBeGreaterThan(260);
    expect(e.travel).toBeGreaterThan(1);
  });

  it('a longer real flight builds more speed and hits a loose object harder', () => {
    const fly = (frames: number) => {
      const gw = hazardWorld({ executerOrder: ['spring'], physics: { gravity: 0 } });
      fireAtButton(gw, 1);
      const e = gw.executers[0];
      run(gw, 8);
      e.phase = 'charge';
      e.body.setTransform(Vec2(toM(-120), toM(-100)), 0);
      e.body.setLinearVelocity(Vec2(2, 0));
      e.travel = 0;
      run(gw, frames);
      const speed = e.body.getLinearVelocity().length(), power = e.slamPower;
      const object = gw.world.createDynamicBody({ position: Vec2(e.body.getPosition().x + toM(35), toM(-100)) });
      object.createFixture(Circle(toM(12)), { density: 2 });
      const beforeBounce = e.lastBounce?.age;
      for (let f = 0; f < 12 && e.lastBounce?.age === beforeBounce; f++) gw.step();
      expect(e.lastBounce?.age).not.toBe(beforeBounce);
      return { speed, power, objectSpeed: object.getLinearVelocity().length() };
    };
    const short = fly(5), long = fly(40);
    expect(long.speed).toBeGreaterThan(short.speed * 1.8);
    expect(long.power).toBeGreaterThan(short.power + 0.3);
    expect(long.objectSpeed).toBeGreaterThan(short.objectSpeed * 1.8);
  });

  it('lets a flip send it away without cancelling gravity or immediately resuming pursuit', () => {
    const gw = hazardWorld({ executerOrder: ['spring'] });
    fireAtButton(gw, 1);
    const e = gw.executers[0];
    run(gw, 65);
    e.hitByPlayer(Vec2(-12, -8));
    const hits = e.hits;
    run(gw, 20);
    expect(e.hits).toBe(hits);
    expect(e.body.getGravityScale()).toBe(1);
    expect(e.phase).toBe('rebound');
  });
});

describe('wall chameleon', () => {
  /** A crawler level with the player, for precise tongue timing and impulse checks. */
  const setup = (side: 1 | 2 = 1, heightOffsetPx = 0) => {
    const gw = hazardWorld({ executerOrder: ['chameleon'] });
    const player = side === 1 ? gw.p1 : gw.p2;
    const origin = gw.ground.prizeButtons[side - 1].launchPoint();
    origin.y = player.tors.getWorldCenter().y + toM(heightOffsetPx);
    const e = new Executer({ world: gw.world, timers: gw.timers, target: player, side,
      variant: executerVariant('chameleon'), origin });
    gw.executers.push(e);
    return { gw, e, player };
  };

  const untilPhase = (e: Executer, phase: Executer['phase'], ball: typeof e.body | null = null) => {
    for (let f = 0; f < 200 && e.phase !== phase; f++) e.update(TIME_STEP, ball);
    expect(e.phase).toBe(phase);
  };

  it.each([1, 2] as const)('crawls 15% faster from grave %i and stops safely above the floor until expiry', side => {
    const gw = hazardWorld({ executerOrder: ['chameleon'], physics: { airDensity: 5 } });
    fireAtButton(gw, side);
    const e = gw.executers[0];
    const button = gw.ground.prizeButtons[side - 1];
    const wallX = button.launchPoint().x;
    const startY = e.body.getPosition().y;
    let previousY = startY;
    expect(toPx(e.body.getLinearVelocity().y)).toBeCloseTo(20 * 1.15, 8);
    let maxJointPx = 0;
    let frames = 0;
    while (!e.dead && frames < OPTIONS.myExLife * FPS) {
      gw.step();
      if (e.dead) break;
      const p = e.body.getPosition();
      expect(p.y).toBeGreaterThanOrEqual(previousY - 1e-10);
      expect(e.body.getLinearVelocity().y).toBeGreaterThanOrEqual(0);
      expect(e.body.getLinearVelocity().y).toBeLessThanOrEqual(toM(CHAMELEON.crawlSpeedPx));
      if (e.solid) expect(p.x).toBeCloseTo(wallX, 8);
      else expect(Math.abs(p.x - wallX)).toBeLessThanOrEqual(toM(CHAMELEON.emergeDistancePx));
      expect(toPx(p.y)).toBeLessThanOrEqual(FLOOR_TOP_PX - CHAMELEON.floorClearancePx + 1e-8);
      expect(e.body.getFixtureList()!.isSensor()).toBe(true);
      previousY = p.y;
      maxJointPx = Math.max(maxJointPx, jointErrPx(e.target));
      frames++;
      if (frames === 60) expect(toPx(p.y - startY)).toBeCloseTo(20 * 1.15 * TIME_STEP * 60, 6);
    }
    expect(frames).toBeGreaterThan(OPTIONS.myExLife * FPS - 3);
    expect(e.dead).toBe(true);
    expect(button.armed).toBe(true);
    expect(e.hits).toBeGreaterThanOrEqual(2);
    expect(maxJointPx).toBeLessThan(15);
    expect(toPx(previousY)).toBeCloseTo(FLOOR_TOP_PX - CHAMELEON.floorClearancePx, 6);
  });

  it.each([1, 2] as const)('briefly tugs the whole player toward wall %i with a bounded impulse', side => {
    const { gw, e, player } = setup(side);
    untilPhase(e, 'tongue-extend');
    expect(e.tongueTarget).toBe(player.tors);
    const bodies = [...player.bodies, player.prismBody];
    const before = bodies.map(body => body.getLinearVelocity().clone());
    untilPhase(e, 'tongue-pull');
    expect(e.hits).toBe(1);
    const c = e.body.getWorldCenter(), p = player.tors.getWorldCenter();
    const direction = Vec2(c.x + (side === 1 ? 1 : -1) * toM(CHAMELEON.mouthOffsetXPx) - p.x,
      c.y + toM(CHAMELEON.mouthOffsetYPx) - p.y);
    direction.normalize();
    const duration = CHAMELEON.pullFrames * TIME_STEP;
    const expectedX = direction.x * CHAMELEON.playerPull * duration;
    const expectedY = Math.max(direction.y * CHAMELEON.playerPull,
      -gw.world.getGravity().y * CHAMELEON.playerLiftMax) * duration;
    for (let f = 0; f < CHAMELEON.pullFrames; f++) e.update(TIME_STEP);
    expect(expectedX * (side === 1 ? -1 : 1)).toBeGreaterThan(0);
    bodies.forEach((body, i) => {
      expect(body.getLinearVelocity().x - before[i].x).toBeCloseTo(expectedX, 6);
      expect(body.getLinearVelocity().y - before[i].y).toBeCloseTo(expectedY, 6);
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

  it('pulls a lower player upward toward its mouth without overcoming gravity', () => {
    const { gw, e, player } = setup(1, -240);
    untilPhase(e, 'tongue-extend');
    const before = player.bodies.map(body => body.getLinearVelocity().clone());
    untilPhase(e, 'tongue-pull');
    player.bodies.forEach((body, i) => expect(body.getLinearVelocity()).toEqual(before[i]));
    for (let f = 0; f < CHAMELEON.pullFrames; f++) e.update(TIME_STEP);
    player.bodies.forEach((body, i) => {
      const dv = Vec2.sub(body.getLinearVelocity(), before[i]);
      expect(dv.x).toBeLessThan(0);
      expect(dv.y).toBeLessThan(0);
      expect(dv.y).toBeGreaterThanOrEqual(-gw.world.getGravity().y * CHAMELEON.playerLiftMax * CHAMELEON.pullFrames * TIME_STEP - 1e-9);
      expect(dv.length()).toBeLessThanOrEqual(CHAMELEON.playerPull * CHAMELEON.pullFrames * TIME_STEP + 1e-9);
    });
    untilPhase(e, 'crawl');
    const released = player.bodies.map(body => body.getLinearVelocity().clone());
    e.update(TIME_STEP);
    player.bodies.forEach((body, i) => expect(body.getLinearVelocity()).toEqual(released[i]));
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
    const { gw, e, player } = setup(1, -300);
    player.takeBall(gw.ball.body);
    gw.ball.ballOfPlayer = player.id;
    gw.game.phase = 'play';
    for (let f = 0; f < 150; f++) {
      run(gw, 1);
      expect(e.tongueTarget).not.toBe(gw.ball.body);
    }
    gw.world.destroyJoint(player.holdingJoint!);
    player.forgetBallJoint();
    gw.ball.ballOfPlayer = 0;
    gw.game.phase = 'goal';
    const p = e.body.getPosition();
    gw.ball.body.setTransform(Vec2(p.x + toM(70), p.y), 0);
    for (let f = 0; f < 100; f++) {
      run(gw, 1);
      expect(e.tongueTarget).not.toBe(gw.ball.body);
    }
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
    // Keep the player across the net as well, so neither target is eligible.
    gw.p1.standPlayer(500, 256);
    ball.setTransform(Vec2(toM(330), p.y), 0);
    for (let f = 0; f < 200; f++) e.update(TIME_STEP, ball);
    expect(e.phase).toBe('crawl');
    expect(e.tongueTarget).toBeNull();
    expect(e.hits).toBe(0);
  });

  it('lets go before a round reset, and a swing interrupts the tongue', () => {
    const { gw, e } = setup();
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
