import type { ControlAction, KeyBindings } from '../sim/control';
import type { PlayerId } from '../sim/player';
import { controlKey } from './keyboard';

export const ACTIONS: readonly ControlAction[] = ['left', 'right', 'jump', 'down', 'serve'];
export const PLAYERS: readonly PlayerId[] = [1, 2];
export type PhysicalBindings = Record<PlayerId, Record<ControlAction, string>>;

const STORAGE_KEY = 'rackdoll-controls-v1';
export const DEFAULT_BINDINGS: PhysicalBindings = {
  1: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', down: 'ArrowDown', serve: 'Space' },
  2: { left: 'KeyA', right: 'KeyD', jump: 'KeyW', down: 'KeyS', serve: 'KeyR' },
};

export function defaultBindings(): PhysicalBindings {
  return { 1: { ...DEFAULT_BINDINGS[1] }, 2: { ...DEFAULT_BINDINGS[2] } };
}

export function normalizeCode(code: string): string {
  return code === 'ShiftRight' ? 'ShiftLeft' : code;
}

/** Leave game shortcuts and browser modifier combinations free. */
export function isAssignableCode(code: string): boolean {
  if (code === 'KeyP' || code === 'KeyM') return false;
  return /^(Arrow(Left|Right|Up|Down)|Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|ShiftLeft|Backspace|Comma|Period|Slash|Semicolon|Quote|Bracket(Left|Right)|Backquote|Minus|Equal|Numpad(Add|Subtract|Multiply|Divide))$/.test(normalizeCode(code));
}

export function bindingOwner(bindings: PhysicalBindings, code: string): { player: PlayerId; action: ControlAction } | null {
  const normalized = normalizeCode(code);
  for (const player of PLAYERS) {
    for (const action of ACTIONS) {
      if (bindings[player][action] === normalized) return { player, action };
    }
  }
  return null;
}

export function parseBindings(value: unknown): PhysicalBindings | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const result = defaultBindings();
  const used = new Set<string>();
  for (const player of PLAYERS) {
    const row = raw[player];
    if (typeof row !== 'object' || row === null) return null;
    for (const action of ACTIONS) {
      const code = (row as Record<string, unknown>)[action];
      if (typeof code !== 'string' || !isAssignableCode(code)) return null;
      const normalized = normalizeCode(code);
      if (used.has(normalized)) return null;
      used.add(normalized);
      result[player][action] = normalized;
    }
  }
  return result;
}

export function loadBindings(): PhysicalBindings {
  try {
    return parseBindings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) ?? defaultBindings();
  } catch {
    return defaultBindings();
  }
}

export function saveBindings(bindings: PhysicalBindings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Keyboard settings still work for the current session if storage is disabled.
  }
}

export function toKeyBindings(bindings: PhysicalBindings): KeyBindings {
  return {
    1: Object.fromEntries(ACTIONS.map((action) => [action, controlKey(bindings[1][action])])) as KeyBindings[1],
    2: Object.fromEntries(ACTIONS.map((action) => [action, controlKey(bindings[2][action])])) as KeyBindings[2],
  };
}

export function keyLabel(code: string): string {
  const names: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: 'Space', ShiftLeft: 'Shift', Backspace: 'Backspace',
    Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=',
    NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num ×', NumpadDivide: 'Num ÷',
  };
  if (names[code]) return names[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
