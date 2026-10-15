// Golden matches: fixed valleys, our seat against the engine's own heads; every order frame of our
// seat goes into a digest. The bot is deterministic (no clock, no random), so any change of its
// behaviour - a fix or a slip - changes the digest. After an intended change: run, check the new
// numbers in the message, and update GOLDEN.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { ARCHETYPES, openMatch } from '@zoria/sdk';
import { createStrategy } from '../dist/strategy.js';

function play(preset, seed, ticks, rivals) {
  const bot = createStrategy(preset, () => undefined);
  const hash = createHash('sha256');
  const seat = { init: (m, s) => bot.init(m, s), tick: (b) => bot.tick(b), feedback: (v) => bot.feedback(v) };
  const match = openMatch(createEngine, {
    seed,
    ticks,
    bots: { A: seat },
    /* the rivals are the engine's own heads with archetype characters: aggressive ones make fights happen */
    styles: { B: ARCHETYPES[rivals[0]], C: ARCHETYPES[rivals[1]] },
    tapOrders: (t, slot, bytes) => {
      if (slot === 'A') hash.update(t + ':' + Buffer.from(bytes).toString('hex') + ';');
    },
  });
  while (!match.done()) match.step();
  const s = match.summary();
  return { digest: hash.digest('hex').slice(0, 16), score: Math.round(s.score.A * 10) / 10, needles: s.needles.A };
}

const GOLDEN = {
  'сплав@11:облягач,проривник': { digest: '5d9970bc4304903c', score: 604, needles: 61 },
  'сплав@29:рівний,облягач': { digest: '4700539e3b38df4b', score: 255.1, needles: 19 },
  'сплав@47:проривник,шир': { digest: '2bac67ab82ec366a', score: 496.9, needles: 49 },
  'сплав@83:обхідник,облягач': { digest: 'afee83eced7fa552', score: 411, needles: 49 },
  'полудень@11:облягач,проривник': { digest: '7bb93ce24d5af217', score: 440.1, needles: 32 },
};

for (const key of Object.keys(GOLDEN)) {
  const [preset, rest] = key.split('@');
  const [seed, rivals] = rest.split(':');
  test(`golden match: ${preset} on valley ${seed} against ${rivals} plays exactly as recorded`, () => {
    const got = play(preset, Number(seed), 1200, rivals.split(','));
    assert.deepEqual(got, GOLDEN[key], `${key}: ${JSON.stringify(got)}`);
  });
}
