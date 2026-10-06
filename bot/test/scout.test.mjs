// scout:N - the early scans look at the rivals: tracking units seen lately, then the contested ruins.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_TACTICS, parseTactics } from '../dist/strategy.js';
import { AfterHead } from '../dist/tactics.js';

const cfg = {
  chanOrder: 32, chanTick: 32, upFloor: 96, downFloor: 1024, relayUp: 24, relayDown: 192, netK: 8, scanCost: 256, scanRad: 3, watchByte: 7, stormCost: 2,
  heatNeedle: 8, heatDark: 16, heatEnemy: 24, autonomy: 40, stepTkach: 2, stepKlinok: 1, capGrace: 60, weightTkach: 2, weightKlinok: 1, squadWeight: 8, droneBuild: 4,
};
const world = { cfg, storms: [], hearth: { q: 12, r: 0 } };
// our hearth (12,0); B's hearth (2,4) right next to the ruin (0,4); C's far away
const needles = [
  { q: 10, r: 0, start: null, ring: false },
  { q: 10, r: 2, start: null, ring: false },
  { q: 14, r: 0, start: null, ring: false },
  { q: 0, r: 4, start: null, ring: false },
  { q: 3, r: 0, start: null, ring: true },
  { q: 2, r: 5, start: 'B', ring: false },
];
const man = { needles, cfg, citadel: { q: 0, r: 0 }, cherta: 6, finds: [], seats: [{ q: 12, r: 0 }, { q: 2, r: 4 }, { q: -12, r: 6 }], perm: ['A', 'B', 'C'] };
const task = { goal: null, site: null, feed: null, jam: null, ram: null, home: false, path: 3 };
const unit = (id, cls, q, r, extra = {}) => ({ id, cls, q, r, mute: false, stuck: false, wait: 0, work: 0, away: 0, task: null, ...extra });
const observe = (t, { units = [], foes = [], ear = 1400 } = {}) => ({
  t,
  pulse: { energy: 100, chan: 141, chanAt: 141, ear, earAt: 1400, minutes: 0, needles: 2, mercy: false },
  mine: { needles: [], units, jams: [], losts: [], order: null, pact: {}, ledger: {} },
  own: [],
  foe: foes,
  noisy: [],
  pub: { pact: { active: [] }, dawn: false },
  events: [],
});
const scouting = (spec = 'scout:200') => new AfterHead({ ...NO_TACTICS, ...parseTactics(spec) }, man, 'A', world, () => false);
const headScan = { order: { kind: 'scan', q: 13, r: -2, rad: 3 }, from: 'head', at: 0 };
const run = (a, obs, entries = [headScan]) => {
  a.see(obs);
  return a.apply(obs, entries);
};
const scans = (entries) => entries.filter((e) => e.order.kind === 'scan').map((e) => [e.from, e.order.q, e.order.r]);

test('scout:N parses with bounds; scout alone or 0 is refused', () => {
  assert.equal(parseTactics('scout:60').scout, 60);
  const lines = [];
  assert.deepEqual(parseTactics('scout,scout:0,scout:1201,scout:5:1', (l) => lines.push(l)), NO_TACTICS);
  assert.equal(lines.length, 4);
});

test('a rival Tkach seen lately is looked at again where it was, every 3 ticks; the head\'s scan gives way', () => {
  const a = scouting();
  const tkach = unit('T-A1', 'ткач', 12, 0);
  run(a, observe(10, { units: [tkach], foes: [{ id: 'T-B1', p: 'B', cls: 'ткач', q: 5, r: 2 }] }));
  // not visible on 11 and 12: too early to look again
  assert.deepEqual(scans(run(a, observe(11, { units: [tkach] }))), [['head', 13, -2]]);
  assert.deepEqual(scans(run(a, observe(12, { units: [tkach] }))), [['head', 13, -2]]);
  // tick 13: three ticks after the contact - the scan goes to its last place instead of the head's
  assert.deepEqual(scans(run(a, observe(13, { units: [tkach] }))), [['tactic', 5, 2]]);
  // looked at on 13: the next look no sooner than 16
  assert.deepEqual(scans(run(a, observe(14, { units: [tkach] }))).filter(([from]) => from === 'tactic').length, 0);
});

test('a Klinok is tracked every 2 ticks, the Keeper\'s units never, a lost unit is dropped', () => {
  const a = scouting();
  run(a, observe(10, { foes: [{ id: 'K-B2', p: 'B', cls: 'клинок', q: 4, r: 1 }, { id: 'K-1', p: 'K', cls: 'клинок', q: 1, r: 1 }] }));
  assert.deepEqual(scans(run(a, observe(12))), [['tactic', 4, 1]]);
  // no new contact for longer than SCOUT_LOST (12 ticks): nothing to track any more
  const b = scouting();
  run(b, observe(10, { foes: [{ id: 'K-B2', p: 'B', cls: 'клинок', q: 4, r: 1 }] }));
  assert.ok(!scans(run(b, observe(30))).some(([, q, r]) => q === 4 && r === 1));
});

test('forecast: the ruin our Tkach heads to is checked once a rival could be near it', () => {
  const a = scouting();
  // our Tkach walks to the ruin (0,4): 12 cells, there on tick 34; B's first Tkach could be there on tick 9
  const tkach = unit('T-A1', 'ткач', 12, 0, { task: { ...task, goal: { q: 0, r: 4 } } });
  assert.deepEqual(scans(run(a, observe(10, { units: [tkach] }))), [['tactic', 0, 4]]);
  // checked on 10: the same ruin waits for SCOUT_RECHECK (6 ticks); the head's scan stays meanwhile
  assert.deepEqual(scans(run(a, observe(12, { units: [tkach] }))), [['head', 13, -2]]);
  assert.deepEqual(scans(run(a, observe(16, { units: [tkach] }))), [['tactic', 0, 4]]);
});

test('scout stays out after tick N and when the ears cannot pay', () => {
  const tkach = unit('T-A1', 'ткач', 12, 0, { task: { ...task, goal: { q: 0, r: 4 } } });
  assert.deepEqual(scans(run(scouting('scout:5'), observe(10, { units: [tkach] }))), [['head', 13, -2]]);
  assert.deepEqual(scans(run(scouting(), observe(10, { units: [tkach], ear: 100 }))), [['head', 13, -2]]);
  // no scan of the head and nothing to look at: the frame stays as it was
  assert.deepEqual(run(scouting(), observe(2), []), []);
});
