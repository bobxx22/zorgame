// wire.ts: connection options, the belief diary, the WireBot around the strategy, the head for the service port.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { runMatch } from '@zoria/sdk';
import { encodeOrders } from '@zoria/protocol';
import { BELIEF_FAULTS, BeliefDiary, BotShell, statusPortOf, thinkSummary, WIRE_OPTS } from '../dist/wire.js';

/* real observation frames of ticks 1-12, recorded once from an in-process match */
const frames = [];
runMatch(createEngine, {
  seed: 7,
  ticks: 12,
  bots: {
    A: {
      init() {},
      tick(bytes) {
        frames.push(bytes);
        return encodeOrders([]);
      },
    },
  },
});
const observeBytes = (t) => frames[t - 1];

/* a strategy double: what it replies, what belief it gives, how often it was reset */
function fakeStrategy(opts = {}) {
  const s = {
    inits: 0,
    resets: 0,
    fed: [],
    init() {
      s.inits++;
    },
    tick: () => new Uint8Array([0x80]),
    feedback(v) {
      s.fed.push(v);
    },
    belief: opts.belief ?? (() => ({ t: 1, pulse: {}, own: {} })),
    resetBelief() {
      s.resets++;
    },
  };
  return s;
}

const tempDir = () => mkdtempSync(join(tmpdir(), 'zaria-wire-'));
const flush = () => new Promise((ok) => setImmediate(ok));

test('resume after a drop: 12 tries under a 1 s cap, the oath waits for the 10 s lobby', () => {
  assert.deepEqual({ ...WIRE_OPTS }, { resumeTries: 12, resumeJitterMs: 1000, connectTimeoutMs: 10000 });
});

test('service port: only an integer 1-65535, anything else means no port', () => {
  const lines = [];
  const log = (line) => lines.push(line);
  assert.equal(statusPortOf(undefined, log), 0);
  assert.equal(statusPortOf('', log), 0);
  assert.equal(statusPortOf(' ', log), 0);
  assert.equal(lines.length, 0);
  assert.equal(statusPortOf('8080', log), 8080);
  assert.equal(statusPortOf('1', log), 1);
  assert.equal(statusPortOf('65535', log), 65535);
  assert.equal(statusPortOf('65536', log), 0);
  assert.equal(statusPortOf('70000', log), 0);
  assert.equal(statusPortOf('0', log), 0);
  assert.equal(statusPortOf('-1', log), 0);
  assert.equal(statusPortOf('80.5', log), 0);
  assert.equal(statusPortOf('abc', log), 0);
  assert.equal(lines.length, 6);
});

test('think summary: p50, p99 and the maximum', () => {
  assert.deepEqual(thinkSummary([]), { p50: '0', p99: '0', max: '0' });
  const values = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.deepEqual(thinkSummary(values.reverse()), { p50: '51.0', p99: '100.0', max: '100.0' });
  assert.deepEqual(thinkSummary([2.25]), { p50: '2.3', p99: '2.3', max: '2.3' });
});

test('the diary writes one line per frame and nothing without a path', () => {
  const dir = tempDir();
  try {
    const path = join(dir, 'belief.ndjson');
    const diary = new BeliefDiary(path, () => {});
    diary.start();
    assert.equal(diary.open, true);
    const s = fakeStrategy();
    diary.write(s, observeBytes(1));
    diary.write(s, observeBytes(2));
    diary.close();
    assert.equal(diary.open, false);
    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 2);
    assert.equal(diary.frames, 2);
    assert.ok(diary.at > 0);
    const none = new BeliefDiary('', () => {});
    none.start();
    assert.equal(none.open, false);
    none.write(s, observeBytes(1));
    assert.equal(none.frames, 0);
    // a frame-less belief writes nothing
    const quiet = new BeliefDiary(join(dir, 'quiet.ndjson'), () => {});
    quiet.start();
    quiet.write(fakeStrategy({ belief: () => null }), observeBytes(1));
    quiet.close();
    assert.equal(readFileSync(join(dir, 'quiet.ndjson'), 'utf8'), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a diary that cannot open plays on without it', () => {
  const lines = [];
  const dir = tempDir();
  try {
    const diary = new BeliefDiary(join(dir, 'missing', 'belief.ndjson'), (line) => lines.push(line));
    diary.start();
    assert.equal(diary.open, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /did not open/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every diary fault is logged with its tick, resets the belief, and three in a row turn it off', () => {
  const lines = [];
  const dir = tempDir();
  try {
    const diary = new BeliefDiary(join(dir, 'b.ndjson'), (line) => lines.push(line));
    diary.start();
    let fail = true;
    const s = fakeStrategy({
      belief: () => {
        if (fail) throw new Error('disk');
        return { t: 1 };
      },
    });
    diary.write(s, observeBytes(7));
    assert.equal(s.resets, 1);
    assert.match(lines[0], /tick 7: disk/);
    fail = false;
    diary.write(s, observeBytes(8));
    assert.equal(diary.frames, 1);
    // a success in between resets the count: three new faults are needed
    fail = true;
    diary.write(s, observeBytes(9));
    diary.write(s, observeBytes(10));
    assert.equal(diary.open, true);
    diary.write(s, observeBytes(11));
    assert.equal(BELIEF_FAULTS, 3);
    assert.equal(diary.open, false);
    assert.equal(s.resets, 4);
    assert.match(lines.at(-1), /turned off after 3/);
    assert.equal(lines.length, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function shell(opts = {}) {
  const made = [];
  const lines = [];
  const sh = new BotShell({
    preset: 'рівний',
    engine: 'e'.repeat(64),
    freeze: false,
    beliefFile: opts.beliefFile ?? '',
    presets: () => ['рівний', 'шир'],
    createStrategy: (preset) => {
      if (preset === 'шир' && opts.brokenShir) throw new Error('no head');
      const s = fakeStrategy();
      s.preset = preset;
      made.push(s);
      return s;
    },
    log: (line) => lines.push(line),
    ...opts.shell,
  });
  return { sh, made, lines };
}

test('the WireBot replies with the strategy output and writes the diary after the reply', async () => {
  const dir = tempDir();
  try {
    const path = join(dir, 'b.ndjson');
    const { sh, made } = shell({ beliefFile: path });
    const bot = sh.wireBot();
    bot.init(new Uint8Array(), 'A');
    assert.equal(made[0].inits, 1);
    const out = bot.tick(observeBytes(1));
    assert.deepEqual([...out], [0x80]);
    // the line is not written yet: the reply goes first
    assert.equal(sh.diary.frames, 0);
    await flush();
    assert.equal(sh.diary.frames, 1);
    assert.equal(sh.think.length, 1);
    bot.feedback(new Uint8Array([0x80]));
    assert.equal(made[0].fed.length, 1);
    sh.diary.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('connect options carry the pins, the resume settings and the tick counter', () => {
  const { sh } = shell();
  const o = sh.connectOpts('ws://127.0.0.1:1', 'seal', 'zaria-bot');
  assert.equal(o.url, 'ws://127.0.0.1:1');
  assert.equal(o.token, 'seal');
  assert.equal(o.agent, 'zaria-bot');
  assert.equal(o.engine, 'e'.repeat(64));
  assert.equal(o.resumeTries, 12);
  assert.equal(o.resumeJitterMs, 1000);
  assert.equal(o.connectTimeoutMs, 10000);
  o.onTick(42, 40);
  assert.equal(sh.tick, 42);
  assert.equal(sh.frames, 40);
  o.onTick(null, 41);
  assert.equal(sh.tick, 42);
  assert.equal(sh.frames, 41);
});

test('promote: a known preset between matches builds a new head; refusals keep the old one', () => {
  const { sh, made } = shell({ brokenShir: false });
  const head = sh.head();
  assert.equal(head.state().preset, 'рівний');
  assert.equal(head.state().state, 'lobby');
  assert.equal(head.state().engine, 'e'.repeat(64));
  assert.throws(() => head.promote('облягач'), (e) => e.code === 400);
  assert.throws(() => head.promote(7), (e) => e.code === 400);
  sh.phase = 'live';
  assert.throws(() => head.promote('шир'), (e) => e.code === 409 && e.message === 'live');
  sh.phase = 'done';
  assert.equal(head.promote('шир'), 'шир');
  assert.equal(sh.strategy, made[1]);
  assert.equal(head.state().preset, 'шир');
});

test('promote under freeze is refused, and a head that fails to build changes nothing', () => {
  const frozen = shell({ shell: { freeze: true } });
  assert.throws(() => frozen.sh.head().promote('шир'), (e) => e.code === 409 && e.message === 'freeze');
  const broken = shell({ brokenShir: true });
  const before = broken.sh.strategy;
  assert.throws(() => broken.sh.head().promote('шир'), /no head/);
  assert.equal(broken.sh.strategy, before);
  assert.equal(broken.sh.preset, 'рівний');
});

test('the end-of-match line names the reason, the counters and the think time', () => {
  const { sh } = shell();
  sh.why = 'end';
  sh.think.push(1, 2, 3);
  sh.run = { stats: { ticks: 1200, faults: 0, resumes: 6 } };
  assert.equal(sh.summary(), 'match over (end): answers 1200, throws 0, reconnects 6; think, ms: p50 2.0, p99 3.0, max 3.0');
});
