import { afterEach, expect, it, vi } from 'vitest';
import { bindingConflicts, bindingFromEvent, defaultBindings, dispatchKeybind, displayBinding, getBinding, KEYBINDS_KEY, resetBindings, setBinding, subscribeKeybinds } from './keybinds';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
it('keeps existing defaults and stores per-action overrides, resets, and notifications', () => {
  expect(defaultBindings.playPause).toEqual(['Space', 'k']);
  expect(defaultBindings.seekBack).toEqual(['ArrowLeft']);
  expect(defaultBindings.closePanel).toEqual(['Escape']);
  const changed = vi.fn(), unsubscribe = subscribeKeybinds(changed);
  setBinding('captions', ['v']);
  expect(getBinding('captions')).toEqual(['v']);
  expect(getBinding('playPause')).toEqual(defaultBindings.playPause);
  expect(JSON.parse(localStorage.getItem(KEYBINDS_KEY)!)).toEqual({ captions: ['v'] });
  resetBindings('captions');
  expect(getBinding('captions')).toEqual(['c']);
  resetBindings();
  expect(changed).toHaveBeenCalledTimes(3);
  unsubscribe();
});
it('detects conflicts including platform modifier aliases and refuses to overwrite them', () => {
  expect(bindingConflicts('captions', ['k'])).toEqual(['playPause']);
  expect(() => setBinding('captions', ['k'])).toThrow(/Play \/ pause/);
  expect(getBinding('captions')).toEqual(['c']);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
  expect(bindingConflicts('captions', ['Meta+o'])).toEqual(['choosePdfs']);
  expect(displayBinding('Mod+Shift+n')).toBe('Cmd + Shift + N');
});
it('ignores corrupt storage and invalid overrides', () => {
  for (const data of ['{', 'null', '[]', '{"captions":["wat+no"]}', '{"captions":"v"}']) {
    localStorage.setItem(KEYBINDS_KEY, data);
    expect(getBinding('captions')).toEqual(['c']);
  }
  expect(() => setBinding('captions', [''])).toThrow(/valid/);
});
it('matches modifiers exactly, shifted symbols, and the plus key', () => {
  const handler = vi.fn();
  dispatchKeybind(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }), { playPause: handler });
  expect(handler).not.toHaveBeenCalled();
  dispatchKeybind(new KeyboardEvent('keydown', { key: 'k' }), { playPause: handler });
  expect(handler).toHaveBeenCalledTimes(1);
  expect(bindingFromEvent(new KeyboardEvent('keydown', { key: '>', shiftKey: true }))).toBe('>');
  expect(bindingFromEvent(new KeyboardEvent('keydown', { key: '+', shiftKey: true }))).toBe('Shift+Plus');
  expect(bindingFromEvent(new KeyboardEvent('keydown', { key: 'Shift' }))).toBeNull();
});
it('ignores inputs, textareas, selects, nested editable content and composing events', () => {
  const handler = vi.fn();
  const listener = (e: KeyboardEvent) => dispatchKeybind(e, { playPause: handler });
  window.addEventListener('keydown', listener);
  try {
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"><span></span></div>', '<div role="textbox"></div>']) {
      const root = document.createElement('div'); root.innerHTML = html; document.body.append(root);
      root.querySelector('span, input, textarea, select, [role="textbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
      root.remove();
    }
    dispatchKeybind(new KeyboardEvent('keydown', { key: 'k', isComposing: true }), { playPause: handler });
    expect(handler).not.toHaveBeenCalled();
  } finally { window.removeEventListener('keydown', listener); }
});
it('uses remapped keys immediately and leaves button Space to the button', () => {
  setBinding('playPause', ['p']);
  const handler = vi.fn();
  dispatchKeybind(new KeyboardEvent('keydown', { key: 'k' }), { playPause: handler });
  dispatchKeybind(new KeyboardEvent('keydown', { key: 'p' }), { playPause: handler });
  expect(handler).toHaveBeenCalledTimes(1);
  resetBindings();
  const button = document.createElement('button');
  button.addEventListener('keydown', e => dispatchKeybind(e, { playPause: handler }));
  button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
  expect(handler).toHaveBeenCalledTimes(1);
});
