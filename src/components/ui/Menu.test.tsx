import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import Menu from './Menu';
import Select from './Select';

afterEach(cleanup);
it('opens with the keyboard, moves focus, dismisses and restores the trigger', async () => {
  const action = vi.fn();
  render(<Menu label="Actions" trigger="…"><button role="menuitem" onClick={action}>Rename</button><button role="menuitem">Delete</button></Menu>);
  const trigger = screen.getByRole('button', { name: 'Actions' });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' })));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' })));
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
it('dismisses on outside press and leaves native select keys to the platform', () => {
  render(<Menu label="Move PDF" trigger="…" form><label>Folder<Select><option>None</option><option>Class</option></Select></label></Menu>);
  const trigger = screen.getByRole('button', { name: 'Move PDF' });
  fireEvent.click(trigger);
  const select = screen.getByRole('combobox', { name: 'Folder' });
  const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  select.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('dialog')).toBeNull();
});
