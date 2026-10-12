import { DEFAULT_PHYSICS, normalizePhysics, PHYSICS_FIELDS, type PhysicsSettings } from '../sim/physics';

export const PHYSICS_STORAGE_KEY = 'rackdoll-physics-v1';
export interface PhysicsPreset { name: string; settings: PhysicsSettings }
export interface PhysicsLibrary { current: PhysicsSettings; presets: PhysicsPreset[] }
export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;

function readSettings(value: unknown): PhysicsSettings {
  if (!value || typeof value !== 'object') throw new Error('The preset has no physics settings.');
  for (const { key, min, max } of PHYSICS_FIELDS) {
    const number = (value as Record<string, unknown>)[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max) {
      throw new Error(`Invalid ${key}: expected a number between ${min} and ${max}.`);
    }
  }
  return normalizePhysics(value);
}

export function presetName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 60) {
    throw new Error('Enter a preset name of 1–60 characters.');
  }
  return value.trim();
}

export function parsePreset(json: string): PhysicsPreset {
  const value = JSON.parse(json) as Record<string, unknown> | null;
  if (!value || value.version !== 1) throw new Error('Unsupported preset format. Expected version 1.');
  return { name: presetName(value.name), settings: readSettings(value.settings) };
}

export function exportPreset(preset: PhysicsPreset): string {
  return JSON.stringify({ version: 1, name: presetName(preset.name), settings: readSettings(preset.settings) }, null, 2);
}

/** Recover valid saved presets individually if one entry was corrupted. */
export function loadPhysicsLibrary(storage?: PresetStorage): PhysicsLibrary {
  const fallback = { current: { ...DEFAULT_PHYSICS }, presets: [] };
  try {
    const raw = storage?.getItem(PHYSICS_STORAGE_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (value?.version !== 1) return fallback;
    const presets: PhysicsPreset[] = [];
    if (Array.isArray(value.presets)) {
      for (const entry of value.presets) {
        try {
          const preset = { name: presetName(entry?.name), settings: readSettings(entry?.settings) };
          if (!presets.some(p => p.name === preset.name)) presets.push(preset);
        } catch { /* Ignore only the damaged entry. */ }
      }
    }
    let current = { ...DEFAULT_PHYSICS };
    try { current = readSettings(value.current); } catch { /* Keep original physics. */ }
    return { current, presets };
  } catch {
    return fallback;
  }
}

export function savePhysicsLibrary(library: PhysicsLibrary, storage?: PresetStorage): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PHYSICS_STORAGE_KEY, JSON.stringify({ version: 1, ...library }));
    return true;
  } catch {
    return false;
  }
}
