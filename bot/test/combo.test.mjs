// сплав: two heads in one seat - the economy's Tkach and unit-less orders, the Klinok head's Klinok orders, under our pulse.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { openMatch } from '@zoria/sdk';
import { decodeObserve, decodeOrders, decodeVerdicts, encodeObserve, encodeOrders, encodeVerdicts } from '@zoria/protocol';
import { ComboHead, ComboStrategy } from '../dist/combo.js';
import { createStrategy, DEFAULT_PRESET, isPreset, presetOrDefault, presets, PulseStrategy } from '../dist/strategy.js';

/* a real manifest and a real first observe frame of seat A */
function firstFrame() {
  let observe = null;
  const spy = { init: () => undefined, tick: (bytes) => ((observe ??= bytes), new Uint8Array(0)) };
  const match = openMatch(createEngine, { seed: 5, ticks: 60, bots: { A: spy } });
  match.step();
  return { manifest: match.manifest, observe };
}

/* a head that says the given orders and remembers its verdicts */
function stub(orders) {
  const got = [];
  return { got, init: () => undefined, tick: () => encodeOrders(orders), feedback: (bytes) => got.push(...(decodeVerdicts(bytes) ?? [])), belief: () => null, resetBelief: () => undefined };
}

test('сплав is the battle preset; the mirror head styles stay', () => {
  assert.equal(DEFAULT_PRESET, 'сплав');
  assert.equal(presets()[0], 'сплав');
  assert.ok(isPreset('сплав'));
  assert.equal(presetOrDefault(''), 'сплав');
  assert.ok(createStrategy('') instanceof ComboStrategy);
  assert.ok(createStrategy('полудень') instanceof PulseStrategy);
});

test('the frame: Klinok rams first, then the economy without its Klinok orders, then the other Klinok orders; verdicts go back under each head\'s numbers', () => {
  const { manifest, observe } = firstFrame();
  const obs = decodeObserve(observe);
  const unit = (id, cls) => ({ id, cls, q: 6, r: -12, mute: false, stuck: false, wait: 0, work: 0, away: 0, task: null });
  const frame = encodeObserve({ ...obs, pulse: { ...obs.pulse, chan: 2000, chanAt: 2000 }, mine: { ...obs.mine, units: [unit('T-A1', 'ткач'), unit('K-A2', 'клинок')] } });
  const economy = stub([
    { kind: 'move', unit: 'T-A1', q: 5, r: -10, goal: { q: 5, r: -10 }, home: false },
    { kind: 'move', unit: 'K-A2', q: 4, r: -9, goal: null, home: false },
    { kind: 'yard', cls: 'ткач' },
  ]);
  const blades = stub([
    { kind: 'move', unit: 'T-A1', q: 7, r: -12, goal: null, home: false },
    { kind: 'jam', unit: 'K-A2', target: null, hold: false },
    { kind: 'ram', unit: 'K-A2', target: 'T-B1' },
  ]);
  const head = new ComboHead(economy, blades);
  head.init(manifest, 'A');
  const sent = decodeOrders(head.tick(frame));
  assert.deepEqual(
    sent.map((o) => o.kind + ':' + (o.unit ?? o.cls)),
    ['ram:K-A2', 'move:T-A1', 'yard:ткач', 'jam:K-A2'],
  );
  head.feedback(encodeVerdicts([[0, true, 0], [1, false, 12], [2, true, 0], [3, true, 0]]));
  assert.deepEqual(economy.got, [[0, false, 12], [2, true, 0]]);
  assert.deepEqual(blades.got, [[2, true, 0], [1, true, 0]]);
});

test('a short match: сплав sends a well-formed frame every tick, keeps the slot and writes a belief diary', () => {
  const combo = createStrategy('сплав');
  let orders = 0;
  let denied = 0;
  let lastObserve = null;
  const seat = {
    init: (m, s) => combo.init(m, s),
    tick: (bytes) => {
      lastObserve = bytes;
      return combo.tick(bytes);
    },
    feedback: (v) => combo.feedback(v),
  };
  const match = openMatch(createEngine, {
    seed: 77,
    ticks: 150,
    bots: { A: seat },
    tapOrders: (_t, slot, bytes) => {
      if (slot === 'A') orders += decodeOrders(bytes)?.length ?? 0;
    },
    tapDenies: (_t, slot, denies) => {
      if (slot === 'A') denied += denies.length;
    },
  });
  while (!match.done()) match.step();
  const summary = match.summary();
  assert.equal(summary.garbage.A, 0);
  assert.ok(orders > 30, 'orders ' + orders);
  assert.ok(denied <= 3, 'denied ' + denied);
  assert.ok(summary.needles.A > 2, 'needles ' + summary.needles.A);
  const belief = combo.belief(decodeObserve(lastObserve));
  assert.ok(belief && belief.t === 150 && belief.pulse, JSON.stringify(belief));
});

test('the battle сплав remembers deadly roads; the knob parses only within its bounds', async () => {
  const { comboParts, COMBO_ECONOMY } = await import('../dist/strategy.js');
  const { economyParams } = await import('../dist/combo/economy.js');
  assert.equal(COMBO_ECONOMY, 'roads=480');
  assert.deepEqual(comboParts('сплав'), { economy: 'roads=480', blades: '' });
  assert.deepEqual(comboParts('сплав::'), { economy: '', blades: '' });
  assert.equal(economyParams('roads=480')?.roads, 480);
  assert.equal(economyParams('')?.roads, 0);
  assert.equal(economyParams('roads=1201'), null);
  assert.equal(economyParams('roads=2.5'), null);
});
