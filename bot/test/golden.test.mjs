// Golden matches: fixed valleys, our seat against the engine's own heads; every order frame of our
// seat goes into a digest. The bot is deterministic (no clock, no random), so any change of its
// behaviour - a fix or a slip - changes the digest. After an intended change: run, check the new
// numbers in the message, and update GOLDEN.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createEngine } from '@zoria/engine';
import { ARCHETYPES, openMatch } from '@zoria/sdk';
import { decodeManifest, encodeManifest } from '@zoria/protocol';
import { createStrategy as createBlades } from '../dist/combo/blades.js';
import { createStrategy as createEconomy } from '../dist/combo/economy.js';
import { createStrategy } from '../dist/strategy.js';

/* the manifest without the terrain passports: the heads then play by their own tables of the rules */
function bareManifest(bytes) {
  const m = decodeManifest(bytes);
  return encodeManifest({ ...m, terrain: { ...m.terrain, types: [] } });
}

/* a seat played by our own bot: a preset, or one head of сплав alone ("blades", "economy") - in сплав
   each head's orders for the other half are dropped, alone the whole head plays; "~bare" - with
   bareManifest (the Klinok head falls back on its own tables; the economy head and сплав stay
   silent without passports). The rivals can be our seats too, so Klinok fights happen often */
function seatOf(spec) {
  const [name, mod] = spec.split('~');
  const bot = name === 'blades' ? createBlades() : name === 'economy' ? createEconomy() : createStrategy(name, () => undefined);
  const bare = mod === 'bare';
  return { init: (m, s) => bot.init(bare ? bareManifest(m) : m, s), tick: (b) => bot.tick(b), feedback: (v) => bot.feedback?.(v) };
}

function play(preset, seed, ticks, rivals) {
  const hash = createHash('sha256');
  const bots = { A: seatOf(preset) };
  /* the other rivals are the engine's own heads with archetype characters: aggressive ones make fights happen */
  const styles = {};
  ['B', 'C'].forEach((slot, i) => {
    const rival = rivals[i];
    if (ARCHETYPES[rival]) styles[slot] = ARCHETYPES[rival];
    else bots[slot] = seatOf(rival);
  });
  const match = openMatch(createEngine, {
    seed,
    ticks,
    bots,
    styles,
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
  'сплав@101:сплав,сплав': { digest: 'b0b659ef26ce368f', score: 161.2, needles: 14 },
  'сплав@137:сплав,облягач': { digest: '38807a18df11bb70', score: 428.9, needles: 34 },
  'сплав@173:проривник,сплав': { digest: '23b8816dbaf91e00', score: 388.5, needles: 35 },
  'сплав@211:шир,обхідник': { digest: '285ba723d721b487', score: 425, needles: 39 },
  'сплав@257:облягач,облягач': { digest: '382a48f7a78b5373', score: 659.9, needles: 63 },
  'сплав@307:проривник,проривник': { digest: '907745bbc43e4f1c', score: 427.8, needles: 35 },
  'сплав@353:рівний,шир': { digest: 'cecb1a8c465999cb', score: 310.1, needles: 32 },
  'сплав@401:сплав,рівний': { digest: '707db8660b33f6a7', score: 250.9, needles: 21 },
  'сплав@557:обхідник,проривник': { digest: '5a8084992a8de06c', score: 327.4, needles: 27 },
  'сплав@601:сплав,шир': { digest: 'e2b388b479a7a6cb', score: 207.5, needles: 14 },
  'полудень@457:сплав,облягач': { digest: 'ac7445685fe576fb', score: 265.4, needles: 28 },
  'полудень@503:проривник,шир': { digest: '0dbd925a1ab5d95f', score: 514.9, needles: 79 },
  'blades@71:облягач,проривник': { digest: '4b022ca7126b3ed8', score: 722.7, needles: 83 },
  'blades@149:сплав,облягач': { digest: '3240283d38d69fb6', score: 256.1, needles: 28 },
  'economy@83:проривник,шир': { digest: 'a7100d0f4f778602', score: 405.7, needles: 32 },
  'economy@191:сплав,облягач': { digest: 'd1caab3dd7d13ffd', score: 385.9, needles: 34 },
  'blades~bare@233:рівний,облягач': { digest: '147cd3582d24ddf3', score: 33.6, needles: 2 },
  'blades@313:сплав,сплав': { digest: 'aa943b7c08a12b2e', score: 227.4, needles: 25 },
  'blades@379:проривник,шир': { digest: 'aa1625ad2ef1deae', score: 673.9, needles: 80 },
  'economy@461:облягач,облягач': { digest: '6c4233dfa61248de', score: 471, needles: 58 },
  'economy@523:сплав,сплав': { digest: 'd24208f2ee69b47b', score: 208.2, needles: 16 },
  'полудень@617:облягач,шир': { digest: 'e0e130f2151ae22f', score: 307.4, needles: 46 },
};

for (const key of Object.keys(GOLDEN)) {
  const [preset, rest] = key.split('@');
  const [seed, rivals] = rest.split(':');
  test(`golden match: ${preset} on valley ${seed} against ${rivals} plays exactly as recorded`, () => {
    const got = play(preset, Number(seed), 1200, rivals.split(','));
    assert.deepEqual(got, GOLDEN[key], `${key}: ${JSON.stringify(got)}`);
  });
}
