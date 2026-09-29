// Head styles: the catalog, the "base+knob=value" strings and their round trip.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARCHETYPES } from '@zoria/sdk';
import { fullStyle, KNOB_MAX, KNOBS, parseStyle, STYLES, styleSpec } from '../dist/styles.js';
import { presetOrDefault, presets } from '../dist/strategy.js';

test('the SDK archetypes are in the catalog unchanged, every style is full and within bounds', () => {
  for (const name of Object.keys(ARCHETYPES)) assert.deepEqual(STYLES[name], ARCHETYPES[name]);
  assert.equal(Object.keys(STYLES).length, 19);
  for (const [name, st] of Object.entries(STYLES)) {
    assert.deepEqual(Object.keys(st).sort(), ['mind', ...KNOBS].sort(), name);
    for (const k of KNOBS) assert.ok(st[k] >= 0 && st[k] <= KNOB_MAX[k], name + '.' + k);
  }
  assert.deepEqual(presets(), Object.keys(STYLES));
});

test('a style string overrides knobs of its base; anything malformed is rejected', () => {
  assert.deepEqual(parseStyle('шир'), STYLES['шир']);
  const st = parseStyle('рівний+raid=1.5,pact=1,mind=різчик');
  assert.deepEqual(st, { ...STYLES['рівний'], raid: 1.5, pact: 1, mind: 'різчик' });
  assert.equal(parseStyle('облягач+mind=').mind, '');
  for (const bad of ['', 'нема', 'рівний+', 'рівний+raid', 'рівний+raid=-1', 'рівний+raid=4', 'рівний+pact=1.5', 'рівний+fly=1', 'рівний+mind=x', 'рівний+raid=1+pact=1', 'рівний+raid=1e0']) {
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
  assert.equal(presetOrDefault('рівний+order=9', (l) => lines.push(l)), 'рівний');
  assert.equal(lines.length, 1);
});
