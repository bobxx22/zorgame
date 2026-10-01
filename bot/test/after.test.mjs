// Tactics with memory after the head: cherta, stay, hunt (ram v2), yardcap, refused rams.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { runMatch } from '@zoria/sdk';
import { decodeOrders } from '@zoria/protocol';
import { createStrategy, NO_TACTICS, parseTactics } from '../dist/strategy.js';
import { AfterHead, hexDist, hookHead } from '../dist/tactics.js';

const cfg = {
  upFloor: 96, downFloor: 1024, relayUp: 24, relayDown: 192, netK: 8, chanOrder: 32, chanTick: 32, scanCost: 256, scanRad: 3, watchByte: 7, stormCost: 2,
  heatNeedle: 8, heatDark: 16, heatEnemy: 24, autonomy: 40, stepTkach: 2, stepKlinok: 1, capGrace: 60, weightTkach: 2, weightKlinok: 1, squadWeight: 8, droneBuild: 4,
};
const world = { cfg, storms: [], hearth: { q: 12, r: 0 } };
// needles: ours-to-be at (10,0) and (10,2), B's captured at (10,4), a ruin at (14,0), a start of C at (8,6), a ring needle at (3,0), a ruin inside the line at (0,4)
const needles = [
  { q: 10, r: 0, start: null, ring: false, spoke: false },
  { q: 10, r: 2, start: null, ring: false, spoke: false },
  { q: 10, r: 4, start: null, ring: false, spoke: false },
  { q: 14, r: 0, start: null, ring: false, spoke: false },
  { q: 8, r: 6, start: 'C', ring: false, spoke: false },
  { q: 3, r: 0, start: null, ring: true, spoke: false },
  { q: 0, r: 4, start: null, ring: false, spoke: false },
];
const man = { needles, cfg, citadel: { q: 0, r: 0 }, cherta: 6 };
const task = { goal: null, site: null, feed: null, jam: null, ram: null, home: false, path: 3 };
const unit = (id, cls, q, r, extra = {}) => ({ id, cls, q, r, mute: false, stuck: false, wait: 0, work: 0, away: 0, task: null, ...extra });
const foe = (id, p, q, r, cls = 'ткач') => ({ id, p, cls, q, r });
const observe = (t, { units = [], foes = [], mine = [], own = [], pact = [], dawn = false, mercy = false, chan = 141 } = {}) => ({
  t,
  pulse: { energy: 100, chan, chanAt: chan, ear: 1400, earAt: 1400, minutes: 0, needles: 2, mercy },
  mine: { needles: mine.map(([q, r]) => ({ q, r, dark: false, fed: false, weight: 1 })), units, jams: [], losts: [], order: null, pact: {}, ledger: {} },
  own: own.map(([q, r, owner, dark = false]) => ({ q, r, owner, dark })),
  foe: foes,
  noisy: [],
  pub: { pact: { active: pact }, dawn },
  events: [],
});
const after = (spec, links = () => false) => new AfterHead({ ...NO_TACTICS, ...parseTactics(spec) }, man, 'A', world, links);
const head = (order, at = 0) => ({ order, from: 'head', at });
const home = (id) => head({ kind: 'move', unit: id, q: 12, r: 0, goal: null, home: true });

test('the new tokens parse with bounds', () => {
  assert.deepEqual(parseTactics('cherta,stay:6,hunt:5,yardcap'), { ...NO_TACTICS, cherta: true, stay: 6, hunt: 5, yardCap: true });
  const lines = [];
  assert.deepEqual(parseTactics('cherta:1,stay,stay:25,hunt:13,yardcap:2', (l) => lines.push(l)), NO_TACTICS);
  assert.equal(lines.length, 5);
});

test('cherta hides needles inside the line from belief only while the head decides, before dawn and without mercy', () => {
  const NEEDLES = needles.map((n) => ({ ...n, key: n.q + ',' + n.r }));
  let during = null;
  const E = { BOT_STYLE: { A: { klinok: 0.5 } }, SIM: { t: 100 }, NEEDLES, CHERTA_R: 6, botOrders: (p, w) => (during = Object.keys(w.bel.A.at).sort()) };
  hookHead(E, 'A', { ...NO_TACTICS, cherta: true }, () => undefined);
  const at = { '3,0': 1, '0,4': 1, '10,0': 1, '14,0': 1 };
  const w = { lit: {}, fed: {}, own: {}, bel: { A: { at } } };
  E.botOrders('A', w);
  assert.deepEqual(during, ['10,0', '14,0']);
  assert.deepEqual(Object.keys(at).sort(), ['0,4', '10,0', '14,0', '3,0']);
  // our own needle inside the line stays visible
  E.botOrders('A', { ...w, own: { '0,4': 'A' } });
  assert.deepEqual(during, ['0,4', '10,0', '14,0']);
  for (const extra of [{ dawn: 1000 }, { keep: { mercy: { A: 1 } } }]) {
    E.botOrders('A', { ...w, ...extra });
    assert.equal(during.length, 4, JSON.stringify(extra));
  }
});

test('cherta after the head: a Tkach heading inside the line is halted, a Klinok jamming the ring from inside gets no target', () => {
  const a = after('cherta');
  const units = [unit('T-A1', 'ткач', 5, 0, { task: { ...task, goal: { q: 3, r: 0 } } }), unit('K-A2', 'клинок', 4, 0)];
  const obs = observe(500, { units });
  a.see(obs);
  const out = a.apply(obs, [head({ kind: 'jam', unit: 'K-A2', target: { q: 3, r: 0 }, hold: false })]);
  assert.deepEqual(
    out.map((e) => e.order),
    [{ kind: 'jam', unit: 'K-A2', target: null, hold: false }, { kind: 'halt', unit: 'T-A1' }],
  );
  // after dawn nothing changes
  const dawn = observe(1001, { units, dawn: true });
  a.see(dawn);
  assert.equal(a.apply(dawn, [head({ kind: 'jam', unit: 'K-A2', target: { q: 3, r: 0 }, hold: false })])[0].order.target.q, 3);
});

test('stay keeps a Tkach on a foreign needle a few ticks from capture, within the leash', () => {
  const run = (spec, opts, ticks, links) => {
    const a = after(spec, links);
    let obs;
    for (let t = 1; t <= ticks; t++) {
      obs = observe(t, opts(t));
      a.see(obs);
    }
    return a.apply(obs, [home('T-A1')]).length;
  };
  const onB = (away) => () => ({ units: [unit('T-A1', 'ткач', 10, 4, { away })], own: [[10, 4, 'B']] });
  assert.equal(run('stay:3', onB(20), 22, () => false), 0, '2 ticks left, 20 away + 2 + 6 + 4 <= 40');
  assert.equal(run('stay:3', onB(20), 20, () => false), 1, '4 ticks left > K');
  assert.equal(run('stay:3', onB(30), 22, () => false), 1, 'the leash would not hold without a link');
  assert.equal(run('stay:3', onB(30), 22, () => true), 0, 'a link back makes it safe');
  // an own needle, a start needle and a needle inside the line before dawn are never held
  assert.equal(run('stay:3', () => ({ units: [unit('T-A1', 'ткач', 10, 0)], mine: [[10, 0]] }), 22, () => true), 1);
  assert.equal(run('stay:3', () => ({ units: [unit('T-A1', 'ткач', 8, 6)], own: [[8, 6, 'C']] }), 22, () => true), 1);
  assert.equal(run('stay:3', () => ({ units: [unit('T-A1', 'ткач', 0, 4)] }), 6, () => true), 1);
  // a ruin is 8 ticks
  assert.equal(run('stay:3', () => ({ units: [unit('T-A1', 'ткач', 14, 0, { away: 10 })] }), 6, () => false), 0);
  // without the tactic the recall goes through
  assert.equal(run('cherta', onB(20), 22, () => false), 1);
});

test('hunt: a Klinok with only an empty jam from the head rams a Tkach heating our needle; the jam leaves the frame', () => {
  const a = after('hunt:6');
  const opts = { units: [unit('K-A1', 'клинок', 10, 3)], foes: [foe('T-B1', 'B', 10, 0)], mine: [[10, 0]] };
  // our needle since the start: no grace; the prey must stand 3 ticks
  for (let t = 100; t <= 102; t++) a.see(observe(t, opts));
  const empty = head({ kind: 'jam', unit: 'K-A1', target: null, hold: false });
  assert.deepEqual(a.apply(observe(102, opts), [empty]).map((e) => e.order), [empty.order]);
  const obs = observe(103, opts);
  a.see(obs);
  assert.deepEqual(a.apply(obs, [empty]).map((e) => e.order), [{ kind: 'ram', unit: 'K-A1', target: 'T-B1' }]);
});

test('hunt skips our needle in its capture grace, a hunter on the leash, a busy Klinok and a hopeless chase', () => {
  const run = (opts, ticks, entries = []) => {
    const a = after('hunt:6');
    let obs;
    for (let t = 0; t < ticks.length; t++) {
      obs = observe(ticks[t], opts(ticks[t]));
      a.see(obs);
    }
    return a.apply(obs, entries).map((e) => e.order.kind);
  };
  const base = (extra = {}) => () => ({ units: [unit('K-A1', 'клинок', 10, 3, extra)], foes: [foe('T-B1', 'B', 10, 0)], mine: [[10, 0]] });
  assert.deepEqual(run(base(), [100, 101, 102, 103]), ['ram']);
  // (10,0) became ours at tick 101: grace until 161
  const late = (t) => ({ units: [unit('K-A1', 'клинок', 10, 3)], foes: [foe('T-B1', 'B', 10, 0)], mine: t >= 101 ? [[10, 0]] : [], own: t < 101 ? [[10, 0, 'C']] : [] });
  assert.deepEqual(run(late, [100, 101, 102, 103, 104]), []);
  // the grace ends at 161: heating starts then, and after 3 ticks of it the Klinok goes
  assert.deepEqual(run(late, [100, 101, 160, 161, 162, 163]), []);
  assert.deepEqual(run(late, [100, 101, 160, 161, 162, 163, 164]), ['ram']);
  assert.deepEqual(run(base({ away: 3 }), [100, 101, 102, 103]), []);
  assert.deepEqual(run(base(), [100, 101, 102, 103], [head({ kind: 'move', unit: 'K-A1', q: 1, r: 1, goal: null, home: false })]), ['move']);
  assert.deepEqual(run(base(), [100, 101, 102, 103], [head({ kind: 'jam', unit: 'K-A1', target: null, hold: true })]), ['jam']);
  // a Tkach standing 22 of 24 ticks: a Klinok 3 steps away does not make it
  assert.deepEqual(run(base(), Array.from({ length: 23 }, (_, i) => 100 + i)), []);
  // a siege holder goes only for prey on our needle within 3
  const holder = { task: { ...task, jam: { q: 9, r: 9 }, path: 0 } };
  assert.deepEqual(run(base(holder), [100, 101, 102, 103]), ['ram']);
  const far = () => ({ units: [unit('K-A1', 'клинок', 10, 4, holder)], foes: [foe('T-B1', 'B', 14, 0)] });
  assert.deepEqual(run(far, [100, 101, 102, 103]), []);
});

test('hunt calls off its own chase when the prey leaves the needle', () => {
  const a = after('hunt:6');
  const opts = (t) => ({ units: [unit('K-A1', 'клинок', 10, 3, t > 103 ? { task: { ...task, ram: 'T-B1' } } : {})], foes: [foe('T-B1', 'B', t > 104 ? 11 : 10, 0)], mine: [[10, 0]] });
  let obs;
  for (let t = 100; t <= 103; t++) {
    obs = observe(t, opts(t));
    a.see(obs);
  }
  assert.deepEqual(a.apply(obs, []).map((e) => e.order.kind), ['ram']);
  obs = observe(104, opts(104));
  a.see(obs);
  assert.deepEqual(a.apply(obs, []), []);
  obs = observe(105, opts(105));
  a.see(obs);
  assert.deepEqual(a.apply(obs, []).map((e) => e.order), [{ kind: 'halt', unit: 'K-A1' }]);
});

test('a refused ram is not repeated for 15 ticks', () => {
  const a = after('hunt:6');
  const opts = { units: [unit('K-A1', 'клинок', 10, 3)], foes: [foe('T-B1', 'B', 10, 0)], mine: [[10, 0]] };
  for (let t = 100; t <= 103; t++) a.see(observe(t, opts));
  const sent = a.apply(observe(103, opts), []);
  a.verdicts(sent, [[0, false, 5]]);
  for (const t of [104, 118]) {
    a.see(observe(t, opts));
    assert.deepEqual(a.apply(observe(t, opts), []), [], String(t));
  }
  a.see(observe(119, opts));
  assert.equal(a.apply(observe(119, opts), []).length, 1);
  assert.equal(a.refused('K-A1', 'T-B1'), false);
});

test('yardcap drops an order over the swarm weight, counting hulls in the yard queue', () => {
  const a = after('yardcap');
  const units = [unit('T-A1', 'ткач', 12, 0), unit('T-A2', 'ткач', 12, 1), unit('K-A3', 'клинок', 12, 2)]; // weight 5
  let obs = observe(200, { units });
  a.see(obs);
  const orders = (out) => out.map((e) => e.order.cls);
  assert.deepEqual(orders(a.apply(obs, [head({ kind: 'yard', cls: 'ткач' }), head({ kind: 'yard', cls: 'ткач' }, 1), head({ kind: 'yard', cls: 'клинок' }, 2)])), ['ткач', 'клинок']);
  const sent = a.apply(obs, [head({ kind: 'yard', cls: 'ткач' })]);
  a.verdicts(sent, [[0, true, 0]]);
  // 5 on the field + 2 in the queue: a Tkach no longer fits, a Klinok does
  obs = observe(202, { units });
  a.see(obs);
  assert.deepEqual(orders(a.apply(obs, [head({ kind: 'yard', cls: 'ткач' }), head({ kind: 'yard', cls: 'клинок' }, 1)])), ['клинок']);
  // after droneBuild ticks the hull is on the field, not in the queue
  obs = observe(205, { units: [...units, unit('T-A4', 'ткач', 12, 3)] });
  a.see(obs);
  assert.deepEqual(orders(a.apply(obs, [head({ kind: 'yard', cls: 'клинок' })])), ['клинок']);
  assert.deepEqual(orders(a.apply(obs, [head({ kind: 'yard', cls: 'ткач' })])), []);
});

test('in a match the full set brings no refusals, no goal inside the line before dawn, and the hunt does ram', () => {
  const bot = createStrategy('полудень', () => undefined, parseTactics('fill:наш:6,nofeed:1200,cherta,stay:6,hunt:6,yardcap'));
  let refused = 0;
  let inside = 0;
  let hunts = 0;
  runMatch(createEngine, {
    seed: 2026,
    ticks: 1000,
    bots: { A: bot },
    tapOrders: (t, slot, bytes) => {
      if (slot !== 'A') return;
      const orders = decodeOrders(bytes) ?? [];
      // dawn scales with the match length: read it from the mirror's world, not from tick 1000
      const beforeDawn = !bot['head'].mirror().SIM.world.dawn;
      orders.forEach((o, i) => {
        if (beforeDawn && o.kind === 'move' && o.goal && hexDist(o.goal, { q: 0, r: 0 }) <= 6) inside++;
        if (o.kind === 'ram' && bot.lastSources[i] === 'tactic') hunts++;
      });
    },
    tapDenies: (_t, slot, denies) => {
      if (slot === 'A') refused += denies.filter(([, code]) => code !== 0).length;
    },
  });
  assert.equal(refused, 0);
  assert.equal(inside, 0);
  assert.ok(hunts > 0, 'hunt rams ' + hunts);
});

test('engine knobs parse with bounds and land in the mirror SIM_CFG only', () => {
  assert.deepEqual(parseTactics('gap:45,catch:0.03,bopen:2,rfloor:0.2').engine, { guardGap: 45, catchFloor: 0.03, buildOpen: 2, raidFloor: 0.2 });
  const lines = [];
  assert.deepEqual(parseTactics('gap:0,gap:4.5,catch:2,bopen:x,rfloor,gap:45:1', (l) => lines.push(l)).engine, {});
  assert.equal(lines.length, 6);
  const E = { BOT_STYLE: { A: { klinok: 0.5 } }, SIM: { t: 0 }, SIM_CFG: { guardGap: 90, catchFloor: 0.01 }, botOrders: () => undefined };
  const botOrders = E.botOrders;
  hookHead(E, 'A', parseTactics('gap:45,catch:0.03'), () => undefined);
  assert.deepEqual(E.SIM_CFG, { guardGap: 45, catchFloor: 0.03 });
  // knobs alone do not wrap the head
  assert.equal(E.botOrders, botOrders);
});
