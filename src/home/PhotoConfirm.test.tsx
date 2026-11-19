import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhotoConfirm from './PhotoConfirm';
beforeEach(() => { HTMLDialogElement.prototype.showModal = function () { this.open = true; }; });
afterEach(cleanup);
it('shows the count and Pro cost before confirmation and permits cancel', () => {
  const onConfirm = vi.fn(), onCancel = vi.fn();
  render(<PhotoConfirm count={3} onConfirm={onConfirm} onCancel={onCancel} />);
  expect(screen.getByRole('dialog').textContent).toContain('Read 3 photos?');
  expect(screen.getByRole('dialog').textContent).toContain('Claude limit');
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Read photos' }));
  expect(onConfirm).toHaveBeenCalledOnce();
});
