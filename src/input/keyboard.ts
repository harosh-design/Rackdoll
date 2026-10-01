import type { Control } from '../sim/control';

/**
 * Maps physical keys to the raw key codes the original tabled (§7). Using
 * `event.code` keeps WASD in the same physical place on any layout.
 */
const CODE_TO_KEYCODE: Record<string, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Space: 32,
  KeyA: 65,
  KeyD: 68,
  KeyW: 87,
  KeyS: 83,
  KeyR: 82,
  KeyC: 67,
  KeyF: 70,
};

export type KeySink = Pick<Control, 'press' | 'release' | 'clear'>;

export function bindKeyboard(target: Window, control: KeySink, isActive: () => boolean): () => void {
  const down = (e: KeyboardEvent) => {
    const code = CODE_TO_KEYCODE[e.code];
    if (code === undefined || !isActive()) return;
    e.preventDefault(); // no page scrolling on arrows/space
    // Auto-repeat is deliberately NOT filtered. Flash re-fired KEY_DOWN on OS
    // key repeat, which re-armed the consumed jump flag — so holding jump in
    // the original bunny-hops as soon as the hips are low again.
    control.press(code);
  };
  const up = (e: KeyboardEvent) => {
    const code = CODE_TO_KEYCODE[e.code];
    if (code === undefined) return;
    control.release(code);
  };
  const blur = () => control.clear();
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  target.addEventListener('blur', blur);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    target.removeEventListener('blur', blur);
  };
}
