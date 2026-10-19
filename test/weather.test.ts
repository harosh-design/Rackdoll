import { describe, expect, it } from 'vitest';
import { WeatherEffects } from '../src/render/weather';

function frames(weather: WeatherEffects, fps: number, seconds: number, active = true): void {
  for (let frame = 0; frame < fps * seconds; frame++) weather.observeFrame(1 / fps, active);
}

describe('Adaptive weather density', () => {
  it('keeps full detail at healthy frame rates and ignores an isolated slow frame', () => {
    const weather = new WeatherEffects('snow', 42);
    frames(weather, 60, 2);
    weather.observeFrame(0.1);
    frames(weather, 60, 2);
    expect(weather.quality).toBe('high');
  });

  it('reduces density for sustained moderate and heavy frame-rate drops', () => {
    const weather = new WeatherEffects('rain', 42);
    frames(weather, 40, 2);
    expect(weather.quality).toBe('medium');
    frames(weather, 20, 2);
    expect(weather.quality).toBe('low');
  });

  it('restores detail in stages only after a sustained recovery', () => {
    const weather = new WeatherEffects('autumn', 42);
    frames(weather, 20, 2);
    frames(weather, 60, 4);
    expect(weather.quality).toBe('low');
    frames(weather, 60, 2);
    expect(weather.quality).toBe('medium');
    frames(weather, 60, 5);
    expect(weather.quality).toBe('high');
  });

  it('does not treat pauses, background tabs or invalid intervals as poor performance', () => {
    const weather = new WeatherEffects('snow', 42);
    frames(weather, 10, 3, false);
    for (const interval of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 4]) weather.observeFrame(interval);
    frames(weather, 60, 2);
    expect(weather.quality).toBe('high');
  });

  it('avoids rapid quality changes when frame times hover around a threshold', () => {
    const weather = new WeatherEffects('rain', 42);
    frames(weather, 40, 2);
    for (let second = 0; second < 12; second++) frames(weather, second % 2 === 0 ? 60 : 40, 1);
    expect(weather.quality).toBe('medium');
  });
});
