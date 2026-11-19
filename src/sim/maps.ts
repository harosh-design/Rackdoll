import { normalizeCenterObstacle, type CenterObstacleId } from './centerObstacle';

/** A map owns its center obstacle; players choose the complete arena. */
export const GAME_MAPS = [
  {
    id: 'graveyard', label: 'Graveyard', obstacle: 'sharp', obstacleLabel: 'Impaling spike',
    caption: 'Watch the point',
    description: 'A moonlit graveyard with an impaling spike. Jump to pull free; struggling under tension can tear off a trapped limb.',
    atmosphere: 'Moonlit sky', surround: '#191b35',
  },
  {
    id: 'crematorium', label: 'Crematorium', obstacle: 'blower', obstacleLabel: 'Blast fan',
    caption: 'Keep your distance',
    description: 'Brick furnaces and drifting ash frame a blunt blast fan. Strong side jets repel players, the ball, hazards and bats; the upward draft is three times gentler. No impalement.',
    atmosphere: 'Drifting ash', surround: '#20232b',
  },
  {
    id: 'dead-circus', label: 'Dead Circus', obstacle: 'rubber', obstacleLabel: 'Stitched pole',
    caption: 'Bend the divider',
    description: 'An empty tent with a flexible, stitched divider. Players and the ball bend it into the opposite half; it springs back when released.',
    atmosphere: 'Settling dust', surround: '#2b1e29',
  },
  {
    id: 'tomb', label: 'Tomb', obstacle: 'tomb-spike', obstacleLabel: 'Tomb spike',
    caption: 'Crack it. Break it.',
    description: 'Six stone slabs on each side. First landing cracks a slab, resets touch counts and bounces. A fresh landing on the same cracked slab scores for the opposite side. Hold jump to pull free of the spike. All limbs stay attached when you struggle on it.',
    atmosphere: 'Candlelit crypt', surround: '#252036',
  },
] as const satisfies readonly { id: string; label: string; obstacle: CenterObstacleId; obstacleLabel: string;
  caption: string; description: string; atmosphere: string; surround: string }[];

export type GameMapId = typeof GAME_MAPS[number]['id'];
export const MAP_STORAGE_KEY = 'rackdoll-map';

export function gameMap(value: unknown): typeof GAME_MAPS[number] {
  return GAME_MAPS.find(map => map.id === value) ?? GAME_MAPS[0];
}

export function mapForObstacle(value: unknown): GameMapId {
  const obstacle = normalizeCenterObstacle(value);
  return (GAME_MAPS.find(map => map.obstacle === obstacle) ?? GAME_MAPS[0]).id;
}

/** Retain a returning player's obstacle preference as the corresponding map. */
export function loadMapSelection(storage?: { getItem(key: string): string | null }): GameMapId {
  try {
    const saved = storage?.getItem(MAP_STORAGE_KEY);
    return saved != null ? gameMap(saved).id : mapForObstacle(storage?.getItem('rackdoll-center-obstacle'));
  } catch {
    return 'graveyard';
  }
}
