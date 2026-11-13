import { describe, expect, it, vi } from 'vitest';
import { GameAudio } from '../src/audio/gameAudio';
import { SWING } from '../src/sim/constants';
import { KEYS } from '../src/sim/control';
import { hazardWorld, world } from './helpers';

function soundSpies() {
  return {
    charge: vi.fn(), stopCharges: vi.fn(), swing: vi.fn(), swingReady: vi.fn(),
    dive: vi.fn(), slide: vi.fn(), serveWarning: vi.fn(), powerEnd: vi.fn(), matchEnd: vi.fn(),
  };
}

describe('game event audio', () => {
  it.each(['dive', 'slide'] as const)('plays %s once per accepted maneuver, without repeating while held', maneuver => {
    const gw = hazardWorld({ hazards: false });
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    audio.reset(gw);
    gw.control.press(KEYS[1][maneuver]);
    for (let i = 0; i < 12; i++) {
      gw.step();
      audio.update(gw);
    }
    expect(sounds[maneuver].mock.calls).toEqual([[1]]);
    expect(sounds.swing).not.toHaveBeenCalled();
    gw.control.release(KEYS[1][maneuver]);
  });

  it('tracks a held charge, then plays the released flip once and clears the charge', () => {
    const gw = hazardWorld({ hazards: false });
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    audio.reset(gw);
    gw.control.press(KEYS[1].serve);
    for (let i = 0; i < 30; i++) {
      gw.step();
      audio.update(gw);
    }
    expect(sounds.charge.mock.calls.some(([id, power]) => id === 1 && power === 1)).toBe(true);
    expect(sounds.swing).not.toHaveBeenCalled();
    gw.control.release(KEYS[1].serve);
    gw.step();
    audio.update(gw);
    audio.update(gw);
    expect(sounds.swing.mock.calls).toEqual([[1, 1]]);
    expect(sounds.charge).toHaveBeenCalledWith(1, null);
    gw.game.phase = 'goal';
    sounds.stopCharges.mockClear();
    audio.update(gw);
    expect(sounds.stopCharges).toHaveBeenCalledOnce();
  });

  it('announces flip recovery once, and only for human players', () => {
    const gw = hazardWorld({ hazards: false, singlePlayer: true });
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    audio.reset(gw);
    expect(gw.flip(gw.p1, 0.5)).toBe(true);
    expect(gw.flip(gw.p2, 0.7)).toBe(true);
    audio.update(gw);
    expect(sounds.swing.mock.calls).toEqual([[1, 0.5], [2, 0.7]]);
    gw.frame += SWING.cooldownFrames;
    audio.update(gw);
    audio.update(gw);
    expect(sounds.swingReady.mock.calls).toEqual([[1]]);
  });

  it('warns exactly once at each of the last three serve seconds', () => {
    const gw = world();
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    audio.reset(gw);
    for (let i = 0; i < 181; i++) {
      gw.step();
      audio.update(gw);
    }
    expect(sounds.serveWarning.mock.calls).toEqual([[3, 1], [2, 1], [1, 1]]);
    expect(gw.game.lastPointReason).toBe('serveClock');
  });

  it('does not warn after a serve is released or while the CPU holds the ball', () => {
    const gw = hazardWorld({ hazards: false, singlePlayer: true });
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    gw.game.serveSecondsLeft = 4;
    audio.reset(gw);
    gw.game.serveSecondsLeft = 3;
    audio.update(gw);
    gw.ball.ballOfPlayer = 2;
    gw.game.serveSecondsLeft = 2;
    audio.update(gw);
    gw.game.serveSecondsLeft = 1;
    audio.update(gw);
    expect(sounds.serveWarning).not.toHaveBeenCalled();
  });

  it('announces natural power expiry but stays quiet for replacement and reset', () => {
    const gw = world();
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    gw.powerUps.activate(1, 'speed', gw.frame);
    audio.reset(gw);
    gw.powerUps.activate(1, 'giant', gw.frame);
    audio.update(gw);
    expect(sounds.powerEnd).not.toHaveBeenCalled();
    gw.frame = gw.powerUps.active[1]!.expiresAt;
    gw.powerUps.tick(gw.frame);
    audio.update(gw);
    audio.update(gw);
    expect(sounds.powerEnd.mock.calls).toEqual([[1]]);
    gw.powerUps.activate(2, 'tiny', gw.frame);
    audio.update(gw);
    gw.powerUps.reset();
    audio.reset(gw);
    audio.update(gw);
    expect(sounds.powerEnd).toHaveBeenCalledOnce();
  });

  it.each([
    { singlePlayer: true, winner: 1 as const, won: true },
    { singlePlayer: true, winner: 2 as const, won: false },
    { singlePlayer: false, winner: 2 as const, won: true },
  ])('plays the result once for winner $winner in single-player=$singlePlayer', ({ singlePlayer, winner, won }) => {
    const gw = world({ singlePlayer });
    const sounds = soundSpies();
    const audio = new GameAudio(sounds);
    audio.reset(gw);
    gw.game.phase = 'goal';
    audio.update(gw);
    expect(sounds.matchEnd).not.toHaveBeenCalled();
    gw.game.phase = 'matchOver';
    gw.game.matchWinner = winner;
    audio.update(gw);
    audio.update(gw);
    expect(sounds.matchEnd.mock.calls).toEqual([[won]]);
  });
});
