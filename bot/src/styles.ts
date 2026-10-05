/* bot :: styles
   The head's character: a full knob object with which MirrorBot replaces the
   BOT_STYLE of its seat in the engine. The head's algorithm is one; knobs are
   multipliers on the honest estimate (minutes per tick), so a style is only
   weights, not different code.

   Catalogue: the five SDK archetypes as they are, the engine's own three
   styles (економіст, рейдер, опортуніст) and our mixes. Any style can also be
   given as a string "base+knob=number,..." (рівний+raid=1.5,pact=1; облягач+mind=):
   that's how the lab's night search (lab/server/search.ts) tries weights, and
   the winner can be added to the catalogue under a name. Style names stay in
   Ukrainian: they are bot names. */

import { ARCHETYPES } from '@zoria/sdk';

export const KNOBS = ['dark', 'grow', 'steal', 'raid', 'order', 'klinok', 'build', 'guard', 'scout', 'deep', 'spare', 'pirate', 'siege', 'pact'] as const;
export type Knob = (typeof KNOBS)[number];
export type Mind = '' | 'різчик';
/* land is optional: without it the head takes the world's landContest (0 now),
   so it gets into a style only when set explicitly - the new world of 05.10 may change the default */
export type Style = { mind: Mind; land?: number } & Record<Knob, number>;
export const LAND_MAX = 2;

/* knob bounds, per the engine (source/js/core/zaria-bot*.js):
     dark    foreign darkness behind a captured needle vs our own minute
     grow    an unowned ruin - a new needle of ours
     steal   a foreign needle to capture
     raid    jamming foreign needles
     order   "Hold the line" contracts
     klinok  share of Klinoks in the swarm (0-1)
     build   readiness to hold charge for a new needle
     guard   probability of answering a guest with a ram (0-1, lot)
     scout   weight of a foreign network in the aim of a flare and a scan
     deep    share of autonomy for a sortie deep into a foreign network
     spare   price of a spare network path (обхідник)
     pirate  a Klinok stands watch by a foreign contract
     siege   siege: victim, node pair, holders; at dawn - the ring
     pact    probability of a pact against the leader (0-1, lot)
     land    ruin measure: growth of our share and how contested the cell is (0-2) */
export const KNOB_MAX: Readonly<Record<Knob, number>> = {
  dark: 4,
  grow: 3,
  steal: 3,
  raid: 3,
  order: 3,
  klinok: 1,
  build: 3,
  guard: 1,
  scout: 2,
  deep: 1.5,
  spare: 2,
  pirate: 2,
  siege: 2,
  pact: 1,
};

/* a full style from a partial one: a missing knob is zero, as in the SDK; land - only if set */
export function fullStyle(way: Partial<Style>): Style {
  const st = { mind: way.mind ?? '' } as Style;
  for (const k of KNOBS) st[k] = way[k] ?? 0;
  if (way.land !== undefined) st.land = way.land;
  return st;
}

const sdk = (name: string): Style => fullStyle(ARCHETYPES[name] as Partial<Style>);
const mix = (base: Style, over: Partial<Style>): Style => fullStyle({ ...base, ...over });

const рівний = sdk('рівний');
const обхідник = sdk('обхідник');
const проривник = sdk('проривник');
const облягач = sdk('облягач');
const шир = sdk('шир');
/* the engine's own styles (zaria-bot-style.js, BOT_STYLE A/B/C) */
const опортуніст = fullStyle({ grow: 1, steal: 1, dark: 1, raid: 0.9, order: 2.4, klinok: 0.4, build: 0.8, guard: 0.7, pact: 1 });

export const STYLES: Readonly<Record<string, Style>> = {
  /* SDK archetypes - the same objects sampleBot gives */
  рівний,
  шир,
  обхідник,
  проривник,
  облягач,
  /* engine styles */
  економіст: fullStyle({ grow: 1.4, steal: 0.55, dark: 0.4, raid: 0.4, order: 0.8, klinok: 0.2, build: 1.2, guard: 1, pact: 0.5 }),
  рейдер: fullStyle({ grow: 0.75, steal: 1.3, dark: 1.6, raid: 1.7, order: 0.7, klinok: 0.6, build: 0.45, guard: 0.5, pact: 1 }),
  опортуніст,
  /* our mixes: each changes one or two traits of a known archetype */
  союзник: mix(рівний, { pact: 1 }),
  підрядник: mix(рівний, { order: 2, pirate: 0.5 }),
  вартовий: mix(обхідник, { guard: 1, klinok: 0.6, spare: 1.5 }),
  будівник: mix(обхідник, { grow: 1.3, build: 1.6, klinok: 0.3 }),
  мисливець: mix(рівний, { dark: 2, steal: 1.4, raid: 1.4, klinok: 0.6, guard: 0.7 }),
  різчик: mix(рівний, { mind: 'різчик', raid: 1.4, scout: 1 }),
  глибокий: mix(проривник, { mind: 'різчик', deep: 0.6, scout: 1 }),
  пірат: mix(опортуніст, { pirate: 1, klinok: 0.5 }),
  зоряний: mix(обхідник, { siege: 1 }),
  широблог: mix(облягач, { grow: 1.2, build: 1, klinok: 0.45 }),
  тихий: mix(шир, { guard: 1, spare: 1, pact: 1 }),
  /* found by the night search of 30.09 (generation 3): зоряний with the різчик
     mind, more growth, less building and more frequent rams. Vs широблог:
     +0.83 ± 0.15 share per pack on 60 fresh valleys vs pairs of SDK archetypes
     and +1.06 ± 0.12 on 120 valleys vs the mixed pool */
  світанок: mix(обхідник, { siege: 1, mind: 'різчик', grow: 1.4, build: 0.4, guard: 0.7, scout: 0.8 }),
  /* found by the 01.10 search together with the tactics nofeed:1200 and ram:6
     (generation 5): світанок with more growth, contracts, jamming and scouting,
     even less building, land 1. With these tactics vs світанок without them:
     +1.55 ± 0.21 share per pack on 60 fresh valleys vs the mixed pool */
  полудень: mix(обхідник, {
    mind: 'різчик',
    grow: 2.25,
    raid: 1.35,
    order: 1.55,
    build: 0.25,
    guard: 0.6,
    scout: 1.35,
    spare: 0.6,
    siege: 1.2,
    pact: 0.7,
    land: 1,
  }),
};

/* style string: a catalogue name or "base+knob=number,..."; invalid - null */
export function parseStyle(spec: string): Style | null {
  const [baseName, over, ...rest] = spec.split('+');
  if (rest.length || !baseName || !Object.hasOwn(STYLES, baseName)) return null;
  const st = fullStyle(STYLES[baseName]!);
  if (over === undefined) return st;
  if (!over) return null;
  for (const pair of over.split(',')) {
    const [k, v, ...tail] = pair.split('=');
    if (tail.length || k === undefined || v === undefined) return null;
    if (k === 'mind') {
      if (v !== '' && v !== 'різчик') return null;
      st.mind = v;
      continue;
    }
    if (!/^\d+(\.\d+)?$/.test(v)) return null;
    const n = Number(v);
    if (k === 'land') {
      if (n > LAND_MAX) return null;
      st.land = n;
      continue;
    }
    if (!(KNOBS as readonly string[]).includes(k) || n > KNOB_MAX[k as Knob]) return null;
    st[k as Knob] = n;
  }
  return st;
}

/* a style as a string: the base and the knobs that differ from it; the inverse of parseStyle */
export function styleSpec(base: string, st: Style): string {
  const b = STYLES[base];
  if (!b) throw new Error('no such style: ' + base);
  const diff: string[] = [];
  if (st.mind !== b.mind) diff.push('mind=' + st.mind);
  for (const k of KNOBS) if (st[k] !== b[k]) diff.push(k + '=' + String(Math.round(st[k] * 100) / 100));
  if (st.land !== undefined && st.land !== b.land) diff.push('land=' + String(Math.round(st.land * 100) / 100));
  return diff.length ? base + '+' + diff.join(',') : base;
}
