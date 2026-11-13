import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Settings from './Settings';

const api = vi.hoisted(() => ({ getVersion: vi.fn(), checkForUpdate: vi.fn(), installUpdate: vi.fn() }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: api.getVersion }));
vi.mock('@/update', () => ({ checkForUpdate: api.checkForUpdate, installUpdate: api.installUpdate }));

beforeEach(() => {
  vi.resetAllMocks();
  api.getVersion.mockResolvedValue('0.1.1');
  api.checkForUpdate.mockResolvedValue(null);
  api.installUpdate.mockResolvedValue(false);
});
afterEach(() => { cleanup(); delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });
function openInstalled() {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  render(<Settings onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Updates & About' }));
  return screen.getByRole('region', { name: 'Updates & About' });
}

it('explains browser availability without calling native APIs', () => {
  render(<Settings onBack={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Updates & About' }));
  expect(screen.getByText('Updates are available in the installed app')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Check for updates' })).toBeNull();
  expect(api.getVersion).not.toHaveBeenCalled();
  expect(api.checkForUpdate).not.toHaveBeenCalled();
  expect(api.installUpdate).not.toHaveBeenCalled();
});
it('reads the installed version and shows checking then up-to-date state', async () => {
  let finish!: (result: null) => void;
  api.checkForUpdate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const updates = openInstalled();
  expect(await within(updates).findByText('Version 0.1.1')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Check for updates' });
  fireEvent.click(button);
  expect(within(updates).getByRole('status').textContent).toBe('Checking for updates…');
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(null));
  expect(within(updates).getByRole('status').textContent).toBe('Tangent is up to date.');
  expect((button as HTMLButtonElement).disabled).toBe(false);
});
it('offers installation only after a check and restores it when confirmation is declined', async () => {
  api.checkForUpdate.mockResolvedValue({ version: '0.2.0' });
  openInstalled();
  expect(screen.queryByRole('button', { name: 'Install and restart' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect(await screen.findByText('Tangent 0.2.0 is available.')).toBeTruthy();
  expect(api.installUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Install and restart' }) as HTMLButtonElement).disabled).toBe(false));
  expect(api.installUpdate).toHaveBeenCalledOnce();
  expect(screen.getByText('Tangent 0.2.0 is available.')).toBeTruthy();
});
it('shows installation progress and keeps actions disabled while restarting', async () => {
  api.checkForUpdate.mockResolvedValue({ version: '0.2.0' });
  let finish!: (result: boolean) => void;
  api.installUpdate.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  openInstalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
  expect(screen.getByText('Installing update…')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(true));
  expect(screen.getByText('Restarting…')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Install and restart' }) as HTMLButtonElement).disabled).toBe(true);
});
it('reports check and installation failures and lets the user retry', async () => {
  api.checkForUpdate.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ version: '0.2.0' });
  api.installUpdate.mockRejectedValueOnce(new Error('download failed'));
  openInstalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  expect((await screen.findByRole('alert')).textContent).toContain('offline');
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Install and restart' }));
  expect((await screen.findByRole('alert')).textContent).toContain('download failed');
  expect((screen.getByRole('button', { name: 'Install and restart' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Install and restart' }));
  await waitFor(() => expect(api.installUpdate).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('alert')).toBeNull();
});
it('reports version lookup failures while retaining the update check', async () => {
  api.getVersion.mockRejectedValue(new Error('version unavailable'));
  openInstalled();
  expect((await screen.findByRole('alert')).textContent).toContain('version unavailable');
  expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(false);
});

it('navigates sections without losing playback changes and provides a shortcuts mount point', () => {
  render(<Settings onBack={() => {}} />);
  const nav = screen.getByRole('navigation', { name: 'Settings sections' });
  expect(within(nav).getByRole('button', { name: 'General' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(within(nav).getByRole('button', { name: 'Playback' }));
  fireEvent.change(screen.getByLabelText(/^Speed/), { target: { value: '1.5' } });
  fireEvent.click(within(nav).getByRole('button', { name: 'Keyboard shortcuts' }));
  expect(screen.getByRole('region', { name: 'Keyboard shortcuts' }).querySelector('#settings-shortcuts')).toBeTruthy();
  fireEvent.click(within(nav).getByRole('button', { name: 'Playback' }));
  expect((screen.getByLabelText(/^Speed/) as HTMLSelectElement).value).toBe('1.5');
});
it('records the time of a successful manual check', async () => {
  openInstalled();
  expect(screen.getByText('Not checked yet this visit.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByText('Tangent is up to date.');
  expect(screen.getByText(/Last checked/).querySelector('time')?.dateTime).toBeTruthy();
});
