import { describe, expect, it } from 'vitest';
import {
  bindingOwner, defaultBindings, parseBindings, toKeyBindings,
} from '../src/input/bindings';
import { GameWorld } from '../src/sim/world';

describe('player keyboard settings', () => {
  it('rejects duplicate and reserved keys in saved settings', () => {
    const bindings = defaultBindings();
    expect(parseBindings(bindings)).toEqual(bindings);
    bindings[2].jump = bindings[1].jump;
    expect(parseBindings(bindings)).toBeNull();
    bindings[2].jump = 'KeyP';
    expect(parseBindings(bindings)).toBeNull();
    expect(bindingOwner(defaultBindings(), 'ShiftRight')).toEqual({ player: 1, action: 'otherHit' });
  });

  it('uses each player’s reassigned movement, jump and hit keys', () => {
    const bindings = defaultBindings();
    bindings[1].jump = 'KeyF';
    bindings[1].serve = 'KeyG';
    bindings[2].left = 'KeyJ';
    bindings[2].otherHit = 'KeyH';
    const gw = new GameWorld({ singlePlayer: false, hazards: false, bindings: toKeyBindings(bindings) });

    gw.control.press(38); // old jump key
    gw.step();
    expect(gw.control.isDown(38)).toBe(true);
    gw.control.release(38);
    gw.control.press('KeyF');
    gw.step();
    expect(gw.control.isDown('KeyF')).toBe(false);

    gw.control.press('KeyH');
    gw.step();
    expect(gw.control.chargeLevel(2)?.hand).toBe('inside');
    gw.control.release('KeyH');
    gw.step();

    const x = gw.p2.ass.getWorldCenter().x;
    gw.control.press('KeyJ');
    for (let i = 0; i < 15; i++) gw.step();
    expect(gw.p2.ass.getWorldCenter().x).toBeLessThan(x);
    gw.control.release('KeyJ');

    gw.control.press('KeyG');
    gw.step();
    expect(gw.ball.held).toBe(false);
  });
});
