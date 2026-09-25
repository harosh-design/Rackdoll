import { Vec2 } from 'planck';
import { ACTIONS } from './constants';
import type { Player, PlayerId } from './player';

/** §7 Controls — raw key codes, exactly as the original tabled them. */
export const KEYS: Record<PlayerId, { left: number; right: number; jump: number; down: number; serve: number }> = {
  1: { left: 37, right: 39, jump: 38, down: 40, serve: 32 }, // arrows + space
  2: { left: 65, right: 68, jump: 87, down: 83, serve: 82 }, // A D W S R
};

/**
 * The original's `control`: a table of key state keyed by raw key code, with
 * `update(player)` run once per frame per player, after the world step. That
 * ordering is why input lands one step late (§3).
 *
 * No DOM in here — the browser adapter lives in src/input.
 */
export class Control {
  private readonly down = new Map<number, boolean>();

  press(code: number): void { this.down.set(code, true); }
  release(code: number): void { this.down.set(code, false); }
  isDown(code: number): boolean { return this.down.get(code) === true; }
  clear(): void { this.down.clear(); }

  /**
   * @param serve called for `pas`; the game has to sequence the serve's
   *   touch-count side effects, so it is injected rather than called here.
   */
  update(player: Player, serve: (p: Player) => void): void {
    const k = KEYS[player.id];

    // Jump is consumed: it needs a fresh press.
    if (this.isDown(k.jump)) {
      player.jump();
      this.down.set(k.jump, false);
    }
    // The rest repeat while held.
    if (this.isDown(k.down)) player.turnDown();
    if (this.isDown(k.left)) player.turn(Vec2(-ACTIONS.turnImpulse, 0));
    if (this.isDown(k.right)) player.turn(Vec2(ACTIONS.turnImpulse, 0));
    if (this.isDown(k.serve)) serve(player);
  }
}
