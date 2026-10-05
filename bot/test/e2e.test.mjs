// End to end: the real local node of @zoria/kit (zaria-kit pack) on 127.0.0.1 plays the bot
// started as `node dist/main.js`, as the scoring node does. No network beyond localhost.
// On Windows the pack runs with scripts/win-fsync.mjs (bot/README.md, "Windows"); elsewhere it changes nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const KIT = join('node_modules', '@zoria', 'kit', 'bin', 'zaria-kit.mjs');

/* plays one pack of three matches and returns the console output and the pack record */
function pack(args, env = {}) {
  const out = mkdtempSync(join(tmpdir(), 'zaria-e2e-'));
  try {
    const run = spawnSync(process.execPath, ['--import', './scripts/win-fsync.mjs', KIT, 'pack', '--fast', '--seed', '5', '--out', out, ...args], {
      encoding: 'utf8',
      env: { ...process.env, ZARIA_LANG: 'uk', ...env },
      // a healthy pack takes seconds; a bot that left the match makes the node wait out every tick
      timeout: 60_000,
    });
    const dir = readdirSync(out).find((name) => name.startsWith('pack-'));
    // the record is read here, before the folder goes
    const files = new Map(dir ? readdirSync(join(out, dir)).map((name) => [name, readFileSync(join(out, dir, name), 'utf8')]) : []);
    const read = (name) => files.get(name) ?? '';
    return { status: run.status, text: (run.stdout ?? '') + (run.stderr ?? ''), json: files.has('pack.json') ? JSON.parse(read('pack.json')) : null, read };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

const bot = (text) => text.split('\n').filter((line) => line.includes('бот|'));

test('the bot takes the oath, plays every match to the end and keeps its slot', () => {
  const { status, text, json, read } = pack(['--ticks', '60']);
  assert.equal(status, 0, text);
  assert.deepEqual(json.absent, [
    [false, false, false],
    [false, false, false],
    [false, false, false],
  ]);
  assert.equal(bot(text).filter((line) => line.includes('match over (end)')).length, 3, text);
  assert.doesNotMatch(text, /ваш слот вів наказ/);
  for (const n of [1, 2, 3]) {
    const lines = read(`belief-${n}.ndjson`).trim().split('\n');
    assert.equal(lines.length, 60);
    assert.equal(JSON.parse(lines[0]).t, 1);
    assert.equal(JSON.parse(lines.at(-1)).t, 60);
  }
});

test('a node with another engine hash gets no oath from the bot (P2-03)', () => {
  const wrong = 'a'.repeat(64);
  const command = process.platform === 'win32' ? `set ZARIA_ENGINE=${wrong}&& node dist/main.js` : `ZARIA_ENGINE=${wrong} node dist/main.js`;
  // the node waits for the oath the whole lobby: 2 s instead of 10 keep the test short
  const { text } = pack(['--ticks', '30', '--lobby', '2000', '--bot', command]);
  assert.equal(bot(text).filter((line) => line.includes('did not enter the match')).length, 3, text);
  assert.equal((text.match(/без присяги/g) ?? []).length, 3, text);
});

test('a wire broken for 1.5 s mid-match is resumed, and the nakaz never takes the slot', () => {
  const { text, json } = pack(['--ticks', '600', '--bot', 'node test/drop-bot.mjs'], { DROP_AFTER_MS: '1000', DROP_OUTAGE_MS: '1500' });
  assert.equal(bot(text).filter((line) => line.includes('match over (end)')).length, 3, text);
  assert.ok(bot(text).some((line) => /reconnects [1-9]/.test(line)), text);
  assert.doesNotMatch(text, /ваш слот вів наказ/, text);
  assert.deepEqual(json.absent.flat(), Array(9).fill(false));
});
