import type { Control, ControlKey } from '../sim/control';

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
  ShiftLeft: 16,
  ShiftRight: 16,
  KeyA: 65,
  KeyD: 68,
  KeyW: 87,
  KeyS: 83,
  KeyR: 82,
  KeyE: 69,
};

/** Keep original key codes for defaults and use physical codes for new keys. */
export function controlKey(code: string): ControlKey {
  return CODE_TO_KEYCODE[code] ?? code;
}

export type KeySink = Pick<Control, 'press' | 'release' | 'clear' | 'uses'>;

export function bindKeyboard(target: Window, control: KeySink, isActive: () => boolean): () => void {
  const down = (e: KeyboardEvent) => {
    if (!isActive() || e.altKey || e.ctrlKey || e.metaKey || e.code === 'Unidentified') return;
    const code = controlKey(e.code);
    if (!control.uses(code)) return;
    e.preventDefault(); // no page scrolling on arrows/space
    // Auto-repeat is deliberately NOT filtered. Flash re-fired KEY_DOWN on OS
    // key repeat, which re-armed the consumed jump flag — so holding jump in
    // the original bunny-hops as soon as the hips are low again.
    control.press(code);
  };
  const up = (e: KeyboardEvent) => {
    const code = controlKey(e.code);
    if (control.uses(code)) control.release(code);
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
