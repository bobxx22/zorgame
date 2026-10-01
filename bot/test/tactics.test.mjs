// Tactics inside and after the head: nofeed, k0 and the clean ram.
// Unit checks on doubles and an in-process match with the real mirror head.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { runMatch } from '@zoria/sdk';
import { decodeOrders } from '@zoria/protocol';
import { createStrategy, isPreset, NO_TACTICS, parseTactics, presetOrDefault } from '../dist/strategy.js';
import { hexDist, hookHead, NeedleOwners, ramOrder } from '../dist/tactics.js';

const cfg = { upFloor: 96, downFloor: 1024, relayUp: 24, relayDown: 192, netK: 8, chanOrder: 32, chanTick: 32, scanCost: 256, scanRad: 3, watchByte: 7, stormCost: 2 };
const world = { cfg, storms: [], hearth: { q: 6, r: -12 } };
const task = { goal: null, site: null, feed: null, jam: null, ram: null, home: false, path: 3 };
const klinok = (id, q, r, extra = {}) => ({ id, cls: 'клинок', q, r, mute: false, stuck: false, wait: 0, work: 0, away: 0, task: null, ...extra });
const foe = (id, p, q, r, cls = 'ткач') => ({ id, p, cls, q, r });
const observe = ({ units = [], foes = [], mine = [], own = [], pact = [], chan = 141 } = {}) => ({
  t: 300,
  pulse: { energy: 100, chan, chanAt: chan, ear: 1400, earAt: 1400, minutes: 0, needles: 2, mercy: false },
  mine: { needles: mine.map(([q, r]) => ({ q, r, dark: false, fed: false, weight: 1 })), units, jams: [], losts: [], order: null, pact: {}, ledger: {} },
  own: own.map(([q, r, owner]) => ({ q, r, owner, dark: false })),
  foe: foes,
  noisy: [],
  pub: { pact: { active: pact } },
  events: [],
});
// needles of the valley: ours at (0,0), a ruin at (4,0), B's at (0,4), a ring needle at (2,2)
const valley = [
  { q: 0, r: 0, start: null, ring: false, spoke: false },
  { q: 4, r: 0, start: null, ring: false, spoke: false },
  { q: 0, r: 4, start: 'B', ring: false, spoke: false },
  { q: 2, r: 2, start: null, ring: true, spoke: false },
];
function ownersOf(obs) {
  const owners = new NeedleOwners(valley);
  owners.see(obs, 'A');
  return owners;
}
const ram = (obs, R = 6, orders = []) => ramOrder(obs, orders, 'A', ownersOf(obs), R, world);

test('new tactics parse with bounds; anything out of bounds is logged and skipped', () => {
  assert.deepEqual(parseTactics('nofeed:600,k0:400,ram:6'), { ...NO_TACTICS, noFeed: 600, k0: 400, ram: 6 });
  assert.deepEqual(parseTactics('nofeed:1200,ram:12,k0:1'), { ...NO_TACTICS, noFeed: 1200, k0: 1, ram: 12 });
  const lines = [];
  assert.deepEqual(parseTactics('nofeed,nofeed:0,nofeed:1201,k0:x,ram:13,ram:0,ram:6:1,k0:4.5', (l) => lines.push(l)), NO_TACTICS);
  assert.equal(lines.length, 8);
});

test('hookHead: k0 keeps the yard off Klinoks until T, then gives back the style value', () => {
  const seen = [];
  const E = { BOT_STYLE: { A: { klinok: 0.5 } }, SIM: { t: 0 }, botOrders: () => seen.push(E.BOT_STYLE.A.klinok) };
  hookHead(E, 'A', { ...NO_TACTICS, k0: 300 }, () => undefined);
  for (const t of [1, 299, 300, 900]) {
    E.SIM.t = t;
    E.botOrders('A', {});
  }
  assert.deepEqual(seen, [0, 0, 0.5, 0.5]);
});

test('hookHead: nofeed marks every own lit needle fed only while the head decides, and clears it even on a throw', () => {
  const w = { lit: { A: { '1,1': true, '2,2': true, '3,3': false }, B: { '9,9': true } }, fed: { '2,2': 'A' } };
  let during = null;
  const E = {
    BOT_STYLE: { A: { klinok: 0.5 } },
    SIM: { t: 100, world: { fed: {}, lit: {} } },
    botOrders: (p, world) => {
      during = { ...world.fed };
      if (E.SIM.t === 101) throw new Error('boom');
    },
  };
  hookHead(E, 'A', { ...NO_TACTICS, noFeed: 600 }, () => undefined);
  E.botOrders('A', w);
  assert.deepEqual(during, { '1,1': 'A', '2,2': 'A' });
  assert.deepEqual(w.fed, { '2,2': 'A' });
  E.SIM.t = 101;
  assert.throws(() => E.botOrders('A', w), /boom/);
  assert.deepEqual(w.fed, { '2,2': 'A' });
  // from T on, the head sees the world as it is
  E.SIM.t = 600;
  E.botOrders('A', w);
  assert.deepEqual(during, { '2,2': 'A' });
});

test('hookHead leaves the head alone without these tactics, and only logs without an engine', () => {
  const botOrders = () => undefined;
  const E = { BOT_STYLE: { A: { klinok: 0.5 } }, SIM: { t: 0 }, botOrders };
  hookHead(E, 'A', parseTactics('fill:наш:6,ram:6'), () => undefined);
  assert.equal(E.botOrders, botOrders);
  const lines = [];
  hookHead(null, 'A', { ...NO_TACTICS, noFeed: 600 }, (l) => lines.push(l));
  assert.equal(lines.length, 1);
});

test('ram: a free Klinok takes a foreign Tkach standing on a needle that is not his', () => {
  const obs = observe({ units: [klinok('K-A1', 0, 2)], foes: [foe('T-B1', 'B', 0, 0)], mine: [[0, 0]] });
  assert.deepEqual(ram(obs), { kind: 'ram', unit: 'K-A1', target: 'T-B1' });
  // a ruin and the Keeper's ring are prey too
  assert.deepEqual(ram(observe({ units: [klinok('K-A1', 4, 2)], foes: [foe('T-B1', 'B', 4, 0)] })), { kind: 'ram', unit: 'K-A1', target: 'T-B1' });
  assert.deepEqual(ram(observe({ units: [klinok('K-A1', 2, 4)], foes: [foe('T-C1', 'C', 2, 2)] })), { kind: 'ram', unit: 'K-A1', target: 'T-C1' });
});

test('ram: no prey on his own needle, off needles, in a pact, of the Keeper, or a Klinok', () => {
  const k = [klinok('K-A1', 0, 2)];
  for (const obs of [
    observe({ units: [klinok('K-A1', 0, 6)], foes: [foe('T-B1', 'B', 0, 4)] }), // B's own needle
    observe({ units: k, foes: [foe('T-B1', 'B', 1, 1)] }), // not a needle cell
    observe({ units: k, foes: [foe('T-B1', 'B', 0, 0)], mine: [[0, 0]], pact: [{ a: 'B', b: 'A', since: 1 }] }),
    observe({ units: k, foes: [foe('T-K1', 'K', 0, 0)], mine: [[0, 0]] }),
    observe({ units: k, foes: [foe('K-B1', 'B', 0, 0, 'клинок')], mine: [[0, 0]] }),
  ]) {
    assert.equal(ram(obs), null);
  }
  // a needle B has taken from us shows as B's in sight: no prey any more
  assert.equal(ram(observe({ units: k, foes: [foe('T-B1', 'B', 0, 0)], own: [[0, 0, 'B']] })), null);
});

test('ram: the hunter is a free Klinok within R that the head did not command', () => {
  const prey = [foe('T-B1', 'B', 0, 0)];
  const at = (extra) => observe({ units: [klinok('K-A1', 0, 3, extra)], foes: prey, mine: [[0, 0]] });
  assert.ok(ram(at({})));
  assert.ok(ram(at({ task })));
  for (const extra of [{ stuck: true }, { wait: 1 }, { task: { ...task, ram: 'T-C9' } }, { task: { ...task, home: true } }, { task: { ...task, jam: { q: 1, r: 0 }, path: 0 } }]) {
    assert.equal(ram(at(extra)), null, JSON.stringify(extra));
  }
  assert.equal(ram(at({}), 2), null);
  assert.equal(ram(at({}), 6, [{ kind: 'move', unit: 'K-A1', q: 1, r: 1, goal: null, home: false }]), null);
  // a target another Klinok already chases is left to it
  assert.equal(ram(observe({ units: [klinok('K-A1', 0, 3), klinok('K-A2', 9, 9, { task: { ...task, ram: 'T-B1' } })], foes: prey, mine: [[0, 0]] })), null);
});

test('ram: prey on our needles first, then the nearest; channel and frame cap are respected', () => {
  const obs = observe({ units: [klinok('K-A1', 3, 0)], foes: [foe('T-C1', 'C', 4, 0), foe('T-B1', 'B', 0, 0)], mine: [[0, 0]] });
  assert.equal(hexDist({ q: 3, r: 0 }, { q: 4, r: 0 }), 1);
  assert.deepEqual(ram(obs), { kind: 'ram', unit: 'K-A1', target: 'T-B1' });
  // 32 bytes left is enough, 31 is not; the frame cap (floor(chanAt/32)+4) holds too
  const three = Array.from({ length: 3 }, () => ({ kind: 'yard', cls: 'ткач' }));
  const tight = (chan) => observe({ units: [klinok('K-A1', 0, 2)], foes: [foe('T-B1', 'B', 0, 0)], mine: [[0, 0]], chan });
  assert.ok(ram(tight(128), 6, three));
  assert.equal(ram(tight(127), 6, three), null);
  const cap = Array.from({ length: 8 }, (_, i) => ({ kind: 'halt', unit: 'T-A' + i }));
  assert.equal(ram(tight(141), 6, cap), null);
});

test('in a match the head obeys nofeed and k0, and the ram brings no refusals', () => {
  const run = (tactics) => {
    const bot = createStrategy('світанок', () => undefined, parseTactics(tactics));
    const kinds = { feed: 0, klinokEarly: 0, ram: 0 };
    let refused = 0;
    runMatch(createEngine, {
      seed: 2026,
      ticks: 500,
      bots: { A: bot },
      tapOrders: (t, slot, bytes) => {
        if (slot !== 'A') return;
        for (const o of decodeOrders(bytes) ?? []) {
          if (o.kind === 'feed') kinds.feed++;
          if (o.kind === 'ram') kinds.ram++;
          if (o.kind === 'yard' && o.cls === 'клинок' && t < 300) kinds.klinokEarly++;
        }
      },
      tapDenies: (_t, slot, denies) => {
        if (slot === 'A') refused += denies.filter(([, code]) => code !== 0).length;
      },
    });
    return { ...kinds, refused };
  };
  const base = run('fill:наш:6');
  assert.ok(base.feed > 0, 'the head feeds without nofeed');
  assert.ok(base.klinokEarly > 0, 'the head buys an early Klinok without k0');
  const tuned = run('fill:наш:6,nofeed:1200,k0:300,ram:6');
  assert.equal(tuned.feed, 0);
  assert.equal(tuned.klinokEarly, 0);
  assert.equal(tuned.refused, 0);
});

test('a nakaz head plays the slot with the pulse: no 6-tick silence, no refusals', () => {
  assert.equal(isPreset('nakaz:експансія'), true);
  assert.equal(isPreset('nakaz:наш'), true);
  assert.equal(isPreset('nakaz:нема'), false);
  assert.equal(presetOrDefault('nakaz:експансія'), 'nakaz:експансія');
  const bot = createStrategy('nakaz:експансія', () => undefined, parseTactics('none'));
  const accepted = new Map();
  let refused = 0;
  let orders = 0;
  runMatch(createEngine, {
    seed: 2026,
    ticks: 400,
    bots: { A: bot },
    tapOrders: (t, slot, bytes) => {
      if (slot !== 'A') return;
      const n = (decodeOrders(bytes) ?? []).length;
      orders += n;
      accepted.set(t, n);
    },
    tapDenies: (t, slot, denies) => {
      if (slot !== 'A') return;
      const bad = denies.filter(([, code]) => code !== 0).length;
      refused += bad;
      accepted.set(t, (accepted.get(t) ?? 0) - bad);
    },
  });
  let run = 0;
  let longest = 0;
  for (let t = 1; t <= 400; t++) {
    run = (accepted.get(t) ?? 0) > 0 ? 0 : run + 1;
    longest = Math.max(longest, run);
  }
  assert.ok(orders > 100, 'the nakaz commands');
  assert.equal(refused, 0);
  assert.ok(longest < 6, 'longest silence ' + longest);
  assert.equal(bot.belief(null), null);
});
