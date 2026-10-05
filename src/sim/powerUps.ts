import { POWER } from './constants';
import type { Player, PlayerId } from './player';

export const POWERS = ['giant', 'tiny', 'feather', 'highJump', 'speed', 'magnet', 'shield'] as const;
export type PowerId = typeof POWERS[number];

export const POWER_LABELS: Record<PowerId, string> = {
  giant: 'GIANT', tiny: 'TINY', feather: 'FEATHER BALL', highJump: 'HIGH JUMP',
  speed: 'SPEED', magnet: 'MAGNET', shield: 'SHIELD',
};

/** Body size per power; every other power plays at normal size. */
const POWER_SCALE: Partial<Record<PowerId, number>> = { giant: 1.5, tiny: 1 / 1.5 };

export interface ActivePower {
  kind: PowerId;
  startedAt: number;
  expiresAt: number;
}

/**
 * Match-owned, frame-based lifecycle for powers collected from bees.
 *
 * A power is only ever `player.power` plus a target size. Jump, speed,
 * feather, shield and magnet all read `player.power` live, so swapping one
 * power for another leaves nothing behind to stack.
 */
export class PowerUps {
  readonly active: Record<PlayerId, ActivePower | null> = { 1: null, 2: null };

  constructor(private readonly players: Record<PlayerId, Player>) {}

  tick(frame: number): void {
    for (const id of [1, 2] as const) {
      const active = this.active[id];
      if (active && frame >= active.expiresAt) this.clearPower(id);
    }
  }

  /** Replaces any active power outright, and restarts the 30 s clock. */
  activate(id: PlayerId, kind: PowerId, frame: number): void {
    const player = this.players[id];
    player.power = kind;
    // Retargets from whatever size the doll is at, mid-transition included.
    player.resizeTo(POWER_SCALE[kind] ?? 1);
    this.active[id] = { kind, startedAt: frame, expiresAt: frame + POWER.durationFrames };
  }

  /** Back to the default doll. `immediate` skips the shrink/grow easing. */
  clearPower(id: PlayerId, immediate = false): void {
    const player = this.players[id];
    player.power = null;
    player.resizeTo(1, immediate);
    this.active[id] = null;
  }

  /** A new match: the dolls are re-stood right after, so sizes snap back. */
  reset(): void {
    for (const id of [1, 2] as const) this.clearPower(id, true);
  }
}
