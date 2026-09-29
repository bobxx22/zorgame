// The internal service port of the head: GET /state, POST /preset and its refusals.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Refusal, statusServer } from '../dist/status.js';

function fakeHead() {
  let preset = 'рівний';
  return {
    state: () => ({ state: 'lobby', preset }),
    promote: (value) => {
      if (value === 'live') throw new Refusal(409, 'live');
      if (typeof value !== 'string' || value === '') throw new Refusal(400, 'preset');
      if (value === 'boom') throw new Error('broken');
      preset = value;
      return preset;
    },
  };
}

async function withServer(fn) {
  const server = statusServer(fakeHead());
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('GET /state answers with the head snapshot', async () => {
  await withServer(async (base) => {
    const res = await fetch(base + '/state');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { state: 'lobby', preset: 'рівний' });
  });
});

test('POST /preset changes the preset or answers with the refusal code', async () => {
  await withServer(async (base) => {
    let res = await post(base + '/preset', JSON.stringify({ preset: 'шир' }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { preset: 'шир' });
    res = await post(base + '/preset', JSON.stringify({ preset: 'live' }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { error: 'live' });
    res = await post(base + '/preset', JSON.stringify({ preset: 7 }));
    assert.equal(res.status, 400);
    res = await post(base + '/preset', 'not json');
    assert.equal(res.status, 400);
    res = await post(base + '/preset', JSON.stringify({ preset: 'boom' }));
    assert.equal(res.status, 500);
  });
});

test('unknown paths and wrong methods are 404', async () => {
  await withServer(async (base) => {
    assert.equal((await fetch(base + '/nope')).status, 404);
    assert.equal((await post(base + '/state', '{}')).status, 404);
    assert.equal((await fetch(base + '/preset')).status, 404);
    assert.equal((await fetch(base + '/state?x=1')).status, 200);
  });
});

test('a body of exactly a kilobyte is taken, one byte more is not', async () => {
  const body = (size) => {
    const shell = JSON.stringify({ preset: '' });
    return JSON.stringify({ preset: 'x'.repeat(size - shell.length) });
  };
  assert.equal(body(1024).length, 1024);
  await withServer(async (base) => {
    assert.equal((await post(base + '/preset', body(1024))).status, 200);
    const res = await post(base + '/preset', body(1025)).catch(() => null);
    assert.ok(res === null || res.status === 400);
  });
});

test('bodies well over a kilobyte are refused', async () => {
  await withServer(async (base) => {
    const res = await post(base + '/preset', JSON.stringify({ preset: 'x'.repeat(2000) })).catch(() => null);
    // the server answers 400 and drops the socket; either way the body is not taken
    assert.ok(res === null || res.status === 400);
  });
});
