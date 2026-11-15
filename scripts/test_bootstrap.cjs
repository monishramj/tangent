const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('setup screen presents progress, cancellation, and retry from the IPC contract', async () => {
  const elements = Object.fromEntries(['#start', '#cancel', 'progress', '#status'].map(id => [id, {}]));
  let state = { status: 'installing', phase: 'packages', attempt: 1, downloadGb: [2, 3], message: 'Preparing tools' };
  const calls = [];
  let next;
  vm.runInNewContext(fs.readFileSync(`${__dirname}/../src-tauri/src/bootstrap.js`, 'utf8'), {
    document: { querySelector: id => elements[id] },
    window: { __TAURI_INTERNALS__: { invoke: async command => { calls.push(command); return state; } } },
    setTimeout: callback => { next = callback; },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['#status'].textContent, 'Preparing tools');
  assert.equal(elements['progress'].hidden, false);
  assert.equal(elements['#start'].disabled, true);
  await elements['#cancel'].onclick();
  assert.ok(calls.includes('bootstrap_cancel'));
  state = { ...state, status: 'cancelled', message: 'Resume anytime' };
  await next();
  assert.equal(elements['progress'].hidden, true);
  assert.equal(elements['#start'].textContent, 'Resume setup');
  assert.equal(elements['#start'].disabled, false);
  await elements['#start'].onclick();
  assert.ok(calls.includes('bootstrap_start'));
  state = { ...state, status: 'failed', message: 'Check your connection' };
  await next();
  assert.equal(elements['#status'].textContent, 'Check your connection');
  assert.equal(elements['#start'].disabled, false);
});
