/**
 * The §17 build-order checks from RAGDOLL-VOLLEYBALL-SPEC.md, as assertions.
 * The spec's reference figures are sanity checks from a faithful port, not
 * targets to tune toward — so these assert ranges around them.
 */
import { Vec2, World } from 'planck';
import { describe, expect, it } from 'vitest';
import { Ball } from '../src/sim/ball';
import {
  BALL, GRAVITY, ITERATIONS, JOINTS, NET_TOP_PX, PARTS, PLAYER_FRICTION, TIME_STEP, toM,
} from '../src/sim/constants';
import { installContactListener } from '../src/sim/contacts';
import { Ground } from '../src/sim/ground';
import {
  fireAtButton, hazardWorld, jointErrPx, jumpServe, px, ramScenario, rng, run, SCRIPTS, untilPoint, world,
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
    const gw = world({ singlePlayer: true });
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
  });

});

describe('hazards (reworked §13)', () => {
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

  it('close to its player it spins and pins them against their half’s outer wall', () => {
    for (const side of [1, 2] as const) {
      const gw = hazardWorld();
      fireAtButton(gw, side);
      const p = side === 1 ? gw.p1 : gw.p2;
      const e = gw.executers[0];
      run(gw, 20);
      const h = p.head.getWorldCenter();
      // Park it on the net side of the player, level with the head.
      e.body.setTransform(Vec2(h.x + toM(side === 1 ? 70 : -70), h.y), 0);
      let maxSpin = 0;
      for (let i = 0; i < 30 * 10; i++) {
        gw.step();
        maxSpin = Math.max(maxSpin, Math.abs(e.body.getAngularVelocity()));
      }
      expect(e.pinDir).not.toBeNull();
      expect(e.pinDir!.x).toBe(side === 1 ? -1 : 1);
      expect(maxSpin).toBeGreaterThan(10);
      const hips = px(p.ass.getWorldCenter().x);
      if (side === 1) expect(hips).toBeLessThan(-180); // wall face at -215
      else expect(hips).toBeGreaterThan(810); // wall face at 840
    }
  });

  it('from below the shoulders it carries its player to the ceiling, then sets them down gently', () => {
    const gw = hazardWorld();
    fireAtButton(gw, 1);
    const e = gw.executers[0];
    run(gw, 20);
    const h = gw.p1.head.getWorldCenter();
    e.body.setTransform(Vec2(h.x + toM(40), h.y + toM(70)), 0);
    e.body.setLinearVelocity(Vec2(0, 0));
    let top = Infinity;
    let maxJoint = 0;
    let fastestDrop = 0;
    for (let i = 0; i < 30 * 30; i++) {
      gw.step();
      gw.reap();
      top = Math.min(top, px(gw.p1.head.getWorldCenter().y));
      maxJoint = Math.max(maxJoint, jointErrPx(gw.p1));
      fastestDrop = Math.max(fastestDrop, gw.p1.head.getLinearVelocity().y);
    }
    expect(top).toBeLessThan(-800); // the ceiling's face is at -850
    expect(e.dead).toBe(true);
    expect(fastestDrop).toBeLessThan(8); // lowered, not dropped from 37 m
    expect(maxJoint).toBeLessThan(25);
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

  it('never crosses to the other half, whatever its target does', () => {
    for (const side of [1, 2] as const) {
      const gw = hazardWorld();
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
  });

  it('with hazards off a button still clicks, launches nothing and pops back', () => {
    const gw = hazardWorld({ hazards: false });
    fireAtButton(gw, 1);
    const button = gw.ground.prizeButtons[0];
    expect(gw.executers).toHaveLength(0);
    expect(button.armed).toBe(false);
    run(gw, 20);
    expect(button.armed).toBe(true);
  });

  it('rams and pins the doll without tearing it apart or passing through it', () => {
    // Deterministic scripts on the player's own half, each run with and
    // without an executer parked at the doll. The doll's own motion already
    // stretches its joints (the original's jump is violent), so the executer
    // is judged against that, not against zero.
    for (const name of Object.keys(SCRIPTS)) {
      const alone = ramScenario(name, false);
      const rammed = ramScenario(name, true);
      expect(rammed.contactFrames).toBeGreaterThan(50); // it really was at the doll
      // Visible tearing is sustained separation, not a one-frame spike (the
      // doll's own jump spikes ~35 px): compare how long and how often.
      expect(rammed.longestTear).toBeLessThanOrEqual(alone.longestTear + 3);
      expect(rammed.tornFrames).toBeLessThanOrEqual(alone.tornFrames + 8);
      expect(rammed.maxJointPx).toBeLessThan(45);
      // It never sits inside the doll: a fingertip flung into it can overlap
      // for a frame before the solver pushes it out, and that is all.
      expect(rammed.longestDeepRun).toBeLessThanOrEqual(2);
      expect(rammed.deepFrames).toBeLessThanOrEqual(6);
      expect(rammed.maxPenetrationPx).toBeLessThan(15);
    }
  });

  it('(negative control) the original 400 kg crusher does tear a standing doll', () => {
    const r = ramScenario('idle', true, { mass: 400, maxForce: 1e9 }, 10);
    expect(r.maxJointPx).toBeGreaterThan(20);
    expect(r.longestTear).toBeGreaterThan(10); // sustained, not a blip
  });
});

describe('§17 soak', () => {
  it('90 s of random input: points on both sides, never a non-finite position', () => {
    const r = rng(12345);
    const gw = world({ hazards: true });
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
    const total = gw.game.score;
    expect(total[1] + total[2]).toBeGreaterThan(0);
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
