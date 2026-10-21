import { describe, expect, it } from 'vitest';
import { GAME_MAPS, MAP_STORAGE_KEY, gameMap, loadMapSelection } from '../src/sim/maps';
import { run, world } from './helpers';

describe('map selection', () => {
  it('uses the complete map even when an old obstacle override disagrees', () => {
    for (const map of GAME_MAPS) {
      const gw = world({ map: map.id, centerObstacle: map.obstacle === 'sharp' ? 'rubber' : 'sharp' });
      expect(gw.mapId).toBe(map.id);
      expect(gw.centerObstacle.id).toBe(map.obstacle);
    }
    expect(gameMap('removed-map').id).toBe('graveyard');
    expect(world().mapId).toBe('graveyard');
  });

  it.each(GAME_MAPS)('keeps $label and its divider through rounds, resets and every mode', map => {
    for (const mode of [{ singlePlayer: true }, { singlePlayer: false }, { botVsBot: true }]) {
      const gw = world({ ...mode, map: map.id });
      run(gw, 90);
      gw.game.newRound();
      run(gw, 30);
      gw.game.resetMatch();
      expect(gw.mapId).toBe(map.id);
      expect(gw.centerObstacle.id).toBe(map.obstacle);
      for (const player of [gw.p1, gw.p2]) {
        expect(Number.isFinite(player.head.getPosition().x)).toBe(true);
        expect(Number.isFinite(player.head.getPosition().y)).toBe(true);
      }
    }
  });

  it.each(GAME_MAPS)('migrates the old $obstacle selection to $label', map => {
    expect(loadMapSelection({ getItem: key => key === 'rackdoll-center-obstacle' ? map.obstacle : null })).toBe(map.id);
  });

  it('prefers the saved map over the old obstacle and safely handles invalid or blocked storage', () => {
    const getItem = (key: string) => key === MAP_STORAGE_KEY ? 'dead-circus' : 'blower';
    expect(loadMapSelection({ getItem })).toBe('dead-circus');
    expect(loadMapSelection({ getItem: () => 'outdated' })).toBe('graveyard');
    expect(loadMapSelection({ getItem: () => { throw new Error('Storage blocked'); } })).toBe('graveyard');
    expect(loadMapSelection()).toBe('graveyard');
  });
});
