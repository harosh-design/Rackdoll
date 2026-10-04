import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { BEES, FPS, VIEW, toM, toPx } from '../src/sim/constants';
import { BEE_FLIGHT, BEE_LANES, beePosition, beeRadiusPx, type Bee } from '../src/sim/bees';
import { POWERS, type PowerId } from '../src/sim/powerUps';
import type { GameWorld } from '../src/sim/world';
import { run, world } from './helpers';

/** A world whose rules never end the rally, so every frame is a play frame. */
function playWorld(opts: Parameters<typeof world>[0] = {}): GameWorld {
  const gw = world(opts);
  gw.game.update = () => {};
  (gw.game as unknown as { delayTimer: { reset(): void } }).delayTimer.reset();
  return gw;
}

/** Let go of the held ball and park it, at rest, at a point. */
function freeBallAt(gw: GameWorld, xPx: number, yPx: number): void {
  for (const p of [gw.p1, gw.p2]) {
    const j = p.holdingJoint;
    if (j) {
      gw.world.destroyJoint(j);
      p.forgetBallJoint();
    }
  }
  gw.ball.ballOfPlayer = 0;
  gw.ball.body.setTransform(Vec2(toM(xPx), toM(yPx)), 0);
  gw.ball.body.setLinearVelocity(Vec2(0, 0));
}

const screenLeft = -VIEW.offsetX / VIEW.scale;
const screenRight = (VIEW.stageW - VIEW.offsetX) / VIEW.scale;

describe('bee gifts', () => {
  it('fly in from beyond either screen edge every 12–20 s of play and leave by the other', () => {
    const gw = playWorld({ bees: true, beeSeed: 7 });
    const launchedAt: number[] = [];
    const seen = new Map<Bee, { dir: 1 | -1; xs: number[]; ys: number[] }>();
    let launches = 0;
    for (let f = 0; f < 3 * 60 * FPS; f++) {
      gw.step();
      expect(gw.bees.bees.length).toBeLessThanOrEqual(BEES.maxAlive);
      if (gw.bees.launches > launches) {
        launches = gw.bees.launches;
        launchedAt.push(f + 1);
      }
      for (const bee of gw.bees.bees) {
        const track = seen.get(bee) ?? { dir: bee.dir, xs: [], ys: [] };
        const at = beePosition(bee);
        track.xs.push(at.xPx);
        track.ys.push(at.yPx);
        seen.set(bee, track);
      }
    }
    expect(launchedAt[0]).toBe(BEES.firstFrames);
    expect(launchedAt.length).toBeGreaterThanOrEqual(8);
    for (let i = 1; i < launchedAt.length; i++) {
      const gap = launchedAt[i] - launchedAt[i - 1];
      expect(gap).toBeGreaterThanOrEqual(BEES.intervalFrames.min);
      expect(gap).toBeLessThanOrEqual(BEES.intervalFrames.max);
    }
    const dirs = new Set<number>();
    for (const [bee, t] of seen) {
      dirs.add(t.dir);
      // Starts out of sight, then flies steadily across.
      expect(t.dir === 1 ? t.xs[0] < screenLeft : t.xs[0] > screenRight).toBe(true);
      for (let i = 1; i < t.xs.length; i++) expect((t.xs[i] - t.xs[i - 1]) * t.dir).toBeGreaterThan(0);
      // Over the court: above the net top, below the HUD.
      const r = beeRadiusPx(bee.kind);
      expect(Math.max(...t.ys) + r).toBeLessThan(206);
      expect(Math.min(...t.ys) - r).toBeGreaterThan(-140);
      // Every bee that had time to cross is gone past the far edge.
      if (gw.bees.bees.includes(bee)) continue;
      const last = t.xs[t.xs.length - 1];
      expect(t.dir === 1 ? last > screenRight : last < screenLeft).toBe(true);
    }
    expect(dirs).toEqual(new Set([1, -1]));
  });

  it('carry every power once per seven, in a fresh order, never the same twice running', () => {
    const gw = playWorld({ beeSeed: 3 });
    const kinds: PowerId[] = [];
    const bees = gw.bees as unknown as { nextKind(): PowerId };
    for (let i = 0; i < 70; i++) kinds.push(bees.nextKind());
    for (let run7 = 0; run7 < 10; run7++) {
      expect(new Set(kinds.slice(run7 * 7, run7 * 7 + 7))).toEqual(new Set(POWERS));
    }
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
    expect(kinds.slice(0, 7)).not.toEqual(kinds.slice(7, 14));
  });

  it('the giant bee is far bigger than the tiny bee, and the hit radius follows the size', () => {
    expect(beeRadiusPx('giant')).toBeGreaterThanOrEqual(2.5 * beeRadiusPx('tiny'));
    for (const kind of POWERS) {
      if (kind === 'giant' || kind === 'tiny') continue;
      expect(beeRadiusPx(kind)).toBeLessThan(beeRadiusPx('giant'));
      expect(beeRadiusPx(kind)).toBeGreaterThan(beeRadiusPx('tiny'));
    }
    expect(BEE_FLIGHT.speed.speed).toBeGreaterThan(Math.max(...POWERS.filter((k) => k !== 'speed').map((k) => BEE_FLIGHT[k].speed)));
  });

  it('a ball meeting a bee gives its power to whoever touched the ball last', () => {
    for (const toucher of [1, 2] as const) {
      const gw = playWorld();
      const bee = gw.bees.spawn('giant', 1, 60);
      run(gw, 60);
      const at = beePosition(bee);
      freeBallAt(gw, at.xPx, at.yPx);
      (toucher === 1 ? gw.p1 : gw.p2).contact = 1;
      gw.step();
      expect(gw.bees.bees).toHaveLength(0);
      expect(gw.powerUps.active[toucher]?.kind).toBe('giant');
      expect(gw.powerUps.active[toucher === 1 ? 2 : 1]).toBeNull();
      expect(gw.bees.pops).toMatchObject([{ kind: 'giant', owner: toucher }]);
      run(gw, BEES.popFrames);
      expect(gw.bees.pops).toHaveLength(0);
      run(gw, 20);
      expect((toucher === 1 ? gw.p1 : gw.p2).sizeScale).toBeCloseTo(1.5);
    }
  });

  it('a held ball counts for its holder, and a ball nobody has touched passes straight through', () => {
    const held = playWorld();
    held.p1.jump();
    run(held, 3);
    const ball = held.ball.position;
    const bee = held.bees.spawn('tiny', 1, 0);
    // Put the bee where the jumping holder's ball will be next frame.
    (bee as { baseYPx: number }).baseYPx += toPx(ball.y) - beePosition(bee).yPx;
    (bee as { startXPx: number }).startXPx += toPx(ball.x) - beePosition(bee).xPx;
    held.step();
    expect(held.powerUps.active[1]?.kind).toBe('tiny');

    const nobody = playWorld();
    const stray = nobody.bees.spawn('shield', -1, 60);
    run(nobody, 60);
    const at = beePosition(stray);
    freeBallAt(nobody, at.xPx, at.yPx);
    nobody.step();
    expect(nobody.bees.bees).toEqual([stray]);
    expect(nobody.powerUps.active).toEqual({ 1: null, 2: null });
  });

  it('a bee that only nears the ball is left alone, and none are hit outside play', () => {
    const near = playWorld();
    const bee = near.bees.spawn('magnet', 1, 60);
    run(near, 60);
    const at = beePosition(bee);
    const clear = BEES.radiusPx + 15 + 25;
    freeBallAt(near, at.xPx + 0, at.yPx - clear);
    near.p1.contact = 1;
    near.step();
    expect(near.bees.bees).toHaveLength(1);
    expect(near.powerUps.active[1]).toBeNull();

    const goal = playWorld();
    const late = goal.bees.spawn('speed', 1, 60);
    run(goal, 30);
    goal.game.phase = 'goal';
    const p = beePosition(late);
    freeBallAt(goal, p.xPx, p.yPx);
    goal.p1.contact = 1;
    goal.step();
    expect(goal.bees.bees).toHaveLength(1);
    expect(goal.powerUps.active[1]).toBeNull();
  });

  it('slows down with the goal replay and freezes with the pause', () => {
    const gw = playWorld();
    const bee = gw.bees.spawn('feather', 1, 60);
    run(gw, 10);
    const normal = bee.age - bee.prevAge;
    gw.game.timeStep = 0.005;
    gw.step();
    expect(bee.age - bee.prevAge).toBeCloseTo(normal * (0.005 / 0.035714), 6);
    gw.paused = true;
    const frozen = bee.age;
    run(gw, 10);
    expect(bee.age).toBe(frozen);
  });

  it('a new match clears the sky and restarts the clock', () => {
    const gw = playWorld({ bees: true });
    run(gw, BEES.firstFrames + 10);
    expect(gw.bees.bees.length).toBe(1);
    gw.game.resetMatch();
    (gw.game as unknown as { delayTimer: { reset(): void } }).delayTimer.reset();
    expect(gw.bees.bees).toHaveLength(0);
    expect(gw.bees.launches).toBe(0);
    run(gw, BEES.firstFrames - 1);
    expect(gw.bees.launches).toBe(0);
    run(gw, 1);
    expect(gw.bees.launches).toBe(1);
  });

  it('fly through real matches: the CPUs pop some, and the world stays sound', () => {
    let pops = 0;
    let launches = 0;
    for (const seed of [1]) {
      const gw = world({ botVsBot: true, level: 3, p1Level: 3, bees: true, beeSeed: seed });
      let seenPops = 0;
      for (let f = 0; f < 3 * 60 * FPS; f++) {
        gw.step();
        gw.reap();
        if (gw.bees.pops.length > seenPops) pops += gw.bees.pops.length - seenPops;
        seenPops = gw.bees.pops.length;
        if (gw.game.phase === 'matchOver') gw.game.resetMatch();
        for (const b of [gw.ball.body, ...gw.p1.bodies, ...gw.p2.bodies]) {
          const p = b.getPosition();
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error(`non-finite at frame ${f}`);
        }
      }
      launches += gw.bees.launches;
    }
    expect(launches).toBeGreaterThan(8);
    expect(pops).toBeGreaterThan(0);
  }, 30_000);
});

// Keep the lane constants honest: bees appear from beyond the visible stage.
it('bee lanes sit outside the visible stage', () => {
  expect(BEE_LANES.left).toBeLessThan(screenLeft - 40);
  expect(BEE_LANES.right).toBeGreaterThan(screenRight + 40);
});
