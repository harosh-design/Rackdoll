import { Vec2 } from 'planck';
import { describe, expect, it } from 'vitest';
import { PADEL } from '../src/sim/padel';
import { GameWorld } from '../src/sim/world';
import { toM } from '../src/sim/constants';

const padel = () => new GameWorld({ sport: 'padel', singlePlayer: false });

describe('padel mode', () => {
  it('builds a smaller ball, lower net, and one racket on each doll', () => {
    const w = padel();
    expect(w.ball.radiusPx).toBe(PADEL.ballRadiusPx);
    expect(w.ground.net.getPosition().y).toBeCloseTo(toM((PADEL.netTopPx + 356) / 2));
    expect(w.ground.prizeButtons).toHaveLength(0);
    for (const p of [w.p1, w.p2]) {
      expect(p.racketHand.getFixtureList()!.getNext()).not.toBeNull();
    }
  });

  it('drops an underhand serve before sending it over the net', () => {
    const w = padel();
    w.serve(w.p1);
    expect(w.ball.velocity.x).toBe(0);
    let bounced = false;
    let crossed = false;
    for (let i = 0; i < 100; i++) {
      w.step();
      if (w.ball.velocity.x > 5) bounced = true;
      if (w.ball.position.x > toM(330)) crossed = true;
      if (crossed) break;
    }
    expect(bounced).toBe(true);
    expect(crossed).toBe(true);
    expect(w.game.phase).toBe('play');
  });

  it('serves from the right side in two-player mode', () => {
    const w = padel();
    w.game.padelServer = 2;
    w.game.newRound();
    w.serve(w.p2);
    let crossed = false;
    for (let i = 0; i < 100; i++) {
      w.step();
      if (w.ball.position.x < toM(310)) { crossed = true; break; }
    }
    expect(crossed).toBe(true);
    expect(w.game.phase).toBe('play');
  });

  it('allows one bounce and a back-wall rebound, then awards the second bounce', () => {
    const w = padel();
    w.serve(w.p1);
    for (let i = 0; i < 90; i++) w.step();
    expect(w.game.phase).toBe('play');
    // A live opponent-court ball has one legal floor bounce, then can use glass.
    w.ball.body.setTransform(Vec2(toM(700), toM(330)), 0);
    w.ball.body.setLinearVelocity(Vec2(8, 5));
    for (let i = 0; i < 70 && w.game.phase === 'play'; i++) w.step();
    expect(w.game.lastPointReason).toBe('doubleBounce');
    expect(w.game.padelPoints[1]).toBe(1);
  });

  it('uses game points and advantage before a game is won', () => {
    const w = padel();
    const point = (winner: 1 | 2) => {
      const server = w.game.padelServer === 1 ? w.p1 : w.p2;
      w.serve(server);
      w.game.registerPadelHit(server, true);
      w.flags.padelBodyHit = winner === 1 ? 2 : 1;
      w.game.update();
      w.game.newRound();
    };
    for (let i = 0; i < 3; i++) point(1);
    for (let i = 0; i < 3; i++) point(2);
    expect(w.game.padelPointLabel(1)).toBe('40');
    expect(w.game.score[1]).toBe(0);
    point(1);
    expect(w.game.padelPointLabel(1)).toBe('AD');
    point(2);
    expect(w.game.padelPointLabel(1)).toBe('40');
    point(1);
    point(1);
    expect(w.game.score[1]).toBe(1);
    expect(w.game.padelServer).toBe(2);
  });

  it('returns the ball with a racket after the required serve bounce', () => {
    const w = padel();
    w.serve(w.p1);
    for (let i = 0; i < 100 && w.game.padelReturnNeedsBounce === false; i++) w.step();
    for (let i = 0; i < 100 && w.game.padelReturnNeedsBounce; i++) w.step();
    expect(w.game.padelReturnNeedsBounce).toBe(false);
    const racket = w.p2.racketCenter;
    w.ball.body.setTransform(Vec2(racket.x - toM(35), racket.y), 0);
    w.ball.body.setLinearVelocity(Vec2(0, 0));
    w.swing(w.p2, 0.8, 'inside');
    for (let i = 0; i < 5 && w.ball.velocity.x >= -5; i++) w.step();
    expect(w.ball.velocity.x).toBeLessThan(-5);
    expect(w.game.phase).toBe('play');
  });

  it('allows a second serve, then awards a point for another fault', () => {
    const w = padel();
    for (let attempt = 1; attempt <= 2; attempt++) {
      w.serve(w.p1);
      w.game.registerPadelHit(w.p1, true);
      w.flags.padelWallHit = true;
      w.game.update();
      if (attempt === 1) {
        expect(w.game.padelServeFaults).toBe(1);
        expect(w.ball.held).toBe(true);
        expect(w.game.padelPoints[2]).toBe(0);
      }
    }
    expect(w.game.padelPoints[2]).toBe(1);
    expect(w.game.lastPointReason).toBe('wall');
  });

  it('replays a serve that clips the net and lands across', () => {
    const w = padel();
    w.serve(w.p1);
    w.game.registerPadelHit(w.p1, true);
    w.flags.padelNetHit = true;
    w.game.update();
    w.ball.body.setTransform(Vec2(toM(500), toM(340)), 0);
    w.flags.padelFloorHit = true;
    w.game.update();
    expect(w.ball.held).toBe(true);
    expect(w.game.padelServeFaults).toBe(0);
    expect(w.game.padelPoints).toEqual({ 1: 0, 2: 0 });
  });

  it('lets the computer return a reachable padel ball with its racket', () => {
    const w = new GameWorld({ sport: 'padel', singlePlayer: true });
    w.serve(w.p1);
    let returned = false;
    for (let i = 0; i < 220; i++) {
      w.step();
      if (w.perfectEffects[2].frame >= 0) { returned = true; break; }
      if (w.game.phase !== 'play') break;
    }
    expect(returned).toBe(true);
  });
});
