/** Shared by screen shortcuts, Settings, and native menu accelerators. */
export const actions = {
  playPause: { label: 'Play / pause', group: 'Playback' },
  seekBack: { label: 'Seek back 10 seconds', group: 'Playback' },
  seekForward: { label: 'Seek forward 10 seconds', group: 'Playback' },
  seekBack5: { label: 'Seek back 5 seconds', group: 'Playback' },
  seekForward5: { label: 'Seek forward 5 seconds', group: 'Playback' },
  speedDown: { label: 'Decrease speed', group: 'Playback' },
  speedUp: { label: 'Increase speed', group: 'Playback' },
  captions: { label: 'Toggle captions', group: 'Playback' },
  ask: { label: 'Open Ask', group: 'Panels' },
  transcript: { label: 'Open Transcript', group: 'Panels' },
  textbook: { label: 'Open Textbook', group: 'Panels' },
  checks: { label: 'Open Checks', group: 'Panels' },
  closePanel: { label: 'Close panel / menu / quiz', group: 'Panels' },
  newFolder: { label: 'New folder', group: 'Library' },
  choosePdfs: { label: 'Choose PDFs', group: 'Library' },
  fullscreen: { label: 'Toggle fullscreen', group: 'App' },
  home: { label: 'Go Home / back', group: 'App' },
  settings: { label: 'Open Settings', group: 'App' },
} as const;
export type ActionId = keyof typeof actions;
export const defaultBindings: Record<ActionId, readonly string[]> = {
  playPause: ['Space', 'k'], seekBack: ['ArrowLeft'], seekForward: ['ArrowRight'],
  seekBack5: ['j'], seekForward5: ['l'], speedDown: ['<'], speedUp: ['>'], captions: ['c'],
  ask: ['a'], transcript: ['t'], textbook: ['b'], checks: ['q'], closePanel: ['Escape'],
  newFolder: ['Mod+Shift+n'], choosePdfs: ['Mod+o'], fullscreen: ['f'], home: ['Mod+['], settings: ['Mod+,'],
};
export const KEYBINDS_KEY = 'tangent.keybinds';
export const KEYBINDS_CHANGED = 'tangent:keybinds-changed';
export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const ids = Object.keys(actions) as ActionId[];
const modifiers = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'];
function validBinding(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 80) return false;
  const parts = value.split('+');
  const key = parts.pop()!;
  return !!key && (key.length === 1 || /^(Space|Plus|Escape|Arrow(Left|Right|Up|Down)|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|F([1-9]|1[0-9]|2[0-4]))$/.test(key))
    && parts.every((part, index) => modifiers.includes(part) && parts.indexOf(part) === index);
}
function overrides(): Partial<Record<ActionId, string[]>> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEYBINDS_KEY) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(ids.flatMap(id => {
      const value = (saved as Record<string, unknown>)[id];
      return Array.isArray(value) && value.length <= 8 && value.every(validBinding) ? [[id, value]] : [];
    }));
  } catch { return {}; }
}
export function getBinding(id: ActionId): readonly string[] { return overrides()[id] ?? defaultBindings[id]; }
export function subscribeKeybinds(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEYBINDS_KEY || event.key === null) listener(); };
  window.addEventListener(KEYBINDS_CHANGED, listener);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(KEYBINDS_CHANGED, listener); window.removeEventListener('storage', storage); };
}
function signature(binding: string) {
  return binding.split('+').map(p => p === 'Mod' ? (isMac() ? 'Meta' : 'Ctrl') : p).sort().join('+');
}
export function bindingConflicts(id: ActionId, bindings: readonly string[]): ActionId[] {
  return ids.filter(other => other !== id && getBinding(other).some(b => bindings.some(next => signature(b) === signature(next))));
}
export function setBinding(id: ActionId, bindings: string[]) {
  if (!bindings.every(validBinding) || bindings.length > 8) throw new Error('Choose a valid keyboard shortcut.');
  const conflicts = bindingConflicts(id, bindings);
  if (conflicts.length) throw new Error(`Already used by ${conflicts.map(other => actions[other].label).join(', ')}.`);
  const next = { ...overrides(), [id]: bindings };
  localStorage.setItem(KEYBINDS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(KEYBINDS_CHANGED));
}
export function resetBindings(id?: ActionId) {
  if (id) {
    const next = overrides(); delete next[id];
    localStorage.setItem(KEYBINDS_KEY, JSON.stringify(next));
  } else localStorage.removeItem(KEYBINDS_KEY);
  window.dispatchEvent(new Event(KEYBINDS_CHANGED));
}
export function bindingFromEvent(event: KeyboardEvent): string | null {
  if (event.isComposing || ['Meta', 'Control', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return null;
  const key = event.key === ' ' ? 'Space' : event.key === '+' ? 'Plus' : event.key.length === 1 ? event.key.toLowerCase() : event.key;
  // Symbols already include their Shift state (e.g. < and >), unlike letters.
  const shift = event.shiftKey && !(/^[^a-z0-9]$/.test(key));
  return [...(event.metaKey ? [isMac() ? 'Mod' : 'Meta'] : []), ...(event.ctrlKey ? [isMac() ? 'Ctrl' : 'Mod'] : []),
    ...(event.altKey ? ['Alt'] : []), ...(shift ? ['Shift'] : []), key].join('+');
}
export function isTyping(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
}
export function displayBinding(binding: string) {
  const names: Record<string, string> = { Mod: isMac() ? 'Cmd' : 'Ctrl', Meta: 'Cmd', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', Plus: '+' };
  return binding.split('+').map(part => names[part] ?? (part.length === 1 ? part.toUpperCase() : part)).join(' + ');
}
export type KeybindHandlers = Partial<Record<ActionId, (event: KeyboardEvent) => void>>;
export function dispatchKeybind(event: KeyboardEvent, handlers: KeybindHandlers) {
  if (event.defaultPrevented || event.isComposing || isTyping(event.target)) return;
  const binding = bindingFromEvent(event);
  if (!binding) return;
  // Leave Space to focused buttons and links, and arrows to accessible widgets.
  if (event.target instanceof Element && ((binding === 'Space' && event.target.closest('button, a, [role="button"]'))
    || (binding.startsWith('Arrow') && event.target.closest('[role="tab"], [role="separator"], [role="slider"], [role="menuitem"], [role="menuitemradio"]')))) return;
  for (const id of ids) {
    const handler = handlers[id];
    if (handler && getBinding(id).some(b => signature(b) === signature(binding))) {
      event.preventDefault(); handler(event); return;
    }
  }
}
