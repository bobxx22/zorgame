// First entry retry: which connectBot errors are retried, the backoff law, the retry loop.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backoffMs, retryable, withJitter } from '../dist/jitter.js';

test('network failures before the manifest are retried, node verdicts are not', () => {
  // the texts of @zoria/sdk 1.0.0 (dist/wire-client.js); a new SDK that changes them fails here
  assert.equal(retryable(new Error('wire did not come up: ws://127.0.0.1:1')), true);
  assert.equal(retryable(new Error('wire closed before the oath, code 1006')), true);
  assert.equal(retryable(new Error('wire closed before the manifest: timeout:5000')), true);
  assert.equal(retryable(new Error('wire closed before the manifest: close:1006')), true);
  assert.equal(retryable(new Error('wire closed before the oath, code 4003')), false);
  assert.equal(retryable(new Error('wire closed before the manifest: close:4001')), false);
  assert.equal(retryable(new Error('pins disagree: playing the wrong game is not allowed')), false);
  assert.equal(retryable('wire did not come up'), true);
  // the border: transport codes are below 4000, the node's verdicts start at 4000
  assert.equal(retryable(new Error('wire closed before the oath, code 3999')), true);
  assert.equal(retryable(new Error('wire closed before the oath, code 4000')), false);
  assert.equal(retryable(new Error('wire closed before the manifest: close:3999')), true);
  assert.equal(retryable(new Error('wire closed before the manifest: close:4000')), false);
  assert.equal(retryable(new Error('wire closed before the manifest: end')), false);
});

test('backoff: full jitter under a growing cap', () => {
  assert.equal(backoffMs(0, 2000, () => 0), 0);
  // base is a third of the ceiling: 667, 1334, then the ceiling
  assert.equal(backoffMs(0, 2000, () => 0.999999), 666);
  assert.equal(backoffMs(1, 2000, () => 0.999999), 1333);
  assert.equal(backoffMs(5, 2000, () => 0.999999), 1999);
  for (let n = 0; n < 20; n++) {
    const ms = backoffMs(n, 2000);
    assert.ok(ms >= 0 && ms < 2000);
  }
});

test('withJitter retries network failures up to the limit and then gives up', async () => {
  const waits = [];
  let calls = 0;
  const sleep = async (ms) => {
    waits.push(ms);
  };
  await assert.rejects(
    withJitter({ tries: 3, ceilMs: 300, rnd: () => 0.5, sleep }, async () => {
      calls++;
      throw new Error('wire did not come up: x');
    }),
    /did not come up/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [50, 100]);
});

test('withJitter returns the first success and does not retry a verdict', async () => {
  let calls = 0;
  const sleep = async () => {};
  const value = await withJitter({ tries: 5, ceilMs: 300, sleep }, async () => {
    calls++;
    if (calls < 2) throw new Error('wire closed before the manifest: timeout:5000');
    return 'run';
  });
  assert.equal(value, 'run');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    withJitter({ tries: 5, ceilMs: 300, sleep }, async () => {
      calls++;
      throw new Error('wire closed before the oath, code 4003');
    }),
  );
  assert.equal(calls, 1);
});
