// Frame vetting and the 02.10 review fixes: empty commands, scan without ears, refused sites,
// the head's idle pair for hunt, cherta leaving the line, start needles by slot, mirror sync.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { runMatch } from '@zoria/sdk';
import { decodeOrders } from '@zoria/protocol';
import { createStrategy, DEFAULT_TACTICS, NO_TACTICS, parseTactics } from '../dist/strategy.js';
import { AfterHead, hexDist, hexRing, NeedleOwners } from '../dist/tactics.js';

const cfg = {
  upFloor: 96, downFloor: 1024, relayUp: 24, relayDown: 192, netK: 8, chanOrder: 32, chanTick: 32, scanCost: 256, scanRad: 3, watchByte: 7, stormCost: 2,
  heatNeedle: 8, heatDark: 16, heatEnemy: 24, autonomy: 40, stepTkach: 2, stepKlinok: 1, capGrace: 60, weightTkach: 2, weightKlinok: 1, squadWeight: 8, droneBuild: 4,
};
const world = { cfg, storms: [], hearth: { q: 12, r: 0 } };
const needles = [
  { q: 10, r: 0, start: null, ring: false, spoke: false },
  { q: 10, r: 4, start: null, ring: false, spoke: false },
  { q: 8, r: 6, start: 'A', ring: false, spoke: false },
  { q: 3, r: 0, start: null, ring: true, spoke: false },
  { q: 0, r: 4, start: null, ring: false, spoke: false },
];
const man = { needles, cfg, citadel: { q: 0, r: 0 }, cherta: 6, finds: [{ kind: 'flare', q: 14, r: 2 }], perm: ['A', 'B', 'C'] };
const task = { goal: null, site: null, feed: null, jam: null, ram: null, home: false, path: 3 };
const unit = (id, cls, q, r, extra = {}) => ({ id, cls, q, r, mute: false, stuck: false, wait: 0, work: 0, away: 0, task: null, ...extra });
const foe = (id, p, q, r) => ({ id, p, cls: 'ткач', q, r });
const observe = (t, { units = [], foes = [], mine = [], own = [], jams = [], ear = 1400, events = [], chan = 141 } = {}) => ({
  t,
  pulse: { energy: 100, chan, chanAt: chan, ear, earAt: 1400, minutes: 0, needles: 2, mercy: false },
  mine: { needles: mine.map(([q, r]) => ({ q, r, dark: false, fed: false, weight: 1 })), units, jams, losts: [], order: null, pact: {}, ledger: {} },
  own: own.map(([q, r, owner]) => ({ q, r, owner, dark: false })),
  foe: foes,
  noisy: [],
  pub: { pact: { active: [] }, dawn: false },
  events,
});
const head = (order, at = 0) => ({ order, from: 'head', at });
const after = (spec, pathOk = () => false) => new AfterHead({ ...NO_TACTICS, ...parseTactics(spec) }, man, 'A', world, () => false, pathOk);
const kinds = (out) => out.map((e) => e.order.kind + ':' + (e.order.unit ?? ''));

test('vet drops the head idle pair and lone empty halts, keeps everything that changes the world', () => {
  const a = after('nohook');
  const units = [unit('K-A1', 'клинок', 12, 1), unit('T-A2', 'ткач', 12, 2), unit('T-A3', 'ткач', 12, 3, { task }), unit('K-A4', 'клинок', 12, 4, { task: { ...task, jam: { q: 10, r: 4 } } })];
  const obs = observe(100, { units });
  a.see(obs);
  const frame = [
    head({ kind: 'jam', unit: 'K-A1', target: null, hold: false }, 0),
    head({ kind: 'halt', unit: 'K-A1' }, 1),
    head({ kind: 'halt', unit: 'T-A2' }, 2),
    head({ kind: 'halt', unit: 'T-A3' }, 3), // has a task: halt clears it
    head({ kind: 'jam', unit: 'K-A4', target: null, hold: false }, 4), // has an intent: jam(null) clears it
    head({ kind: 'yard', cls: 'ткач' }, 5),
  ];
  const out = a.vet(obs, frame, 0);
  assert.deepEqual(kinds(out), ['halt:T-A3', 'jam:K-A4', 'yard:']);
  // positions stay with their entries
  assert.deepEqual(out.map((e) => e.at), [3, 4, 5]);
  // an empty halt next to a real order for the same unit is kept with it
  assert.equal(a.vet(obs, [head({ kind: 'halt', unit: 'T-A2' }), head({ kind: 'move', unit: 'T-A2', q: 1, r: 1, goal: null, home: false }, 1)], 0).length, 2);
});

test('vet drops a scan the ears cannot pay unless a flare token pays it, and a needle on a refused site', () => {
  const a = after('nohook');
  const scan = head({ kind: 'scan', q: 10, r: 0, rad: 2 });
  let obs = observe(100, { ear: 255 });
  a.see(obs);
  assert.equal(a.vet(obs, [scan], 0).length, 0);
  assert.equal(a.vet(obs, [scan], 1).length, 1, 'a flare token makes it free');
  obs = observe(101, { ear: 256 });
  a.see(obs);
  assert.equal(a.vet(obs, [scan], 0).length, 1);
  const needle = head({ kind: 'needle', unit: 'T-A2', q: 9, r: 2 });
  assert.equal(a.vet(obs, [needle], 0).length, 1);
  a.verdicts([needle], [[0, false, 11]]);
  assert.equal(a.vet(obs, [needle], 0).length, 0, 'the refused site is remembered');
  assert.equal(a.vet(obs, [head({ kind: 'needle', unit: 'T-A2', q: 9, r: 3 })], 0).length, 1);
});

test('syncMirror writes taken finds into the mirror world and refused sites into the head site cache', () => {
  const a = after('nohook');
  const obs = observe(200, { events: [{ type: 'find', p: 'C', q: 14, r: 2, find: 'flare' }] });
  a.see(obs);
  a.verdicts([head({ kind: 'needle', unit: 'T-A2', q: 9, r: 2 })], [[0, false, 11]]);
  const E = { SIM: { world: {} }, BOT_SITES: { A: { refused: {} } } };
  a.syncMirror(E);
  assert.deepEqual(E.SIM.world.find, { '14,2': { p: 'C', t: 200 } });
  assert.deepEqual(E.BOT_SITES.A.refused, { '9,2': 1 });
  a.syncMirror(null);
});

test('hunt takes a sentry Klinok the head holds with the jam(null) + halt pair', () => {
  const a = after('hunt:6');
  const opts = { units: [unit('K-A1', 'клинок', 10, 3)], foes: [foe('T-B1', 'B', 10, 0)], mine: [[10, 0]] };
  for (let t = 100; t <= 103; t++) a.see(observe(t, opts));
  const pair = [head({ kind: 'jam', unit: 'K-A1', target: null, hold: false }, 0), head({ kind: 'halt', unit: 'K-A1' }, 1)];
  assert.deepEqual(a.apply(observe(103, opts), pair).map((e) => e.order), [{ kind: 'ram', unit: 'K-A1', target: 'T-B1' }]);
});

test('hunt calls off a chase only between steps: mid-step it waits and keeps the chase', () => {
  const a = after('hunt:6');
  const at = (t, extra = {}, fq = 10) => ({ units: [unit('K-A1', 'клинок', 10, 3, extra)], foes: [foe('T-B1', 'B', fq, 0)], mine: [[10, 0]] });
  for (let t = 100; t <= 103; t++) a.see(observe(t, at(t)));
  assert.equal(a.apply(observe(103, at(103)), [])[0].order.kind, 'ram');
  const chasing = { task: { ...task, ram: 'T-B1' } };
  let obs = observe(104, at(104, { ...chasing, wait: 1 }, 11));
  a.see(obs);
  assert.deepEqual(a.apply(obs, []), [], 'mid-step: no halt, the chase stays remembered');
  obs = observe(105, at(105, chasing, 11));
  a.see(obs);
  assert.deepEqual(a.apply(obs, []).map((e) => e.order), [{ kind: 'halt', unit: 'K-A1' }]);
});

test('cherta walks out of the line a Klinok by a ring needle under our live jam, and a Tkach standing on a needle inside', () => {
  const a = after('cherta', () => true);
  const out1 = hexRing({ q: 0, r: 0 }, 7);
  // Klinok at (4,0) next to the ring needle (3,0) with our jam alive till 520
  let obs = observe(500, { units: [unit('K-A1', 'клинок', 4, 0)], jams: [{ q: 3, r: 0, until: 520 }] });
  a.see(obs);
  let out = a.apply(obs, [head({ kind: 'jam', unit: 'K-A1', target: { q: 3, r: 0 }, hold: false })]);
  assert.equal(out.length, 1);
  assert.equal(out[0].order.kind, 'move');
  assert.ok(out1.some((c) => c.q === out[0].order.q && c.r === out[0].order.r), 'a cell at 7 from the citadel');
  assert.equal(hexDist(out[0].order, { q: 4, r: 0 }), 3, 'the nearest one');
  // mid-step: jam(null), accepted mid-step and not extending the jam
  obs = observe(501, { units: [unit('K-A1', 'клинок', 4, 0, { wait: 1 })], jams: [{ q: 3, r: 0, until: 520 }] });
  a.see(obs);
  assert.deepEqual(a.apply(obs, []).map((e) => e.order), [{ kind: 'jam', unit: 'K-A1', target: null, hold: false }]);
  // the jam is gone: nothing to do
  obs = observe(530, { units: [unit('K-A1', 'клинок', 4, 0)], jams: [{ q: 3, r: 0, until: 520 }] });
  a.see(obs);
  assert.deepEqual(a.apply(obs, []), []);
  // a Tkach standing on the ruin (0,4) inside the line heats it with or without a task: out
  obs = observe(540, { units: [unit('T-A2', 'ткач', 0, 4)] });
  a.see(obs);
  out = a.apply(obs, []);
  assert.equal(out[0].order.kind, 'move');
  // no path out known (no mirror): nothing is sent
  const blind = after('cherta');
  blind.see(obs);
  assert.deepEqual(blind.apply(obs, []), []);
});

test('start needles belong to the slot that sits at that seat', () => {
  const owners = new NeedleOwners(needles, ['B', 'C', 'A']);
  assert.equal(owners.at({ q: 8, r: 6 }), 'B');
  assert.equal(new NeedleOwners(needles).at({ q: 8, r: 6 }), 'A');
  assert.equal(owners.at({ q: 3, r: 0 }), 'K');
});

test('the battle config in a match: no refusals, no idle pairs on the wire, no goal past the line before dawn', () => {
  const bot = createStrategy('полудень', () => undefined, parseTactics(DEFAULT_TACTICS));
  let refused = 0;
  let pairs = 0;
  let inside = 0;
  runMatch(createEngine, {
    seed: 2026,
    ticks: 1000,
    bots: { A: bot },
    tapOrders: (_t, slot, bytes) => {
      if (slot !== 'A') return;
      const orders = decodeOrders(bytes) ?? [];
      const beforeDawn = !bot['head'].mirror().SIM.world.dawn;
      const units = new Map();
      for (const o of orders) if ('unit' in o) units.set(o.unit, [...(units.get(o.unit) ?? []), o.kind]);
      for (const ks of units.values()) if (ks.includes('jam') && ks.includes('halt') && ks.length === 2) pairs++;
      for (const o of orders) if (beforeDawn && o.kind === 'move' && o.goal && hexDist(o.goal, { q: 0, r: 0 }) <= 6) inside++;
    },
    tapDenies: (_t, slot, denies) => {
      if (slot === 'A') refused += denies.filter(([, code]) => code !== 0).length;
    },
  });
  assert.equal(refused, 0);
  assert.equal(inside, 0);
  assert.ok(pairs < 20, 'idle pairs on the wire: ' + pairs);
});
