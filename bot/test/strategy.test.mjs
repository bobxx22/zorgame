// Pulse strategy: unit checks of the pulse and in-process matches through the SDK harness.
// Run: npm test (builds dist/ first). Expectations are numbers, not the exported constants,
// so a changed threshold fails here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { runMatch } from '@zoria/sdk';
import { decodeOrders, decodeVerdicts, encodeOrders, encodeVerdicts } from '@zoria/protocol';
import {
  channelLeft,
  costAt,
  DEFAULT_PRESET,
  FAIL_LOG_EVERY,
  headVerdicts,
  PULSE_AFTER,
  PulseStrategy,
  presetOrDefault,
  presets,
  pulseOrder,
} from '../dist/strategy.js';

const cfg = { upFloor: 96, downFloor: 1024, relayUp: 24, relayDown: 192, netK: 8, chanOrder: 32, chanTick: 32, scanCost: 256, scanRad: 3, watchByte: 7, stormCost: 2 };
const hearth = { q: 6, r: -12 };
const world = { cfg, storms: [], hearth };
// a storm spot resting on the hearth for the whole match: x = sqrt(3) * (q + r / 2), y = 1.5 * r
const stormOnHearth = [{ x0: 0, y0: -18, vx: 0, vy: 0, r: 7 }];
const focus = { kind: 'watch', q: 6, r: -12, keep: 0 };
const unit = (id, extra = {}) => ({ id, cls: 'ткач', q: 5, r: -11, mute: false, stuck: false, wait: 0, work: 0, away: 0, task: null, ...extra });
const task = { goal: null, site: null, feed: null, jam: null, ram: null, home: false, path: 3 };
const observe = (units, chan = 141, t = 10) => ({
  t,
  pulse: { energy: 100, chan, chanAt: chan, ear: 1400, earAt: 1400, minutes: 0, needles: 2, mercy: false },
  mine: { needles: [], units, jams: [], losts: [], order: null, pact: {}, ledger: {} },
  own: [],
  foe: [],
  noisy: [],
  pub: {},
  events: [],
});

test('the pulse threshold and the log cadence are what the plan says', () => {
  assert.equal(PULSE_AFTER, 2);
  assert.equal(FAIL_LOG_EVERY, 100);
});

test('pulse halts a unit with no task and no step started', () => {
  assert.deepEqual(pulseOrder(observe([unit('T-A1')]), [], focus, world), { kind: 'halt', unit: 'T-A1' });
});

test('pulse never halts a unit the head commanded in the same frame', () => {
  const head = [{ kind: 'needle', unit: 'T-A1', q: 8, r: -10 }];
  const units = [unit('T-A1'), unit('K-A2', { cls: 'клинок' })];
  assert.deepEqual(pulseOrder(observe(units), head, focus, world), { kind: 'halt', unit: 'K-A2' });
  // the only idle unit is taken: the focus is repeated instead
  assert.deepEqual(pulseOrder(observe([unit('T-A1')]), head, focus, world), focus);
});

test('pulse leaves busy and stepping units alone', () => {
  const units = [unit('T-A1', { task }), unit('K-A2', { cls: 'клинок', wait: 1 })];
  assert.deepEqual(pulseOrder(observe(units), [], focus, world), focus);
  assert.equal(pulseOrder(observe(units), [], null, world), null);
});

test('halt needs 32 bytes left: exactly 32 is enough, 31 is not', () => {
  const three = Array.from({ length: 3 }, () => ({ kind: 'yard', cls: 'клинок' }));
  // 128 - 3 * 32 = 32
  assert.deepEqual(pulseOrder(observe([unit('T-A1')], 128), three, focus, world), { kind: 'halt', unit: 'T-A1' });
  // 127 - 96 = 31: no halt, and no watch either
  assert.equal(pulseOrder(observe([unit('T-A1')], 127), three, focus, world), null);
  // no idle unit: a watch at exactly its price goes, one byte less does not
  assert.deepEqual(pulseOrder(observe([], 128), three, focus, world), focus);
  assert.equal(pulseOrder(observe([], 127), three, focus, world), null);
});

test('pulse respects the frame cap: floor(chanAt / 32) + 4 commands', () => {
  // chanAt 141: cap 8; with 7 head commands the pulse is the 8th, with 8 it would be the 9th
  const halts = (n) => Array.from({ length: n }, (_, i) => ({ kind: 'halt', unit: 'K-A' + (i + 10) }));
  assert.deepEqual(pulseOrder(observe([unit('T-A1')]), halts(7), focus, world), { kind: 'halt', unit: 'T-A1' });
  assert.equal(pulseOrder(observe([unit('T-A1')]), halts(8), focus, world), null);
});

test('channel estimate: halt and jam are free, a scan is paid by the ears, a storm doubles', () => {
  const orders = [
    { kind: 'halt', unit: 'T-A1' },
    { kind: 'jam', unit: 'K-A2', target: null, hold: false },
    { kind: 'scan', q: 0, r: 0, rad: 3 },
    { kind: 'move', unit: 'T-A1', q: 7, r: -12, goal: null, home: false },
  ];
  assert.equal(channelLeft(observe([unit('T-A1')]), orders, world), 109);
  // a yard is priced at the hearth, and the hearth is under the storm
  const stormy = { ...world, storms: stormOnHearth };
  assert.equal(channelLeft(observe([]), [{ kind: 'yard', cls: 'ткач' }], stormy), 141 - 64);
  // a unit command is priced at the unit's cell, far from the storm
  const far = unit('T-A1', { q: -12, r: 6 });
  assert.equal(channelLeft(observe([far]), [{ kind: 'halt', unit: 'T-A1' }, { kind: 'feed', unit: 'T-A1', q: -12, r: 6 }], stormy), 141 - 32);
});

test('costAt: a unit at its cell, watch and scan at the target, the rest at the hearth', () => {
  const obs = observe([unit('T-A1', { q: 1, r: 2 })]);
  assert.deepEqual(costAt({ kind: 'move', unit: 'T-A1', q: 9, r: 9, goal: null, home: false }, obs, hearth), { q: 1, r: 2 });
  assert.deepEqual(costAt({ kind: 'move', unit: 'T-A9', q: 9, r: 9, goal: null, home: false }, obs, hearth), hearth);
  assert.deepEqual(costAt({ kind: 'watch', q: 3, r: 4, keep: 0 }, obs, hearth), { q: 3, r: 4 });
  assert.deepEqual(costAt({ kind: 'scan', q: -3, r: 4, rad: 2 }, obs, hearth), { q: -3, r: 4 });
  assert.deepEqual(costAt({ kind: 'bid', lot: 0, amount: 60 }, obs, hearth), hearth);
});

test('verdicts of a frame with the pulse first go back to the head at its own positions', () => {
  const list = [
    [0, true, 0],
    [1, false, 11],
    [2, true, 0],
  ];
  assert.deepEqual(headVerdicts(list, true), [
    [0, false, 11],
    [1, true, 0],
  ]);
  assert.deepEqual(headVerdicts(list, false), list);
});

test('an unknown preset falls back to the default instead of crashing before the oath', () => {
  const lines = [];
  assert.equal(presetOrDefault('шир'), 'шир');
  assert.equal(presetOrDefault(undefined), DEFAULT_PRESET);
  assert.equal(presetOrDefault(''), DEFAULT_PRESET);
  assert.equal(presetOrDefault('ÑˆÐ¸Ñ€', (line) => lines.push(line)), DEFAULT_PRESET);
  assert.equal(lines.length, 1);
  assert.equal(DEFAULT_PRESET, 'рівний');
  assert.deepEqual(presets().sort(), ['облягач', 'обхідник', 'проривник', 'рівний', 'шир'].sort());
});

/* a scripted head: what it says on each tick, and what it got back */
function fakeHead(say) {
  const fed = [];
  let ticks = 0;
  return {
    fed,
    init() {},
    tick() {
      ticks += 1;
      return say(ticks);
    },
    feedback(bytes) {
      fed.push(decodeVerdicts(bytes));
    },
    mirror() {
      return null;
    },
  };
}
const silent = () => encodeOrders([]);

/* plays slot A for `ticks` ticks and returns what went on the wire and what was refused */
function play(head, ticks = 90) {
  const lines = [];
  const bot = new PulseStrategy(head, (line) => lines.push(line));
  const sent = new Map();
  const refused = new Map();
  runMatch(createEngine, {
    seed: 2026,
    ticks,
    bots: { A: bot },
    tapOrders: (t, slot, bytes) => {
      if (slot === 'A') sent.set(t, decodeOrders(bytes) ?? []);
    },
    tapDenies: (t, slot, denies) => {
      if (slot === 'A') refused.set(t, denies.filter(([, code]) => code !== 0));
    },
  });
  // the longest run of ticks without an accepted command: the nakaz takes over after 6
  let run = 0;
  let longest = 0;
  for (let t = 1; t <= ticks; t++) {
    const orders = sent.get(t) ?? [];
    const accepted = orders.length - (refused.get(t)?.length ?? 0);
    run = accepted > 0 ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  return { sent, refused, longest, lines };
}

test('a silent head keeps the slot: at most 2 quiet ticks in a row, nothing refused', () => {
  const head = fakeHead(silent);
  const { refused, longest } = play(head);
  assert.equal(longest, 2);
  assert.equal([...refused.values()].flat().length, 0);
  // the pulse verdicts are not handed to the head
  assert.ok(head.fed.every((list) => list.length === 0));
});

test('a head refused every tick keeps the slot too: the pulse goes first and is accepted', () => {
  // a focus outside the valley: the gatekeeper answers "погляд" every time
  const head = fakeHead(() => encodeOrders([{ kind: 'watch', q: 40, r: 40, keep: 0 }]));
  const { sent, refused, longest } = play(head);
  assert.equal(longest, 2);
  // in a frame with the pulse (two commands) the refusal is the head's watch at 1, never the pulse at 0
  for (const [t, orders] of sent) {
    if (orders.length === 2) assert.deepEqual((refused.get(t) ?? []).map(([i]) => i), [1], `tick ${t}`);
  }
  // the head always hears about its own command at position 0
  assert.ok(head.fed.every((list) => list.length === 1 && list[0][0] === 0 && list[0][1] === false));
  // and the refused focus never becomes the pulse focus: pulses watch the hearth
  const pulses = [...sent.values()].filter((orders) => orders.length === 2).map((orders) => orders[0]);
  assert.ok(pulses.length > 20);
  assert.ok(pulses.every((o) => o.kind === 'halt' || (o.kind === 'watch' && o.q === 6 && o.r === -12)));
});

test('a head that throws every tick keeps the slot, and the log says it once per hundred', () => {
  const head = fakeHead(() => {
    throw new Error('mirror broke');
  });
  const { longest, lines } = play(head, 150);
  assert.equal(longest, 2);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /1-й раз/);
  assert.match(lines[1], /101-й раз/);
});

test('a reply that does not decode is replaced: the node never gets the garbage', () => {
  const head = fakeHead(() => new Uint8Array([0xff, 0x00]));
  const { sent, longest } = play(head, 30);
  assert.equal(longest, 2);
  assert.ok([...sent.values()].every((orders) => orders.every((o) => o.kind === 'halt' || o.kind === 'watch')));
});

test('an accepted command resets the count: no pulse for the next two ticks', () => {
  // the head speaks on ticks 3, 10 and 20, silent otherwise
  const head = fakeHead((n) => (n === 3 || n === 10 || n === 20 ? encodeOrders([{ kind: 'watch', q: 6, r: -12, keep: 0 }]) : encodeOrders([])));
  const { sent } = play(head, 25);
  const kinds = (t) => (sent.get(t) ?? []).length;
  // ticks 1-2 quiet, pulse on 3 goes first next to the head's watch
  assert.equal(kinds(1), 0);
  assert.equal(kinds(2), 0);
  assert.equal(kinds(3), 2);
  // accepted on 3: ticks 4 and 5 stay silent, the pulse returns on 6
  assert.equal(kinds(4), 0);
  assert.equal(kinds(5), 0);
  assert.equal(kinds(6), 1);
});

test('the strategy survives a head whose feedback throws', () => {
  const lines = [];
  const bot = new PulseStrategy(
    {
      init() {},
      tick: () => encodeOrders([]),
      feedback() {
        throw new Error('feedback broke');
      },
      mirror: () => null,
    },
    (line) => lines.push(line),
  );
  bot.feedback(encodeVerdicts([[0, true, 0]]));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /feedback/);
  // a belief without a mirror is null, and a reset without a slot does nothing
  assert.equal(bot.belief(null), null);
  bot.resetBelief();
});
