import { Vec2 } from 'planck';
import { ACTIONS, CHARGE } from './constants';
import type { Player, PlayerId, SwingHand } from './player';

/** §7 Controls — raw key codes, exactly as the original tabled them. */
export const KEYS: Record<PlayerId, { left: number; right: number; jump: number; down: number; serve: number; otherHit: number; rescue: number }> = {
  1: { left: 37, right: 39, jump: 38, down: 40, serve: 32, otherHit: 16, rescue: 67 }, // arrows + Space / Shift + C
  2: { left: 65, right: 68, jump: 87, down: 83, serve: 82, otherHit: 69, rescue: 70 }, // A D W S R / E + F
};

export interface ChargeInfo {
  /** 0..1, how far into the swing charge we are right now. */
  power: number;
  hand: SwingHand;
}

/**
 * Controls run once per frame after the world step. A press while holding the
 * ball serves at fixed power immediately. A press during a rally begins a
 * swing charge, and releasing it strikes with the chosen arm.
 */
export class Control {
  private readonly down = new Map<number, boolean>();
  private readonly active = new Map<PlayerId, { kind: 'serve' | 'swing'; key: number; hand: SwingHand }>();
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
    return ([1, 2] as const).some((id) => {
      const action = this.active.get(id);
      return action?.kind === 'swing' && this.isDown(action.key) &&
        (this.chargeFrames.get(id) ?? 0) < CHARGE.maxFrames;
    });
  }

  update(
    player: Player,
    serve: (p: Player) => void,
    swing: (p: Player, power: number, hand: SwingHand) => void,
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

    let action = this.active.get(player.id);
    if (action == null && this.isDown(k.serve)) {
      if (player.holdingJoint != null) {
        this.active.set(player.id, { kind: 'serve', key: k.serve, hand: 'outside' });
        serve(player);
      } else {
        this.active.set(player.id, { kind: 'swing', key: k.serve, hand: 'outside' });
      }
    } else if (action == null && this.isDown(k.otherHit) && player.holdingJoint == null) {
      this.active.set(player.id, { kind: 'swing', key: k.otherHit, hand: 'inside' });
    }
    action = this.active.get(player.id);
    if (action == null) return;

    if (this.isDown(action.key) && action.kind === 'swing') {
      const previous = this.chargeFrames.get(player.id) ?? 0;
      const frames = Math.min(previous + 1, CHARGE.maxFrames);
      this.chargeFrames.set(player.id, frames);
      if (previous < CHARGE.maxFrames) player.windUpArm(frames / CHARGE.maxFrames, action.hand);
    }

    if (!this.isDown(action.key)) {
      if (action.kind === 'swing') {
        const power = (this.chargeFrames.get(player.id) ?? 0) / CHARGE.maxFrames;
        swing(player, power, action.hand);
      }
      this.chargeFrames.delete(player.id);
      this.active.delete(player.id);
    }
  }

  /** Only rally swings have a power meter. */
  chargeLevel(id: PlayerId): ChargeInfo | null {
    const action = this.active.get(id);
    if (!action || action.kind !== 'swing' || !this.isDown(action.key)) {
      return null;
    }
    return { power: (this.chargeFrames.get(id) ?? 0) / CHARGE.maxFrames, hand: action.hand };
  }
}
