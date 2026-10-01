import { GIFT, toM } from './constants';
import type { Player, PlayerId } from './player';

export const POWERS = ['giant', 'tiny', 'smash', 'highJump', 'speed', 'magnet', 'shield'] as const;
export type PowerId = typeof POWERS[number];

export const POWER_LABELS: Record<PowerId, string> = {
  giant: 'GIANT', tiny: 'TINY', smash: 'SUPER SHOT', highJump: 'HIGH JUMP',
  speed: 'SPEED', magnet: 'MAGNET', shield: 'SHIELD',
};

/** Body size per power; every other power plays at normal size. */
const POWER_SCALE: Partial<Record<PowerId, number>> = { giant: 1.5, tiny: 1 / 1.5 };

export interface GiftState {
  side: PlayerId;
  xPx: number;
  yPx: number;
  expiresAt: number;
}

export interface ActivePower {
  kind: PowerId;
  startedAt: number;
  expiresAt: number;
}

/**
 * Match-owned, frame-based gift and power lifecycle.
 *
 * A power is only ever `player.power` plus a target size. Jump, speed, shot
 * strength, shield and magnet all read `player.power` live, so swapping one
 * power for another leaves nothing behind to stack.
 */
export class PowerUps {
  gift: GiftState | null = null;
  readonly active: Record<PlayerId, ActivePower | null> = { 1: null, 2: null };
  goals = 0;
  private nextSide: PlayerId = 1;
  private pendingSide: PlayerId | null = null;
  private seed: number;

  constructor(private readonly players: Record<PlayerId, Player>, seed = 0x6d2b79f5) {
    this.seed = seed >>> 0;
  }

  /** Every scored point counts, whatever the reason. */
  onGoal(): void {
    this.goals += 1;
    if (this.goals % GIFT.goalsPerGift !== 0) return;
    this.pendingSide = this.nextSide;
    this.nextSide = this.nextSide === 1 ? 2 : 1;
  }

  /** Spawn after the goal replay, giving the player the full ten seconds. */
  onNewRound(frame: number): void {
    if (this.pendingSide === null) return;
    const side = this.pendingSide;
    this.pendingSide = null;
    this.gift = { side, xPx: GIFT.xPx[side], yPx: GIFT.yPx, expiresAt: frame + GIFT.lifeFrames };
  }

  tick(frame: number, canCollect: boolean): void {
    for (const id of [1, 2] as const) {
      const active = this.active[id];
      if (active && frame >= active.expiresAt) this.clearPower(id);
    }
    const gift = this.gift;
    if (!gift) return;
    if (frame >= gift.expiresAt) {
      this.gift = null;
      return;
    }
    if (!canCollect) return;
    const player = this.players[gift.side];
    const x = toM(gift.xPx);
    const y = toM(gift.yPx);
    const radius2 = toM(GIFT.pickupRadiusPx) ** 2;
    if (!player.bodies.some((body) => {
      const p = body.getWorldCenter();
      return (p.x - x) ** 2 + (p.y - y) ** 2 <= radius2;
    })) return;
    this.gift = null;
    this.activate(gift.side, this.drawPower(), frame);
  }

  /** Replaces any active power outright, and restarts the 30 s clock. */
  activate(id: PlayerId, kind: PowerId, frame: number): void {
    const player = this.players[id];
    player.power = kind;
    // Retargets from whatever size the doll is at, mid-transition included.
    player.resizeTo(POWER_SCALE[kind] ?? 1);
    this.active[id] = { kind, startedAt: frame, expiresAt: frame + GIFT.powerFrames };
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
    this.gift = null;
    this.goals = 0;
    this.nextSide = 1;
    this.pendingSide = null;
    for (const id of [1, 2] as const) this.clearPower(id, true);
  }

  private drawPower(): PowerId {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return POWERS[Math.floor((this.seed / 0x100000000) * POWERS.length)];
  }
}
