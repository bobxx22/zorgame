// Head styles: the catalog, the "base+knob=value" strings and their round trip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHETYPES } from '@zoria/sdk';
import { fullStyle, KNOB_MAX, KNOBS, LAND_MAX, parseStyle, STYLES, styleSpec } from '../dist/styles.js';
import { createStrategy, DEFAULT_PRESET, DEFAULT_TACTICS, NO_TACTICS, presetOrDefault, presets } from '../dist/strategy.js';

test('the SDK archetypes are in the catalog unchanged, every style is full and within bounds', () => {
  for (const name of Object.keys(ARCHETYPES)) assert.deepEqual(STYLES[name], ARCHETYPES[name]);
  assert.equal(Object.keys(STYLES).length, 21);
  for (const [name, st] of Object.entries(STYLES)) {
    const keys = name === 'полудень' ? ['mind', 'land', ...KNOBS] : ['mind', ...KNOBS];
    assert.deepEqual(Object.keys(st).sort(), keys.sort(), name);
    for (const k of KNOBS) assert.ok(st[k] >= 0 && st[k] <= KNOB_MAX[k], name + '.' + k);
  }
  assert.deepEqual(presets(), Object.keys(STYLES));
});

// the catalog is the head's decisions: every number is pinned here, so a changed weight fails
test('the catalog and the knob bounds are exactly these numbers', () => {
  assert.deepEqual(STYLES, {
    рівний: { mind: '', dark: 1, grow: 1, steal: 1, raid: 1, order: 1, klinok: 0.5, build: 1, guard: 0.5, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 0.5 },
    шир: { mind: '', dark: 0.3, grow: 1.4, steal: 0.55, raid: 0.4, order: 0.8, klinok: 0.15, build: 1.6, guard: 0.6, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 0.5 },
    обхідник: { mind: '', dark: 1, grow: 1, steal: 1, raid: 1, order: 1, klinok: 0.5, build: 1, guard: 0.5, scout: 0, deep: 0, spare: 1, pirate: 0, siege: 0, pact: 1 },
    проривник: { mind: '', dark: 3, grow: 0.8, steal: 1.5, raid: 0.3, order: 0.7, klinok: 0.2, build: 0.6, guard: 0.6, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 1 },
    облягач: { mind: 'різчик', dark: 1.6, grow: 0.75, steal: 1.3, raid: 1.7, order: 0.7, klinok: 0.6, build: 0.45, guard: 0.5, scout: 1, deep: 0.6, spare: 0, pirate: 0, siege: 1, pact: 1 },
    економіст: { mind: '', dark: 0.4, grow: 1.4, steal: 0.55, raid: 0.4, order: 0.8, klinok: 0.2, build: 1.2, guard: 1, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 0.5 },
    рейдер: { mind: '', dark: 1.6, grow: 0.75, steal: 1.3, raid: 1.7, order: 0.7, klinok: 0.6, build: 0.45, guard: 0.5, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 1 },
    опортуніст: { mind: '', dark: 1, grow: 1, steal: 1, raid: 0.9, order: 2.4, klinok: 0.4, build: 0.8, guard: 0.7, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 1 },
    союзник: { mind: '', dark: 1, grow: 1, steal: 1, raid: 1, order: 1, klinok: 0.5, build: 1, guard: 0.5, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 1 },
    підрядник: { mind: '', dark: 1, grow: 1, steal: 1, raid: 1, order: 2, klinok: 0.5, build: 1, guard: 0.5, scout: 0, deep: 0, spare: 0, pirate: 0.5, siege: 0, pact: 0.5 },
    вартовий: { mind: '', dark: 1, grow: 1, steal: 1, raid: 1, order: 1, klinok: 0.6, build: 1, guard: 1, scout: 0, deep: 0, spare: 1.5, pirate: 0, siege: 0, pact: 1 },
    будівник: { mind: '', dark: 1, grow: 1.3, steal: 1, raid: 1, order: 1, klinok: 0.3, build: 1.6, guard: 0.5, scout: 0, deep: 0, spare: 1, pirate: 0, siege: 0, pact: 1 },
    мисливець: { mind: '', dark: 2, grow: 1, steal: 1.4, raid: 1.4, order: 1, klinok: 0.6, build: 1, guard: 0.7, scout: 0, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 0.5 },
    різчик: { mind: 'різчик', dark: 1, grow: 1, steal: 1, raid: 1.4, order: 1, klinok: 0.5, build: 1, guard: 0.5, scout: 1, deep: 0, spare: 0, pirate: 0, siege: 0, pact: 0.5 },
    глибокий: { mind: 'різчик', dark: 3, grow: 0.8, steal: 1.5, raid: 0.3, order: 0.7, klinok: 0.2, build: 0.6, guard: 0.6, scout: 1, deep: 0.6, spare: 0, pirate: 0, siege: 0, pact: 1 },
    пірат: { mind: '', dark: 1, grow: 1, steal: 1, raid: 0.9, order: 2.4, klinok: 0.5, build: 0.8, guard: 0.7, scout: 0, deep: 0, spare: 0, pirate: 1, siege: 0, pact: 1 },
    зоряний: { mind: '', dark: 1, grow: 1, steal: 1, raid: 1, order: 1, klinok: 0.5, build: 1, guard: 0.5, scout: 0, deep: 0, spare: 1, pirate: 0, siege: 1, pact: 1 },
    широблог: { mind: 'різчик', dark: 1.6, grow: 1.2, steal: 1.3, raid: 1.7, order: 0.7, klinok: 0.45, build: 1, guard: 0.5, scout: 1, deep: 0.6, spare: 0, pirate: 0, siege: 1, pact: 1 },
    тихий: { mind: '', dark: 0.3, grow: 1.4, steal: 0.55, raid: 0.4, order: 0.8, klinok: 0.15, build: 1.6, guard: 1, scout: 0, deep: 0, spare: 1, pirate: 0, siege: 0, pact: 1 },
    світанок: { mind: 'різчик', dark: 1, grow: 1.4, steal: 1, raid: 1, order: 1, klinok: 0.5, build: 0.4, guard: 0.7, scout: 0.8, deep: 0, spare: 1, pirate: 0, siege: 1, pact: 1 },
    полудень: { mind: 'різчик', dark: 1, grow: 2.25, steal: 1, raid: 1.35, order: 1.55, klinok: 0.5, build: 0.25, guard: 0.6, scout: 1.35, deep: 0, spare: 0.6, pirate: 0, siege: 1.2, pact: 0.7, land: 1 },
  });
  // the search winner under its catalog name is exactly the string the search played
  assert.deepEqual(STYLES['світанок'], parseStyle('зоряний+mind=різчик,grow=1.4,build=0.4,guard=0.7,scout=0.8'));
  assert.deepEqual(STYLES['полудень'], parseStyle('світанок+grow=2.25,raid=1.35,order=1.55,build=0.25,guard=0.6,scout=1.35,spare=0.6,siege=1.2,pact=0.7,land=1'));
  assert.deepEqual(KNOB_MAX, { dark: 4, grow: 3, steal: 3, raid: 3, order: 3, klinok: 1, build: 3, guard: 1, scout: 2, deep: 1.5, spare: 2, pirate: 2, siege: 2, pact: 1 });
  assert.equal(LAND_MAX, 2);
  for (const k of KNOBS) {
    assert.equal(parseStyle('рівний+' + k + '=' + KNOB_MAX[k])[k], KNOB_MAX[k], k);
    assert.equal(parseStyle('рівний+' + k + '=' + (KNOB_MAX[k] + 0.01)), null, k);
  }
  assert.equal(parseStyle('рівний+land=2').land, 2);
  assert.equal(parseStyle('рівний+land=2.01'), null);
});

test('land is set only explicitly: only полудень carries it, a string may', () => {
  for (const [name, st] of Object.entries(STYLES)) assert.equal('land' in st, name === 'полудень', name);
  const st = parseStyle('широблог+land=0.5');
  assert.deepEqual(st, { ...STYLES['широблог'], land: 0.5 });
  assert.equal(styleSpec('широблог', st), 'широблог+land=0.5');
  assert.equal(styleSpec('широблог', STYLES['широблог']), 'широблог');
});

test('the default is полудень with fill:наш:6,nofeed:1200,ram:6,nohook; an empty ZARIA_TACTICS means the default, none means bare', () => {
  assert.equal(DEFAULT_PRESET, 'полудень');
  assert.equal(DEFAULT_TACTICS, 'fill:наш:6,nofeed:1200,ram:6,nohook');
  const saved = process.env['ZARIA_TACTICS'];
  try {
    for (const [env, want] of [
      [undefined, { fill: { charter: 'наш', after: 6 }, noPact: false, noFeed: 1200, k0: null, ram: 6, hunt: null, cherta: false, stay: null, yardCap: false, noHook: true, cache: null, surplus: null, engine: {} }],
      ['', { fill: { charter: 'наш', after: 6 }, noPact: false, noFeed: 1200, k0: null, ram: 6, hunt: null, cherta: false, stay: null, yardCap: false, noHook: true, cache: null, surplus: null, engine: {} }],
      ['none', NO_TACTICS],
      ['nopact', { fill: null, noPact: true, noFeed: null, k0: null, ram: null, hunt: null, cherta: false, stay: null, yardCap: false, noHook: false, cache: null, surplus: null, engine: {} }],
    ]) {
      if (env === undefined) delete process.env['ZARIA_TACTICS'];
      else process.env['ZARIA_TACTICS'] = env;
      assert.deepEqual(createStrategy('рівний').tactics, want, String(env));
    }
  } finally {
    if (saved === undefined) delete process.env['ZARIA_TACTICS'];
    else process.env['ZARIA_TACTICS'] = saved;
  }
});

test('a style string overrides knobs of its base; anything malformed is rejected', () => {
  assert.deepEqual(parseStyle('шир'), STYLES['шир']);
  const st = parseStyle('рівний+raid=1.5,pact=1,mind=різчик');
  assert.deepEqual(st, { ...STYLES['рівний'], raid: 1.5, pact: 1, mind: 'різчик' });
  assert.equal(parseStyle('облягач+mind=').mind, '');
  for (const bad of ['', 'нема', 'рівний+', 'рівний+raid', 'рівний+raid=-1', 'рівний+raid=4', 'рівний+pact=1.5', 'рівний+fly=1', 'рівний+mind=x', 'рівний+raid=1+pact=1', 'рівний+raid=1e0', 'рівний+land=x']) {
    assert.equal(parseStyle(bad), null, bad);
  }
});

test('styleSpec writes only the knobs that differ, and parseStyle reads it back', () => {
  assert.equal(styleSpec('рівний', STYLES['рівний']), 'рівний');
  const st = fullStyle({ ...STYLES['обхідник'], guard: 0.85, mind: 'різчик' });
  const spec = styleSpec('обхідник', st);
  assert.equal(spec, 'обхідник+mind=різчик,guard=0.85');
  assert.deepEqual(parseStyle(spec), st);
});

test('a preset may be a catalog name or a style string; an unknown one falls back to the default', () => {
  const lines = [];
  assert.equal(presetOrDefault('рівний+order=2', (l) => lines.push(l)), 'рівний+order=2');
  assert.equal(presetOrDefault('зоряний'), 'зоряний');
  assert.equal(presetOrDefault('рівний+order=9', (l) => lines.push(l)), DEFAULT_PRESET);
  assert.equal(lines.length, 1);
});
