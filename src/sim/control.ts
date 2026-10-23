import { Vec2 } from 'planck';
import { ACTIONS, CHARGE } from './constants';
import type { Player, PlayerId } from './player';

export type ControlKey = number | string;
export type ControlAction = 'left' | 'right' | 'jump' | 'down' | 'serve' | 'dive' | 'slide';
export type KeyBindings = Record<PlayerId, Record<ControlAction, ControlKey>>;

/** Default controls for the left and right players, with separate action buttons. */
export const KEYS: KeyBindings = {
  1: { left: 65, right: 68, jump: 87, down: 83, serve: 'KeyI', dive: 'KeyO', slide: 'KeyP' },
  2: { left: 37, right: 39, jump: 38, down: 40, serve: 'KeyZ', dive: 'KeyX', slide: 'KeyC' },
};

export interface ChargeInfo {
  /** 0..1, how far into the flip charge we are right now. */
  power: number;
}

/**
 * Controls run once per frame after the world step. A press while holding the
 * ball serves at fixed power immediately. Separate buttons dive or slide toward
 * the ball. The attack key charges a flip that fires on release, independently
 * of movement keys.
 */
export class Control {
  private readonly down = new Map<ControlKey, boolean>();
  /** Physically held keys. Unlike `down`, a consumed jump press stays held. */
  private readonly held = new Set<ControlKey>();
  /** Fresh physical presses, excluding OS key repeats. */
  private readonly pressed = new Set<ControlKey>();
  private readonly active = new Map<PlayerId, { kind: 'serve' | 'swing' | 'dive' | 'slide'; key: ControlKey }>();
  private readonly chargeFrames = new Map<PlayerId, number>();
  private readonly keys: KeyBindings;

  constructor(bindings: KeyBindings = KEYS) {
    this.keys = { 1: { ...bindings[1] }, 2: { ...bindings[2] } };
  }

  press(code: ControlKey): void {
    if (!this.held.has(code)) this.pressed.add(code);
    this.down.set(code, true);
    this.held.add(code);
  }
  release(code: ControlKey): void {
    this.down.set(code, false);
    this.held.delete(code);
    this.pressed.delete(code);
  }
  isDown(code: ControlKey): boolean { return this.down.get(code) === true; }
  uses(code: ControlKey): boolean {
    return Object.values(this.keys[1]).includes(code) || Object.values(this.keys[2]).includes(code);
  }
  clear(): void {
    this.down.clear();
    this.held.clear();
    this.pressed.clear();
    this.active.clear();
    this.chargeFrames.clear();
  }

  /** The held movement keys as a screen direction: x right, y down, each -1, 0 or 1. */
  heldDirection(id: PlayerId): { x: number; y: number } {
    const k = this.keys[id];
    const axis = (minus: ControlKey, plus: ControlKey) => Number(this.held.has(plus)) - Number(this.held.has(minus));
    return { x: axis(k.left, k.right), y: axis(k.jump, k.down) };
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
    swing: (p: Player, power: number, dive?: boolean) => void,
    canSwing: (p: Player) => boolean = () => true,
    slide: (p: Player) => void = () => {},
    canManeuver: (p: Player) => boolean = p => !p.performingAcrobatics,
  ): void {
    const k = this.keys[player.id];
    const divePressed = this.pressed.delete(k.dive);
    const slidePressed = this.pressed.delete(k.slide);

    if (this.isDown(k.jump)) {
      player.jump();
      this.down.set(k.jump, false);
    }
    if (this.isDown(k.down)) player.turnDown();
    if (this.isDown(k.left)) player.turn(Vec2(-ACTIONS.turnImpulse, 0));
    if (this.isDown(k.right)) player.turn(Vec2(ACTIONS.turnImpulse, 0));

    let action = this.active.get(player.id);
    let served = false;
    if (action == null && this.isDown(k.serve)) {
      if (player.holdingJoint != null) {
        this.active.set(player.id, { kind: 'serve', key: k.serve });
        serve(player);
        served = true;
      } else if (canSwing(player)) {
        this.active.set(player.id, { kind: 'swing', key: k.serve });
      }
    }
    action = this.active.get(player.id);
    if ((divePressed || slidePressed) && !served && canManeuver(player)) {
      const maneuver = divePressed ? 'dive' : 'slide';
      // Cancel a charged flip without firing it when its button is released.
      if (action?.kind === 'swing') action.kind = maneuver;
      this.chargeFrames.delete(player.id);
      if (maneuver === 'dive') swing(player, 0, true);
      else slide(player);
    }
    if (action == null) return;

    if (this.isDown(action.key) && action.kind === 'swing') {
      const previous = this.chargeFrames.get(player.id) ?? 0;
      const frames = Math.min(previous + player.controlScale, CHARGE.maxFrames);
      this.chargeFrames.set(player.id, frames);
      if (previous < CHARGE.maxFrames) player.windUp(frames / CHARGE.maxFrames);
    }

    if (!this.isDown(action.key)) {
      if (action.kind === 'swing') {
        const power = (this.chargeFrames.get(player.id) ?? 0) / CHARGE.maxFrames;
        swing(player, power);
      }
      this.chargeFrames.delete(player.id);
      this.active.delete(player.id);
    }
  }

  /** Only rally flips have a power meter. */
  chargeLevel(id: PlayerId): ChargeInfo | null {
    const action = this.active.get(id);
    if (!action || action.kind !== 'swing' || !this.isDown(action.key)) {
      return null;
    }
    return { power: (this.chargeFrames.get(id) ?? 0) / CHARGE.maxFrames };
  }
}
