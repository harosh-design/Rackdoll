import { DEFAULT_GAME_PHYSICS, DEFAULT_PHYSICS, normalizePhysics, PHYSICS_FIELDS, type PhysicsSettings } from '../sim/physics';
import {
  exportPreset, parsePreset, presetName, savePhysicsLibrary,
  type PhysicsLibrary, type PresetStorage,
} from './physicsPresets';

export function wirePhysicsPanel(
  library: PhysicsLibrary,
  storage: PresetStorage | undefined,
  apply: (settings: PhysicsSettings) => void,
  closeFocus: () => void,
): HTMLDialogElement {
  const panel = document.getElementById('debug-panel') as HTMLDialogElement;
  const launch = document.getElementById('debug-launch') as HTMLButtonElement;
  const fields = document.getElementById('physics-fields')!;
  const select = document.getElementById('physics-preset') as HTMLSelectElement;
  const name = document.getElementById('physics-preset-name') as HTMLInputElement;
  const status = document.getElementById('physics-status')!;
  const remove = document.getElementById('physics-delete') as HTMLButtonElement;
  const file = document.getElementById('physics-import-file') as HTMLInputElement;
  const controls = new Map<keyof PhysicsSettings, { slider: HTMLInputElement; number: HTMLInputElement }>();
  const builtInPresets = new Map([
    ['default', { name: 'Default physics', settings: DEFAULT_GAME_PHYSICS }],
    ['original', { name: 'Original physics', settings: DEFAULT_PHYSICS }],
  ]);
  const say = (text: string) => { status.textContent = text; };
  const persist = () => savePhysicsLibrary(library, storage);
  const storageMessage = () => ' Browser storage is unavailable; changes last for this session. Export JSON to keep them.';

  const sync = (preserveEditing = false) => {
    for (const field of PHYSICS_FIELDS) {
      const control = controls.get(field.key)!;
      control.slider.value = String(library.current[field.key]);
      if (!preserveEditing || document.activeElement !== control.number) {
        control.number.value = library.current[field.key].toFixed(field.digits);
      }
    }
  };
  const update = (settings: PhysicsSettings, message: string, preserveEditing = false) => {
    library.current = normalizePhysics(settings);
    apply(library.current);
    sync(preserveEditing);
    say(message + (persist() ? '' : storageMessage()));
  };
  const refreshPresets = (selected = select.value) => {
    select.replaceChildren(...Array.from(builtInPresets, ([id, preset]) => new Option(preset.name, id)));
    library.presets.forEach((preset, i) => select.add(new Option(preset.name, String(i))));
    select.value = selected;
    if (select.selectedIndex < 0) select.value = 'default';
    remove.disabled = builtInPresets.has(select.value);
  };

  for (const field of PHYSICS_FIELDS) {
    const row = document.createElement('div');
    row.className = 'physics-field';
    const head = document.createElement('div');
    head.className = 'field-head';
    const label = document.createElement('label');
    label.htmlFor = `physics-${field.key}`;
    label.textContent = field.label;
    const value = document.createElement('div');
    value.className = 'physics-value';
    const number = document.createElement('input');
    number.type = 'number';
    number.setAttribute('aria-label', `${field.label} value (${field.unit})`);
    const unit = document.createElement('span');
    unit.textContent = field.unit;
    value.append(number, unit);
    head.append(label, value);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.id = label.htmlFor;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.id = `${slider.id}-hint`;
    hint.textContent = field.hint;
    for (const input of [slider, number]) {
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      input.setAttribute('aria-describedby', hint.id);
    }
    slider.addEventListener('input', () => update({ ...library.current, [field.key]: slider.valueAsNumber }, 'Applied immediately. Save a preset to keep this combination.'));
    number.addEventListener('input', () => {
      if (!Number.isFinite(number.valueAsNumber)) return;
      update({ ...library.current, [field.key]: number.valueAsNumber }, 'Applied immediately. Save a preset to keep this combination.', true);
    });
    number.addEventListener('change', () => {
      if (!Number.isFinite(number.valueAsNumber)) { sync(); return; }
      update({ ...library.current, [field.key]: number.valueAsNumber }, 'Applied immediately. Save a preset to keep this combination.');
    });
    row.append(head, slider, hint);
    fields.append(row);
    controls.set(field.key, { slider, number });
  }

  launch.addEventListener('click', () => {
    if (panel.open) panel.close();
    else {
      panel.show();
      launch.setAttribute('aria-expanded', 'true');
      panel.querySelector<HTMLButtonElement>('#debug-close')!.focus();
    }
  });
  document.getElementById('debug-close')!.addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => {
    launch.setAttribute('aria-expanded', 'false');
    closeFocus();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') {
      event.preventDefault();
      panel.close();
    }
    // Arrow keys and text belong to the editor while a control has focus.
    event.stopPropagation();
  });
  select.addEventListener('change', () => {
    remove.disabled = builtInPresets.has(select.value);
    name.value = builtInPresets.has(select.value) ? '' : library.presets[Number(select.value)].name;
  });
  document.getElementById('physics-load')!.addEventListener('click', () => {
    const preset = builtInPresets.get(select.value) ?? library.presets[Number(select.value)];
    update({ ...preset.settings }, `Loaded “${preset.name}”.`);
  });
  document.getElementById('physics-reset')!.addEventListener('click', () => {
    refreshPresets('default');
    name.value = '';
    update({ ...DEFAULT_GAME_PHYSICS }, 'Default physics restored.');
  });
  const savePreset = (preset: { name: string; settings: PhysicsSettings }) => {
    let index = library.presets.findIndex(p => p.name === preset.name);
    const replaced = index >= 0;
    if (replaced) library.presets[index] = preset;
    else { index = library.presets.length; library.presets.push(preset); }
    refreshPresets(String(index));
    name.value = preset.name;
    return replaced;
  };
  document.getElementById('physics-save')!.addEventListener('click', () => {
    try {
      const preset = { name: presetName(name.value), settings: { ...library.current } };
      const replaced = savePreset(preset);
      say(`${replaced ? 'Updated' : 'Saved'} “${preset.name}”.` + (persist() ? '' : storageMessage()));
    } catch (error) { say((error as Error).message); }
  });
  remove.addEventListener('click', () => {
    if (builtInPresets.has(select.value)) return;
    const [preset] = library.presets.splice(Number(select.value), 1);
    refreshPresets('default');
    name.value = '';
    say(`Deleted “${preset.name}”. Current physics is unchanged.` + (persist() ? '' : storageMessage()));
  });
  document.getElementById('physics-export')!.addEventListener('click', () => {
    const preset = { name: name.value.trim() || 'Custom physics', settings: library.current };
    try {
      const url = URL.createObjectURL(new Blob([exportPreset(preset)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'rackdoll-physics-preset.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('Exported current physics as JSON.');
    } catch (error) { say((error as Error).message); }
  });
  document.getElementById('physics-import')!.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const selected = file.files?.[0];
    if (!selected) return;
    try {
      if (selected.size > 100_000) throw new Error('Preset file is too large (maximum 100 KB).');
      const preset = parsePreset(await selected.text());
      const replaced = savePreset(preset);
      update(preset.settings, `Imported and ${replaced ? 'updated' : 'saved'} “${preset.name}”.`);
    } catch (error) { say(`Import failed: ${(error as Error).message}`); }
    finally { file.value = ''; }
  });
  refreshPresets();
  sync();
  return panel;
}
