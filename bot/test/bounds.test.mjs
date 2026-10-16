// The edges of every setting string the bot accepts: the tactics (ZARIA_TACTICS), the сплав
// variants "сплав:<economy>:<blades>" and the knobs of both heads. A value at its edge is taken,
// one step past it is refused with a line in the log and the default stays.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bladesKnobsOk } from '../dist/combo/blades.js';
import { economyParams } from '../dist/combo/economy.js';
import { comboParts, ENGINE_KNOBS, NO_TACTICS, parseTactics } from '../dist/strategy.js';

/* the tactics with an integer N and their upper edges (strategy.ts, parseTactics) */
const INT_TACTICS = { nofeed: ['noFeed', 1200], k0: ['k0', 1200], ram: ['ram', 12], hunt: ['hunt', 24], stay: ['stay', 24], cache: ['cache', 12], dawn: ['dawn', 120], loot: ['loot', 3], scout: ['scout', 1200] };

test('an integer tactic is taken from 1 to its edge and refused past it, with the edge named in the log', () => {
  for (const [name, [field, max]] of Object.entries(INT_TACTICS)) {
    assert.equal(parseTactics(`${name}:${max}`)[field], max, name);
    assert.equal(parseTactics(`${name}:1`)[field], 1, name);
    const lines = [];
    assert.equal(parseTactics(`${name}:${max + 1}`, (l) => lines.push(l))[field], null, name);
    assert.deepEqual(lines, [`tactic "${name}:${max + 1}": N - integer 1-${max}, skipping`], name);
    const zero = [];
    assert.equal(parseTactics(`${name}:0`, (l) => zero.push(l))[field], null, name);
    assert.equal(zero.length, 1, name);
  }
});

test('fill takes 0-1200 ticks and a known charter; surplus takes a charge of 0-360 and a build knob of 0-3', () => {
  assert.deepEqual(parseTactics('fill:own:1200').fill, { charter: 'own', after: 1200 });
  assert.deepEqual(parseTactics('fill:own').fill, { charter: 'own', after: 0 });
  assert.deepEqual(parseTactics('fill:наш:6').fill, { charter: 'own', after: 6 });
  const lines = [];
  assert.equal(parseTactics('fill:own:1201', (l) => lines.push(l)).fill, null);
  assert.equal(parseTactics('fill:nobody:6', (l) => lines.push(l)).fill, null);
  assert.deepEqual(lines, ['tactic "fill:own:1201": N - integer 0-1200, skipping', 'no tactic "fill:nobody:6", skipping']);

  assert.deepEqual(parseTactics('surplus:360:3').surplus, { at: 360, build: 3 });
  assert.deepEqual(parseTactics('surplus:0:0.5').surplus, { at: 0, build: 0.5 });
  const bad = [];
  assert.equal(parseTactics('surplus:361:1', (l) => bad.push(l)).surplus, null);
  assert.equal(parseTactics('surplus:200:3.5', (l) => bad.push(l)).surplus, null);
  assert.deepEqual(bad, ['tactic "surplus:361:1": E - integer 0-360, B - 0-3, skipping', 'tactic "surplus:200:3.5": E - integer 0-360, B - 0-3, skipping']);
});

test('the engine knobs of the mirror head are taken within their own bounds only', () => {
  for (const [token, k] of Object.entries(ENGINE_KNOBS)) {
    assert.equal(parseTactics(`${token}:${k.max}`).engine[k.key], k.max, token);
    assert.equal(parseTactics(`${token}:${k.min}`).engine[k.key], k.min, token);
    const lines = [];
    assert.deepEqual(parseTactics(`${token}:${k.max + 1}`, (l) => lines.push(l)).engine, {}, token);
    assert.equal(lines.length, 1, token);
  }
  assert.deepEqual(parseTactics('none'), NO_TACTICS);
  assert.deepEqual(parseTactics('nopact,duck,cherta,yardcap,nohook'), { ...NO_TACTICS, noPact: true, duck: true, cherta: true, yardCap: true, noHook: true });
});

test('the economy head takes its knobs within their bounds, on top of рівний', () => {
  const base = economyParams('');
  assert.deepEqual(economyParams(undefined), base);
  assert.deepEqual(economyParams('alpha=2+jam=3+bid=3+risk=1+ram=0+roads=1200'), { ...base, alpha: 2, jam: 3, bid: 3, risk: 1, ram: false, roads: 1200 });
  assert.equal(economyParams('ram=1')?.ram, true);
  for (const bad of ['alpha=2.1', 'jam=3.5', 'bid=4', 'risk=1.5', 'ram=2', 'roads=1201', 'roads=1.5', 'alpha=x', 'speed=1', 'alpha']) {
    assert.equal(economyParams(bad), null, bad);
  }
  assert.notDeepEqual(economyParams('хижий'), base);
  assert.notDeepEqual(economyParams('тихий'), base);
});

test('the Klinok head takes order, 0/1 switches and nothing else; сплав variants parse only whole', () => {
  for (const ok of ['', 'order=TTK', 'jam=0', 'guard=1;hunt=0;open=1', 'order=K;jam=1']) assert.equal(bladesKnobsOk(ok), true, ok);
  for (const bad of ['jam=2', 'order=TX', 'guard', 'speed=1', 'jam=0;']) assert.equal(bladesKnobsOk(bad), false, bad);
  assert.deepEqual(comboParts('сплав:хижий:jam=0+guard=0'), { economy: 'хижий', blades: 'jam=0;guard=0' });
  assert.deepEqual(comboParts('сплав:alpha=0.6:'), { economy: 'alpha=0.6', blades: '' });
  for (const bad of ['сплав:alpha=9:', 'сплав::jam=2', 'сплав:a:b:c', 'сплавx', 'полудень']) assert.equal(comboParts(bad), null, bad);
});
