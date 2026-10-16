import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { forecastBall } from '../src/sim/ai';
import { BALL, TIME_STEP, toM } from '../src/sim/constants';
import { DEFAULT_GAME_PHYSICS, DEFAULT_PHYSICS, normalizePhysics } from '../src/sim/physics';
import { GameWorld } from '../src/sim/world';
import {
  exportPreset, loadPhysicsLibrary, parsePreset, savePhysicsLibrary,
} from '../src/debug/physicsPresets';

const world = (physics = {}) => new GameWorld({ singlePlayer: false, hazards: false, bees: false, physics });
function freeBall(gw: GameWorld): void {
  for (const player of [gw.p1, gw.p2]) {
    if (player.holdingJoint) gw.world.destroyJoint(player.holdingJoint);
    player.forgetBallJoint();
  }
  gw.ball.reset(200, 100);
}

describe('Live physics tuning', () => {
  it('keeps default trajectories identical and isolates settings per world', () => {
    const original = world();
    const explicit = world({ ...DEFAULT_PHYSICS });
    for (let frame = 0; frame < 60; frame++) { original.step(); explicit.step(); }
    expect(explicit.ball.position).toEqual(original.ball.position);
    expect(explicit.p1.head.getPosition()).toEqual(original.p1.head.getPosition());
    explicit.setPhysics({ gravity: 3, movementSpeed: 2 });
    expect(original.physics).toEqual(DEFAULT_PHYSICS);
    expect(original.world.getGravity().y).toBe(10);
  });

  it('applies gravity and air drag to the next physics step without changing time or score', () => {
    const gw = world();
    freeBall(gw);
    gw.setPhysics({ gravity: 0, airDensity: 2 });
    gw.ball.body.setLinearVelocity(Vec2(4, 0));
    gw.world.step(TIME_STEP);
    expect(gw.ball.velocity.x).toBeCloseTo(4 / (1 + 0.4 * TIME_STEP));
    expect(gw.ball.velocity.y).toBe(0);
    expect(gw.p1.head.getLinearDamping()).toBe(0.4);
    expect(gw.p1.prismBody.getLinearDamping()).toBe(0);
    expect(gw.frame).toBe(0);
    expect(gw.game.score).toEqual({ 1: 0, 2: 0 });
    gw.setPhysics({ gravity: 20, airDensity: 0 });
    gw.ball.body.setLinearVelocity(Vec2(0, 0));
    gw.world.step(TIME_STEP);
    expect(gw.ball.velocity.y).toBeCloseTo(20 * TIME_STEP);
  });

  it('scales mass and inertia together and preserves tuning across resets', () => {
    const gw = world();
    freeBall(gw);
    gw.setPhysics({ ballMass: BALL.mass * 2, movementSpeed: 2, jumpStrength: 1.5 });
    expect(gw.ball.body.getMass()).toBeCloseTo(BALL.mass * 2);
    expect(gw.ball.body.getInertia()).toBeCloseTo(BALL.inertia * 2);
    gw.ball.body.applyLinearImpulse(Vec2(BALL.mass, 0), gw.ball.position, true);
    expect(gw.ball.velocity.x).toBeCloseTo(0.5);
    gw.ball.reset();
    expect(gw.ball.body.getMass()).toBeCloseTo(BALL.mass * 2);
    expect(gw.p2.movementSpeed).toBe(2);
    expect(gw.p2.jumpStrength).toBe(1.5);
  });

  it('scales both human and CPU movement impulses and the jump', () => {
    for (const action of ['turn', 'turnComp'] as const) {
      const original = world();
      const tuned = world({ movementSpeed: 2 });
      original.p1[action](Vec2(4, 0));
      tuned.p1[action](Vec2(4, 0));
      expect(tuned.p1.ass.getLinearVelocity().x).toBeCloseTo(original.p1.ass.getLinearVelocity().x * 2);
    }
    const original = world();
    const tuned = world({ jumpStrength: 2 });
    original.p1.jump();
    tuned.p1.jump();
    expect(tuned.p1.head.getLinearVelocity().y).toBeCloseTo(original.p1.head.getLinearVelocity().y * 2);
  });

  it('can reduce court bounce despite the court fixture restitution', () => {
    const bounce = (restitution: number) => {
      const gw = world({ gravity: 0, ballRestitution: restitution });
      freeBall(gw);
      gw.ball.body.setTransform(Vec2(toM(200), toM(330)), 0);
      gw.ball.body.setLinearVelocity(Vec2(0, 5));
      for (let frame = 0; frame < 4; frame++) gw.world.step(TIME_STEP);
      return gw.ball.velocity.y;
    };
    expect(bounce(1)).toBeLessThan(-4);
    expect(Math.abs(bounce(0))).toBeLessThan(0.1);
  });

  it('forecasts flight using the tuned gravity, drag and wall bounce', () => {
    const gw = world({ gravity: 18, airDensity: 1.5 });
    freeBall(gw);
    gw.ball.body.setLinearVelocity(Vec2(4, -2));
    const samples = forecastBall(gw.ball.position, gw.ball.velocity, 3, () => 1, 18, 0.3);
    for (const sample of samples) {
      gw.world.step(TIME_STEP);
      expect(gw.ball.position.x).toBeCloseTo(sample.x);
      expect(gw.ball.position.y).toBeCloseTo(sample.y);
    }
    const reflected = forecastBall(Vec2(toM(820), toM(50)), Vec2(10, 0), 3, () => 1, 0, 0, 0);
    expect(Math.abs(reflected.at(-1)!.vx)).toBe(0);
  });

  it('rejects nonfinite values and clamps runtime tuning to safe ranges', () => {
    expect(normalizePhysics({ gravity: Infinity, ballMass: -1, movementSpeed: 100 })).toEqual({
      ...DEFAULT_PHYSICS, ballMass: 0.02, movementSpeed: 3,
    });
  });
});

describe('Physics presets', () => {
  const preset = { name: 'Low gravity', settings: { ...DEFAULT_PHYSICS, gravity: 4, airDensity: 1.2 } };
  it('starts new games with the default game tuning', () => {
    const settings = loadPhysicsLibrary().current;
    expect(settings).toEqual({ gravity: 11.6, ballMass: 0.125, airDensity: 0, movementSpeed: 1.3, jumpStrength: 1, ballRestitution: 1.08 });
    const gw = world(settings);
    expect(gw.world.getGravity().y).toBe(11.6);
    expect(gw.ball.body.getMass()).toBeCloseTo(0.125);
    expect(gw.ball.body.getFixtureList()!.getRestitution()).toBe(1.08);
    for (const player of [gw.p1, gw.p2]) {
      expect(player.movementSpeed).toBe(1.3);
      expect(player.jumpStrength).toBe(1);
      expect(player.head.getLinearDamping()).toBe(0);
    }
  });
  it('upgrades the former saved default without changing named presets or custom tuning', () => {
    const storage = (current: typeof DEFAULT_PHYSICS) => ({
      getItem: () => JSON.stringify({ version: 1, current, presets: [preset] }),
      setItem: () => {},
    });
    expect(loadPhysicsLibrary(storage(DEFAULT_PHYSICS))).toEqual({ current: DEFAULT_GAME_PHYSICS, presets: [preset] });
    expect(loadPhysicsLibrary(storage(preset.settings))).toEqual({ current: preset.settings, presets: [preset] });
  });
  it('preserves an explicit choice of original physics after the default upgrade', () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const library = { current: { ...DEFAULT_PHYSICS }, presets: [preset] };
    expect(savePhysicsLibrary(library, storage)).toBe(true);
    expect(loadPhysicsLibrary(storage)).toEqual(library);
  });
  it('round-trips portable JSON and local storage including the active settings', () => {
    expect(parsePreset(exportPreset(preset))).toEqual(preset);
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const library = { current: preset.settings, presets: [preset] };
    expect(savePhysicsLibrary(library, storage)).toBe(true);
    expect(loadPhysicsLibrary(storage)).toEqual(library);
  });
  it('rejects malformed, partial, unsupported and out-of-range imports', () => {
    for (const json of ['{', 'null', JSON.stringify({ version: 2 }),
      JSON.stringify({ version: 1, name: 'Bad', settings: { gravity: 5 } }),
      JSON.stringify({ version: 1, ...preset, settings: { ...preset.settings, ballMass: 0 } })]) {
      expect(() => parsePreset(json)).toThrow();
    }
  });
  it('recovers valid presets from damaged storage and handles unavailable storage', () => {
    const storage = { getItem: () => JSON.stringify({ version: 1, current: null, presets: [null, preset] }), setItem: () => { throw new Error('Storage blocked'); } };
    expect(loadPhysicsLibrary(storage)).toEqual({ current: DEFAULT_GAME_PHYSICS, presets: [preset] });
    expect(savePhysicsLibrary({ current: { ...DEFAULT_PHYSICS }, presets: [] }, storage)).toBe(false);
    expect(loadPhysicsLibrary()).toEqual({ current: DEFAULT_GAME_PHYSICS, presets: [] });
  });
});
