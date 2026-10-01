import { Vec2 } from 'planck';
import { ACTIONS, CHARGE } from './constants';
import type { Player, PlayerId } from './player';

/** §7 Controls — raw key codes, exactly as the original tabled them. */
export const KEYS: Record<PlayerId, { left: number; right: number; jump: number; down: number; serve: number; rescue: number }> = {
  1: { left: 37, right: 39, jump: 38, down: 40, serve: 32, rescue: 67 }, // arrows + Space + C
  2: { left: 65, right: 68, jump: 87, down: 83, serve: 82, rescue: 70 }, // A D W S R + F
};

export interface ChargeInfo {
  /** 0..1, how far into the swing charge we are right now. */
  power: number;
}

/**
 * Controls run once per frame after the world step. A press while holding the
 * ball serves at fixed power immediately. A press during a rally begins a
 * swing charge, and releasing it strikes with the outside arm.
 */
export class Control {
  private readonly down = new Map<number, boolean>();
  private readonly active = new Map<PlayerId, 'serve' | 'swing'>();
  private readonly chargeFrames = new Map<PlayerId, number>();

  press(code: number): void { this.down.set(code, true); }
  release(code: number): void { this.down.set(code, false); }
  isDown(code: number): boolean { return this.down.get(code) === true; }
  clear(): void {
    this.down.clear();
    this.active.clear();
    this.chargeFrames.clear();
  }

  isChargingSwing(): boolean {
    return ([1, 2] as const).some((id) =>
      this.active.get(id) === 'swing' &&
      this.isDown(KEYS[id].serve) &&
      (this.chargeFrames.get(id) ?? 0) < CHARGE.maxFrames,
    );
  }

  update(
    player: Player,
    serve: (p: Player) => void,
    swing: (p: Player, power: number) => void,
    rescue: (p: Player) => void = () => {},
  ): void {
    const k = KEYS[player.id];

    if (this.isDown(k.jump)) {
      player.jump();
      this.down.set(k.jump, false);
    }
    if (this.isDown(k.rescue)) {
      rescue(player);
      this.down.set(k.rescue, false);
    }
    if (this.isDown(k.down)) player.turnDown();
    if (this.isDown(k.left)) player.turn(Vec2(-ACTIONS.turnImpulse, 0));
    if (this.isDown(k.right)) player.turn(Vec2(ACTIONS.turnImpulse, 0));

    const held = this.isDown(k.serve);
    const action = this.active.get(player.id);
    if (held && action == null) {
      if (player.holdingJoint != null) {
        this.active.set(player.id, 'serve');
        serve(player);
      } else {
        this.active.set(player.id, 'swing');
      }
    }

    if (held && this.active.get(player.id) === 'swing') {
      const previous = this.chargeFrames.get(player.id) ?? 0;
      const frames = Math.min(previous + 1, CHARGE.maxFrames);
      this.chargeFrames.set(player.id, frames);
      if (previous < CHARGE.maxFrames) player.windUpArm(frames / CHARGE.maxFrames);
    }

    if (!held && action != null) {
      if (action === 'swing') {
        const power = (this.chargeFrames.get(player.id) ?? 0) / CHARGE.maxFrames;
        swing(player, power);
      }
      this.chargeFrames.delete(player.id);
      this.active.delete(player.id);
    }
  }

  /** Only rally swings have a power meter. */
  chargeLevel(id: PlayerId): ChargeInfo | null {
    if (!this.isDown(KEYS[id].serve) || this.active.get(id) !== 'swing') {
      return null;
    }
    return { power: (this.chargeFrames.get(id) ?? 0) / CHARGE.maxFrames };
  }
}
