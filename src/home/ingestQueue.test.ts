import { expect, it, vi } from 'vitest';
import { ingestQueue } from './ingestQueue';

const deferred = () => {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>(yes => { resolve = yes; });
  return { promise, resolve };
};

it('reads FIFO, appends while running and reports progress without overlapping', async () => {
  const first = deferred(), second = deferred();
  const read = vi.fn().mockImplementationOnce((_path, report) => {
    report({ fraction: .4, label: 'Reading' }); return first.promise;
  }).mockImplementationOnce(() => second.promise).mockResolvedValueOnce('c');
  const queue = ingestQueue(read);
  const a = queue.enqueue('a.pdf'), b = queue.enqueue('b.pdf');
  expect(b.status).toBe('queued');
  await Promise.resolve();
  expect(a.progress?.fraction).toBe(.4);
  const c = queue.enqueue('c.pdf');
  expect(read.mock.calls.map(call => call[0])).toEqual(['a.pdf']);
  first.resolve('a'); await a.result;
  expect(read.mock.calls.map(call => call[0])).toEqual(['a.pdf', 'b.pdf']);
  expect(c.status).toBe('queued');
  second.resolve('b'); await c.result;
  expect(read.mock.calls.map(call => call[0])).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  expect(queue.snapshot().every(item => item.status === 'done')).toBe(true);
});

it('deduplicates queued, running and completed reads', async () => {
  const pending = deferred(), read = vi.fn(() => pending.promise);
  const queue = ingestQueue(read), first = queue.enqueue('a.pdf');
  expect(queue.enqueue('a.pdf')).toBe(first);
  await Promise.resolve();
  expect(queue.enqueue('a.pdf')).toBe(first);
  pending.resolve('a'); await first.result;
  expect(queue.enqueue('a.pdf')).toBe(first);
  expect(read).toHaveBeenCalledTimes(1);
});

it('continues after failure and retries at the end of the queue', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('broken')).mockResolvedValue('ok');
  const queue = ingestQueue(read), a = queue.enqueue('a.pdf'), b = queue.enqueue('b.pdf');
  await expect(a.result).rejects.toThrow('broken');
  expect(a.status).toBe('failed');
  expect(queue.enqueue('a.pdf')).toBe(a);
  const retry = queue.enqueue('a.pdf', true);
  await Promise.all([b.result, retry.result]);
  expect(read.mock.calls.map(call => call[0])).toEqual(['a.pdf', 'b.pdf', 'a.pdf']);
  expect(retry.status).toBe('done');
});
