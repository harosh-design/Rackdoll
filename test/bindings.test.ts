import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bindingOwner, defaultBindings, isAssignableCode, loadBindings, parseBindings, saveBindings, toKeyBindings,
} from '../src/input/bindings';
import { bindKeyboard } from '../src/input/keyboard';
import { KEYS } from '../src/sim/control';
import { GameWorld } from '../src/sim/world';

describe('held movement keys', () => {
  it('report a held jump after it has fired, for each player’s own bindings', () => {
    const bindings = defaultBindings();
    bindings[2].left = 'KeyJ';
    const gw = new GameWorld({ singlePlayer: false, hazards: false, bindings: toKeyBindings(bindings) });
    gw.control.press(KEYS[1].jump);
    gw.control.press('KeyJ');
    gw.step();
    expect(gw.control.isDown(KEYS[1].jump)).toBe(false);
    expect(gw.control.heldDirection(1)).toEqual({ x: 0, y: -1 });
    expect(gw.control.heldDirection(2)).toEqual({ x: -1, y: 0 });
    gw.control.press(KEYS[1].down);
    expect(gw.control.heldDirection(1)).toEqual({ x: 0, y: 0 });
    gw.control.clear();
    expect(gw.control.heldDirection(1)).toEqual({ x: 0, y: 0 });
  });
});

describe('player keyboard settings', () => {
  it('defaults to WASD and I/O/P on the left, arrows and Z/X/C on the right', () => {
    const bindings = defaultBindings();
    expect(bindings[1]).toEqual({
      left: 'KeyA', right: 'KeyD', jump: 'KeyW', down: 'KeyS',
      serve: 'KeyI', dive: 'KeyO', slide: 'KeyP',
    });
    expect(bindings[2]).toEqual({
      left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', down: 'ArrowDown',
      serve: 'KeyZ', dive: 'KeyX', slide: 'KeyC',
    });
    expect(toKeyBindings(bindings)).toEqual(KEYS);
    expect(isAssignableCode('KeyP')).toBe(true);
    expect(isAssignableCode('Escape')).toBe(false);
  });

  it('rejects duplicate and reserved keys in saved settings', () => {
    const bindings = defaultBindings();
    expect(parseBindings(bindings)).toEqual(bindings);
    bindings[2].jump = bindings[1].jump;
    expect(parseBindings(bindings)).toBeNull();
    bindings[2].jump = 'KeyM';
    expect(parseBindings(bindings)).toBeNull();
    expect(bindingOwner(defaultBindings(), 'KeyI')).toEqual({ player: 1, action: 'serve' });
    expect(bindingOwner(defaultBindings(), 'KeyP')).toEqual({ player: 1, action: 'slide' });
    expect(bindingOwner(defaultBindings(), 'ShiftRight')).toBeNull();
  });

  it.each(['dive', 'slide'] as const)('does not serve or charge with the %s button', action => {
    const gw = new GameWorld({ singlePlayer: false, hazards: false });
    gw.control.press(KEYS[1][action]);
    gw.step();
    expect(gw.ball.held).toBe(true);
    expect(gw.p1.performingAcrobatics).toBe(false);
    expect(gw.control.chargeLevel(1)).toBeNull();
  });

  it('uses each player’s reassigned movement, jump and hit keys', () => {
    const bindings = defaultBindings();
    bindings[1].jump = 'KeyT';
    bindings[1].serve = 'KeyY';
    bindings[2].left = 'KeyJ';
    bindings[2].serve = 'KeyH';
    const gw = new GameWorld({ singlePlayer: false, hazards: false, bindings: toKeyBindings(bindings) });

    gw.control.press(KEYS[1].jump); // old jump key
    gw.step();
    expect(gw.control.isDown(KEYS[1].jump)).toBe(true);
    gw.control.release(KEYS[1].jump);
    gw.control.press('KeyT');
    gw.step();
    expect(gw.control.isDown('KeyT')).toBe(false);

    gw.control.press(KEYS[2].jump);
    for (let i = 0; i < 4; i++) gw.step();
    gw.control.release(KEYS[2].jump);
    gw.control.press('KeyH');
    gw.step();
    expect(gw.control.chargeLevel(2)?.power).toBeGreaterThan(0);
    gw.control.release('KeyH');
    gw.step();

    const x = gw.p2.ass.getWorldCenter().x;
    gw.control.press('KeyJ');
    for (let i = 0; i < 15; i++) gw.step();
    expect(gw.p2.ass.getWorldCenter().x).toBeLessThan(x);
    gw.control.release('KeyJ');

    gw.control.press('KeyY');
    gw.step();
    expect(gw.ball.held).toBe(false);
  });
});

describe('saved controls migration', () => {
  afterEach(() => vi.unstubAllGlobals());

  const legacyBindings = () => ({
    1: { left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', down: 'ArrowDown', serve: 'Space' },
    2: { left: 'KeyA', right: 'KeyD', jump: 'KeyW', down: 'KeyS', serve: 'KeyR' },
  });

  const previousBindings = () => ({
    1: { ...legacyBindings()[1], serve: 'KeyI', dive: 'KeyO', slide: 'KeyP' },
    2: { ...legacyBindings()[2], dive: 'KeyF', slide: 'KeyG' },
  });

  it('upgrades old defaults to the separate action buttons', () => {
    expect(parseBindings(legacyBindings())).toEqual(defaultBindings());
  });

  it('updates the previous default layout without resetting a customized layout', () => {
    const previous = previousBindings();
    expect(parseBindings(previous)).toEqual(defaultBindings());
    previous[1].left = 'KeyH';
    expect(parseBindings(previous)).toEqual(previous);
  });

  it('keeps custom legacy keys and chooses unused buttons for the new actions', () => {
    const legacy = legacyBindings();
    legacy[1].left = 'KeyI';
    legacy[1].right = 'KeyO';
    legacy[2].serve = 'KeyP';
    const bindings = parseBindings(legacy)!;
    expect(bindings).not.toBeNull();
    expect(bindings[1]).toMatchObject(legacy[1]);
    expect(bindings[2]).toMatchObject(legacy[2]);
    expect(new Set([...Object.values(bindings[1]), ...Object.values(bindings[2])]).size).toBe(14);
    expect(parseBindings(bindings)).toEqual(bindings);
  });

  it('loads legacy storage and saves and restores custom action keys', () => {
    const stored = new Map([['rackdoll-controls-v1', JSON.stringify(legacyBindings())]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
    const bindings = loadBindings();
    expect(bindings).toEqual(defaultBindings());
    bindings[1].dive = 'KeyH';
    bindings[2].slide = 'KeyJ';
    saveBindings(bindings);
    expect(loadBindings()).toEqual(bindings);
  });
});

describe('physical action keys', () => {
  it('routes both players’ action buttons using physical codes on any keyboard layout', () => {
    const target = new EventTarget();
    const control = {
      press: vi.fn(), release: vi.fn(), clear: vi.fn(),
      uses: (code: string | number) => [...Object.values(KEYS[1]), ...Object.values(KEYS[2])].includes(code),
    };
    const unbind = bindKeyboard(target as Window, control, () => true);
    for (const code of ['KeyI', 'KeyO', 'KeyP', 'KeyZ', 'KeyX', 'KeyC']) {
      const down = Object.assign(new Event('keydown', { cancelable: true }), { code, key: 'x' });
      target.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      expect(control.press).toHaveBeenLastCalledWith(code);
      target.dispatchEvent(Object.assign(new Event('keyup'), { code }));
      expect(control.release).toHaveBeenLastCalledWith(code);
    }
    unbind();
  });
});
