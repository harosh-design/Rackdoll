import { Vec2 } from 'planck';
import { ACTIONS, CHARGE } from './constants';
import type { Player, PlayerId, SwingHand } from './player';

export type ControlKey = number | string;
export type ControlAction = 'left' | 'right' | 'jump' | 'down' | 'serve' | 'otherHit';
export type KeyBindings = Record<PlayerId, Record<ControlAction, ControlKey>>;

/** §7 default controls — raw key codes, exactly as the original tabled them. */
export const KEYS: KeyBindings = {
  1: { left: 37, right: 39, jump: 38, down: 40, serve: 32, otherHit: 16 }, // arrows + Space / Shift
  2: { left: 65, right: 68, jump: 87, down: 83, serve: 82, otherHit: 69 }, // A D W S R / E
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
  private readonly down = new Map<ControlKey, boolean>();
  private readonly active = new Map<PlayerId, { kind: 'serve' | 'swing'; key: ControlKey; hand: SwingHand }>();
  private readonly chargeFrames = new Map<PlayerId, number>();
  private readonly keys: KeyBindings;

  constructor(bindings: KeyBindings = KEYS) {
    this.keys = { 1: { ...bindings[1] }, 2: { ...bindings[2] } };
  }

  press(code: ControlKey): void { this.down.set(code, true); }
  release(code: ControlKey): void { this.down.set(code, false); }
  isDown(code: ControlKey): boolean { return this.down.get(code) === true; }
  uses(code: ControlKey): boolean {
    return Object.values(this.keys[1]).includes(code) || Object.values(this.keys[2]).includes(code);
  }
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
    canSwing: (p: Player) => boolean = () => true,
  ): void {
    const k = this.keys[player.id];

    if (this.isDown(k.jump)) {
      player.jump();
      this.down.set(k.jump, false);
    }
    if (this.isDown(k.down)) player.turnDown();
    if (this.isDown(k.left)) player.turn(Vec2(-ACTIONS.turnImpulse, 0));
    if (this.isDown(k.right)) player.turn(Vec2(ACTIONS.turnImpulse, 0));

    let action = this.active.get(player.id);
    if (action == null && this.isDown(k.serve)) {
      if (player.holdingJoint != null) {
        this.active.set(player.id, { kind: 'serve', key: k.serve, hand: 'outside' });
        serve(player);
      } else if (canSwing(player)) {
        this.active.set(player.id, { kind: 'swing', key: k.serve, hand: 'outside' });
      }
    } else if (action == null && this.isDown(k.otherHit) && player.holdingJoint == null && canSwing(player)) {
      this.active.set(player.id, { kind: 'swing', key: k.otherHit, hand: 'inside' });
    }
    action = this.active.get(player.id);
    if (action == null) return;

    if (this.isDown(action.key) && action.kind === 'swing') {
      const previous = this.chargeFrames.get(player.id) ?? 0;
      const frames = Math.min(previous + player.controlScale, CHARGE.maxFrames);
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
