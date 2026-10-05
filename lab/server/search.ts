/* lab :: search
   Night search for a head style. Our bot (with the default tactics) plays
   different styles (bot/src/styles.ts) on the same valleys against the same
   pairs of SDK archetypes; the measure is the paired share difference per
   pack vs the base style.

   A generation is halving: all candidates on 30 valleys, the better half on
   30 more, then on 120 (the noise of the paired difference is 1.1-1.8 share
   per pack, on 10 valleys the halving would be a lottery). Generation 0 -
   --start or the whole catalogue; after that the best of all time become
   parents: the next generation is their mutations and crossings. When time is
   left only for the check, the five best and the base play on fresh valleys
   the search hasn't seen: selection on the same valleys inflates the winner's
   difference, fresh valleys show the honest one.

   Run (from the lab/ directory):
     npm run search -- --hours 8
     npm run search -- --resume <id> --hours 3   continue; what's played isn't replayed
   Flags: --hours 8, --workers <cores-1>, --from 5000 (first valley),
   --validate 60 (fresh valleys), --base <battle style>, --ticks 1200,
   --start style;style;... (generation 0; default - the whole catalogue),
   --pool arch|mixed|strong|foreign|ext (opponents), --eval 1 (no search:
   only --start and the base on fresh valleys).

   The mixed pool - in case a style got "tuned" to the SDK archetypes: our bot
   in battle configuration (self-play), the archetypes рівний and облягач (the
   participant template), the engine styles опортуніст and рейдер in our
   wrapper, and a bot whose slot is run by the експансія nakaz the whole match
   (a participant whose bot didn't start).

   Results: runs/search/<id>/results.ndjson (one pack per line), report.md
   (the table of the best, updated after every step). Ctrl+C is safe: every
   pack is written as soon as it's played. */

import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ENGINE_HASH } from '@zoria/engine';
import { ARCHETYPES } from '@zoria/sdk';
import { DEFAULT_PRESET, DEFAULT_TACTICS, isPreset, parseTactics } from '../../bot/dist/strategy.js';
import { fullStyle, KNOB_MAX, KNOBS, parseStyle, STYLES, styleSpec } from '../../bot/dist/styles.js';
import type { Knob, Style } from '../../bot/dist/styles.js';
import type { SeatSpec } from '../shared/record.ts';
import { EXT_BOTS, isExtBot } from './ext.ts';
import { isMix } from './mix.ts';
import type { PackSeat } from './play.ts';
import { newRunId, RUNS } from './runs.ts';
import type { SearchJob, SearchReply } from './search-worker.ts';

/* ===== flags ===== */

function flags(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error('unclear argument ' + a);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error('flag ' + a + ' is missing a value');
    out[a.slice(2)] = v;
    i++;
  }
  return out;
}

interface Config {
  id: string;
  base: string;
  from: number;
  ticks: number;
  validate: number;
  tactics: string[];
  start: string[];
  pool: 'arch' | 'mixed' | 'strong' | 'foreign' | 'ext';
  /* opponents fixed at start: a change of the battle style doesn't change the pool of a resume */
  opponents: SeatSpec[];
  /* search - generations and halving; eval - only all of --start and the base on fresh valleys */
  mode: 'search' | 'eval';
  /* what played: engine hash and bot commit (from git or from the deployment's build.json) */
  engine: string;
  build: string | null;
}

const RUNGS = [30, 60, 120];
const TOP = RUNGS[RUNGS.length - 1]!;
const PARENTS = 4;
const CHILDREN = 8;
const FINALISTS = 5;
/* fresh valleys - far from the search ones */
const FRESH = 100_000;

/* mixed pool: a copy of our battle bot (self-play) - the only seat that grows
   with the battle bot; опортуніст and рейдер in our wrapper - with the tactics
   they were measured with (fill:own:6), so the pool doesn't drift with our finds */
function poolOf(pool: Config['pool']): SeatSpec[] {
  if (pool === 'arch') return Object.keys(ARCHETYPES).map((name) => ({ kind: 'archetype', name }));
  /* external bots pool: all lab/ext bots (scripts/ext-build.mjs) - written from the same documents other participants have */
  if (pool === 'ext') return EXT_BOTS.map((name) => ({ kind: 'ext', name }));
  /* strong pool: our battle bot and its closest strong neighbours (all without
     feeding) - a neutral result here is ~6 share, and small improvements don't
     hit the scale's ceiling; plus облягач and the експансія nakaz - a different
     manner of play */
  /* foreign pool: not a single head of ours without feeding - only what other
     participants most likely play (SDK archetypes, engine styles in the
     wrapper with the filler only, a bot under a nakaz). Checks whether a tactic
     works not only against copies of ours */
  if (pool === 'foreign') {
    const fixed = ['fill:own:6'];
    return [
      { kind: 'archetype', name: 'рівний' },
      { kind: 'archetype', name: 'облягач' },
      { kind: 'archetype', name: 'проривник' },
      { kind: 'ours', name: 'опортуніст', tactics: fixed },
      { kind: 'ours', name: 'рейдер', tactics: fixed },
      { kind: 'nakaz', name: 'експансія' },
    ];
  }
  if (pool === 'strong') {
    const own = DEFAULT_TACTICS.split(',');
    const nf = ['fill:own:6', 'nofeed:1200', 'ram:6'];
    return [
      { kind: 'ours', name: DEFAULT_PRESET, tactics: own },
      { kind: 'ours', name: 'світанок', tactics: nf },
      { kind: 'ours', name: 'зоряний', tactics: nf },
      { kind: 'ours', name: 'широблог', tactics: nf },
      { kind: 'archetype', name: 'облягач' },
      { kind: 'nakaz', name: 'експансія' },
    ];
  }
  const fixed = ['fill:own:6'];
  return [
    { kind: 'ours', name: DEFAULT_PRESET, tactics: DEFAULT_TACTICS.split(',') },
    { kind: 'archetype', name: 'рівний' },
    { kind: 'archetype', name: 'облягач' },
    { kind: 'ours', name: 'опортуніст', tactics: fixed },
    { kind: 'ours', name: 'рейдер', tactics: fixed },
    { kind: 'nakaz', name: 'експансія' },
  ];
}
const seatLabel = (o: SeatSpec): string => (o.kind === 'nakaz' ? 'nakaz ' : o.kind === 'ours' ? 'ours ' : o.kind === 'ext' ? 'ext ' : o.kind === 'mix' ? 'mix ' : '') + o.name + (o.tactics ? '|' + o.tactics.join(',') : '');

/* candidate: a preset of our bot (a head style or a nakaz head "nakaz:<sample>")
   and, after "|", its own tactics instead of the defaults: "світанок|fill:own:6,ram:6" */
interface Candidate {
  preset: string;
  tactics: string[];
  /* "ext:<name>" - an external bot from lab/ext in the candidate's seat (--eval only) */
  ext?: string;
  /* "mix:e=<source>,k=<source>" - a mixed bot (server/mix.ts, --eval only) */
  mix?: string;
}
function candidateOf(spec: string): Candidate | null {
  if (spec.startsWith('mix:')) return isMix(spec.slice(4)) ? { preset: spec, tactics: [], mix: spec.slice(4) } : null;
  if (spec.startsWith('ext:')) return isExtBot(spec.slice(4)) ? { preset: spec, tactics: [], ext: spec.slice(4) } : null;
  const [preset, tactics, ...rest] = spec.split('|');
  if (rest.length || !preset || !isPreset(preset)) return null;
  if (tactics === undefined) return { preset, tactics: cfg.tactics };
  const list = tactics
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  let bad = !list.length;
  parseTactics(list, () => {
    bad = true;
  });
  return bad ? null : { preset, tactics: list };
}

/* bot commit: the deployment's build.json (worker.sh deploy) or git; neither - null */
function buildOf(): string | null {
  const file = new URL('../build.json', import.meta.url);
  try {
    if (existsSync(file)) return String((JSON.parse(readFileSync(file, 'utf8')) as { commit?: string }).commit ?? null);
    const head = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    /* everything that goes to play: bot code, nakaz, packages, lab server */
    const dirty = execSync('git status --porcelain -- ../bot/src ../bot/nakaz.yaml ../bot/package.json ../lab/server ../lab/shared', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return head + (dirty ? '+uncommitted' : '');
  } catch {
    return null;
  }
}

const f = flags(process.argv.slice(2));
const known = new Set(['hours', 'workers', 'from', 'validate', 'base', 'ticks', 'resume', 'start', 'pool', 'eval']);
for (const k of Object.keys(f)) if (!known.has(k)) throw new Error('no flag --' + k);
const hours = Number(f['hours'] ?? 8);
const workers = Number(f['workers'] ?? Math.max(1, availableParallelism() - 1));
if (!(hours > 0 && hours <= 240)) throw new Error('--hours: 0-240');
if (!Number.isInteger(workers) || workers < 1 || workers > 64) throw new Error('--workers: 1-64');

const DIR = join(RUNS, 'search');
let cfg: Config;
if (f['resume']) {
  const path = join(DIR, f['resume'], 'config.json');
  if (!/^[a-z0-9-]{8,40}$/.test(f['resume']) || !existsSync(path)) throw new Error('no search ' + f['resume']);
  cfg = JSON.parse(readFileSync(path, 'utf8')) as Config;
  cfg.start ??= Object.keys(STYLES);
  cfg.pool ??= 'arch';
  cfg.opponents ??= poolOf('arch');
  cfg.mode ??= 'search';
  /* a different world - different numbers: a search by another engine can't be continued */
  if (cfg.engine && cfg.engine !== ENGINE_HASH) throw new Error('the search was played by engine ' + cfg.engine.slice(0, 12) + ', and here it is ' + ENGINE_HASH.slice(0, 12));
} else {
  cfg = {
    id: newRunId(),
    base: f['base'] ?? DEFAULT_PRESET,
    from: Number(f['from'] ?? 5000),
    ticks: Number(f['ticks'] ?? 1200),
    validate: Number(f['validate'] ?? 60),
    tactics: DEFAULT_TACTICS.split(','),
    /* style strings contain commas, so the list is semicolon separated */
    start: f['start'] ? f['start'].split(';').map((x) => x.trim()).filter(Boolean) : Object.keys(STYLES),
    pool: (f['pool'] ?? 'arch') as Config['pool'],
    opponents: [],
    mode: f['eval'] === '1' ? 'eval' : 'search',
    engine: ENGINE_HASH,
    build: buildOf(),
  };
  if (f['eval'] !== undefined && f['eval'] !== '1') throw new Error('--eval 1');
  if (!['arch', 'mixed', 'strong', 'foreign', 'ext'].includes(cfg.pool)) throw new Error('--pool: arch, mixed, strong, foreign or ext');
  if (cfg.pool === 'ext' && EXT_BOTS.length < 2) throw new Error('--pool ext: fewer than two bots in lab/ext');
  if (cfg.mode === 'search' && cfg.start.some((x) => (x.startsWith('ext:') || x.startsWith('mix:')))) throw new Error('--start ext:<name> / mix:<name> - only with --eval: an external bot is not mutated');
  cfg.opponents = poolOf(cfg.pool);
  for (const spec of cfg.start) if (!candidateOf(spec)) throw new Error('--start: unclear candidate ' + spec);
  if (!Object.hasOwn(STYLES, cfg.base)) throw new Error('--base: one of ' + Object.keys(STYLES).join(', '));
  if (!Number.isInteger(cfg.from) || cfg.from < 0 || cfg.from > 2 ** 30) throw new Error('--from');
  if (!Number.isInteger(cfg.ticks) || cfg.ticks < 10 || cfg.ticks > 1200) throw new Error('--ticks');
  if (!Number.isInteger(cfg.validate) || cfg.validate < 10 || cfg.validate > 400) throw new Error('--validate: 10-400');
  mkdirSync(join(DIR, cfg.id), { recursive: true });
  writeFileSync(join(DIR, cfg.id, 'config.json'), JSON.stringify(cfg, null, 1));
}
const HOME = join(DIR, cfg.id);
const RESULTS = join(HOME, 'results.ndjson');
const REPORT = join(HOME, 'report.md');
const started = Date.now();
const deadline = started + hours * 3600_000;

/* ===== opponents: all pairs of the pool, a valley's pair - by its number ===== */

const POOL: SeatSpec[] = cfg.opponents;

const PAIRS: [SeatSpec, SeatSpec][] = [];
for (let i = 0; i < POOL.length; i++) for (let j = i + 1; j < POOL.length; j++) PAIRS.push([POOL[i]!, POOL[j]!]);

const searchSeed = (i: number): number => cfg.from + i;
const freshSeed = (i: number): number => cfg.from + FRESH + i;
function lineupOf(spec: string, seed: number): [SeatSpec, SeatSpec, SeatSpec] {
  const [a, b] = PAIRS[(seed - cfg.from) % PAIRS.length]!;
  const c = candidateOf(spec)!;
  return [c.mix ? { kind: 'mix', name: c.mix } : c.ext ? { kind: 'ext', name: c.ext } : { kind: 'ours', name: c.preset, tactics: c.tactics }, a, b];
}

/* ===== played: spec -> valley -> our seat ===== */

interface Row {
  spec: string;
  seed: number;
  share: number;
  places: number[];
  score: number;
  /* average score of the opponents at the table (sum per pack) */
  oppScore?: number;
  denials: number;
  denialKinds?: Record<string, number>;
  nakazTicks: number;
  ms: number;
}
const played = new Map<string, Map<number, Row>>();
const origin = new Map<string, string>();
function remember(row: Row): void {
  let m = played.get(row.spec);
  if (!m) played.set(row.spec, (m = new Map()));
  m.set(row.seed, row);
}
/* played earlier (--resume); a broken line at the end - a pack that wasn't fully written at a stop */
let pastPacks = 0;
let pastMs = 0;
if (existsSync(RESULTS)) {
  const text = readFileSync(RESULTS, 'utf8');
  /* close a broken tail, otherwise the next pack is glued to it and lost */
  if (text && !text.endsWith('\n')) appendFileSync(RESULTS, '\n');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Row;
      remember(row);
      pastPacks++;
      pastMs += row.ms;
    } catch {
      console.log('skipping a broken journal line');
    }
  }
}
const originFile = join(HOME, 'origin.json');
if (existsSync(originFile)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(originFile, 'utf8')) as Record<string, string>)) origin.set(k, v);
function note(spec: string, why: string): void {
  if (!origin.has(spec)) origin.set(spec, why);
}

/* ===== thread pool ===== */

const pool: Worker[] = [];
const idle: Worker[] = [];
const waiting = new Map<number, (r: SearchReply) => void>();
const backlog: SearchJob[] = [];
let nextKey = 0;
let packs = 0;
let packMs = 0;

function dispatch(): void {
  while (idle.length && backlog.length) idle.pop()!.postMessage(backlog.shift()!);
}
for (let i = 0; i < workers; i++) {
  const w = new Worker(new URL('./search-worker.ts', import.meta.url));
  w.on('message', (r: SearchReply) => {
    idle.push(w);
    const done = waiting.get(r.key);
    waiting.delete(r.key);
    done?.(r);
    dispatch();
  });
  w.on('error', (e) => {
    console.error('thread crashed: ' + (e.stack ?? e.message));
    process.exit(1);
  });
  pool.push(w);
  idle.push(w);
}

function play(spec: string, seed: number): Promise<Row> {
  const job: SearchJob = { key: nextKey++, seed, ticks: cfg.ticks, lineup: lineupOf(spec, seed) };
  return new Promise((resolve, reject) => {
    waiting.set(job.key, (r) => {
      if (!r.ok) return reject(new Error(spec + ' @ ' + seed + ': ' + r.error));
      const s: PackSeat = r.seats[0]!;
      const row: Row = {
        spec,
        seed,
        share: s.share,
        places: s.places,
        score: Math.round(s.score * 10) / 10,
        oppScore: Math.round(s.oppScore * 10) / 10,
        denials: s.denials,
        denialKinds: s.denialKinds,
        nakazTicks: s.nakazTicks,
        ms: r.ms,
      };
      appendFileSync(RESULTS, JSON.stringify(row) + '\n');
      remember(row);
      packs++;
      packMs += r.ms;
      resolve(row);
    });
    backlog.push(job);
    dispatch();
  });
}

/* all (spec, valley) pairs not played yet; the base - always */
async function ensure(specs: readonly string[], seeds: readonly number[]): Promise<void> {
  const todo: Promise<Row>[] = [];
  for (const spec of new Set([cfg.base, ...specs])) for (const seed of seeds) if (!played.get(spec)?.has(seed)) todo.push(play(spec, seed));
  await Promise.all(todo);
}

/* how many ms this many packs takes on all threads; the measure includes what
   was played before --resume; before the very first pack - unknown, zero */
function costMs(n: number): number {
  const count = packs + pastPacks;
  return count ? (n * (packMs + pastMs)) / count / workers : 0;
}

/* ===== measure ===== */

interface Stat {
  spec: string;
  n: number;
  mean: number;
  delta: number;
  se: number;
  first: number;
  nakaz: number;
  denials: number;
  /* packs played exactly like the base: the style changed nothing */
  same: number;
  /* paired difference "score minus the opponents' average" in minutes per pack */
  margin: number;
  marginSe: number;
  /* rejections by source:order:code, total */
  kinds: Record<string, number>;
}
function stat(spec: string, seeds: readonly number[]): Stat {
  const mine = played.get(spec);
  const base = played.get(cfg.base);
  const d: number[] = [];
  const shares: number[] = [];
  let first = 0;
  let matches = 0;
  let nakaz = 0;
  let denials = 0;
  let same = 0;
  const dm: number[] = [];
  const kinds: Record<string, number> = {};
  for (const seed of seeds) {
    const r = mine?.get(seed);
    const b = base?.get(seed);
    if (!r || !b) continue;
    d.push(r.share - b.share);
    shares.push(r.share);
    first += r.places.filter((p) => p === 1).length;
    if (r.score === b.score && r.share === b.share) same++;
    matches += r.places.length;
    nakaz += r.nakazTicks;
    denials += r.denials;
    if (r.oppScore !== undefined && b.oppScore !== undefined) dm.push(r.score - r.oppScore - (b.score - b.oppScore));
    for (const [k, v] of Object.entries(r.denialKinds ?? {})) kinds[k] = (kinds[k] ?? 0) + v;
  }
  const n = d.length;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const m = mean(d);
  const se = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) / n) : 0;
  const mm = mean(dm);
  const mse = dm.length > 1 ? Math.sqrt(dm.reduce((s, x) => s + (x - mm) ** 2, 0) / (dm.length - 1) / dm.length) : 0;
  return { spec, n, mean: mean(shares), delta: m, se, first: matches ? first / matches : 0, nakaz: n ? nakaz / n : 0, denials: n ? denials / n : 0, same, margin: mm, marginSe: mse, kinds };
}
const range = (from: number, n: number, seed: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => seed(from + i));
const rungSeeds = (n: number) => range(0, n, searchSeed);

/* ===== offspring ===== */

/* string -> 32 bits (FNV-1a) */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (x: number) => Math.round(x * 20) / 20;
const baseOf = (spec: string) => spec.split('+')[0]!;

/* klinok - the threshold of the Klinok share in the swarm (yard: Klinoks/units
   in the field < klinok, and only when the new unit fits in weight 8: Tkach 2,
   Klinok 1). Shares at which the yard decides at all: 0, 1/4 (3T1K), 1/3
   (2T1K), 1/2, 3/5, 2/3, 3/4. Any two values in one interval (0, 1/4], (1/4,
   1/3], (1/3, 1/2], (1/2, 3/5], (3/5, 2/3], (2/3, 3/4] play the same (0.37 and
   0.5 gave 60 of 60 identical packs). So - one step per interval and zero: a swarm without Klinoks */
const KLINOK_STEPS = [0, 0.2, 0.3, 0.45, 0.55, 0.63, 0.7];
/* guard and pact are lot thresholds: a 0.05 step changes the outcome only rarely */
const LOTS: readonly Knob[] = ['guard', 'pact'];
const LAND_STEPS = [0.5, 1, 1.5, 2];

function nearest(steps: readonly number[], v: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i]! - v) < Math.abs(steps[best]! - v)) best = i;
  return best;
}

function mutate(st: Style, r: () => number): Style {
  const out = fullStyle(st);
  let changed = false;
  while (!changed) {
    for (const k of KNOBS) {
      if (r() > 0.3) continue;
      const max = KNOB_MAX[k as Knob];
      const v = out[k as Knob];
      let next: number;
      if (k === 'klinok') {
        const i = nearest(KLINOK_STEPS, v) + (r() < 0.5 ? -1 : 1) * (r() < 0.25 ? 2 : 1);
        next = KLINOK_STEPS[Math.max(0, Math.min(KLINOK_STEPS.length - 1, i))]!;
      } else if (LOTS.includes(k)) {
        next = Math.round(Math.min(max, Math.max(0, v + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 3)) * 0.1)) * 10) / 10;
      } else if (v === 0) {
        /* zero can't be moved by multiplication: a sleeping knob wakes up with a probability */
        next = r() < 0.3 ? round(r() * max * 0.5) : 0;
      } else {
        next = round(Math.min(max, Math.max(0, v * Math.exp((r() * 2 - 1) * 0.6))));
      }
      if (next !== v) {
        out[k as Knob] = next;
        changed = true;
      }
    }
    if (r() < 0.1) {
      out.mind = out.mind ? '' : 'різчик';
      changed = true;
    }
    if (r() < 0.1) {
      /* land is optional: it appears, steps or disappears */
      if (out.land === undefined) out.land = LAND_STEPS[Math.floor(r() * LAND_STEPS.length)]!;
      else if (r() < 0.3) delete out.land;
      else out.land = LAND_STEPS[Math.max(0, Math.min(LAND_STEPS.length - 1, nearest(LAND_STEPS, out.land) + (r() < 0.5 ? -1 : 1)))]!;
      changed = true;
    }
  }
  return out;
}
function cross(a: Style, b: Style, r: () => number): Style {
  const out = fullStyle(a);
  for (const k of KNOBS) if (r() < 0.5) out[k as Knob] = b[k as Knob];
  if (r() < 0.5) out.mind = b.mind;
  if (r() < 0.5) {
    if (b.land === undefined) delete out.land;
    else out.land = b.land;
  }
  return out;
}

function children(gen: number, all: readonly string[]): string[] {
  /* only the style mutates; a nakaz head is never a parent, tactics ("|...") are inherited */
  const parents = all.filter((p) => parseStyle(p.split('|')[0]!));
  /* no parents yet (generation 0 - only the base, or it didn't reach the top rung) */
  if (!parents.length) return [];
  /* the seed comes from the search id: different searches try different
     offspring, and a continuation (--resume) of the same search - the same ones */
  const r = rng(seedOf(cfg.id) ^ Math.imul(gen, 7919));
  const out: string[] = [];
  let tries = 0;
  while (out.length < CHILDREN && tries++ < 500) {
    const p = parents[Math.floor(r() * parents.length)]!;
    const [pStyle, ...pTactics] = p.split('|');
    const suffix = pTactics.length ? '|' + pTactics.join('|') : '';
    const pst = parseStyle(pStyle!)!;
    let st: Style;
    let why: string;
    if (r() < 0.33 && parents.length > 1) {
      const q = parents[Math.floor(r() * parents.length)]!;
      if (q === p) continue;
      st = cross(pst, parseStyle(q.split('|')[0]!)!, r);
      if (r() < 0.5) st = mutate(st, r);
      why = 'generation ' + gen + ': crossing ' + p + ' × ' + q;
    } else {
      st = mutate(pst, r);
      why = 'generation ' + gen + ': mutation ' + p;
    }
    const spec = styleSpec(baseOf(pStyle!), st) + suffix;
    if (played.has(spec) || out.includes(spec) || !candidateOf(spec)) continue;
    note(spec, why);
    out.push(spec);
  }
  return out;
}

/* ===== report ===== */

const fmt = (x: number, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
function hall(): Stat[] {
  const seeds = rungSeeds(TOP);
  return [...played.keys()]
    .map((spec) => stat(spec, seeds))
    .filter((s) => s.n >= TOP)
    .sort((a, b) => b.delta - a.delta);
}
function table(rows: readonly Stat[], showOrigin: boolean): string {
  const head = '| # | style | valleys | share | diff vs base | Δ minutes | as base | 1st places | nakaz, ticks | rejections per pack | rejections (source:order:code) |' + (showOrigin ? ' origin |' : '');
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|' + (showOrigin ? '---|' : '');
  const kindsText = (k: Record<string, number>) =>
    Object.entries(k)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([key, v]) => key + ' ×' + v)
      .join(', ');
  const lines = rows.map(
    (s, i) =>
      `| ${i + 1} | \`${s.spec}\` | ${s.n} | ${s.mean.toFixed(2)} | ${fmt(s.delta)} ± ${s.se.toFixed(2)} | ${fmt(s.margin, 1)} ± ${s.marginSe.toFixed(1)} | ${s.same} | ${(s.first * 100).toFixed(0)}% | ${s.nakaz.toFixed(1)} | ${s.denials.toFixed(1)} | ${kindsText(s.kinds)} |` +
      (showOrigin ? ` ${origin.get(s.spec) ?? ''} |` : ''),
  );
  return [head, sep, ...lines].join('\n');
}
let validation: Stat[] | null = null;
let recheck: Stat[] | null = null;
/* the second fresh set: only for the winner and the base */
const RECHECK = FRESH + 10_000;
let phase = 'search';
function report(gen: number): void {
  const mins = (Date.now() - started) / 60_000;
  const all = hall();
  const partial = [...played.keys()]
    .map((spec) => stat(spec, rungSeeds(TOP)))
    .filter((s) => s.n > 0 && s.n < TOP)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 15);
  const text = [
    `# Night style search ${cfg.id}`,
    '',
    `Engine ${cfg.engine?.slice(0, 12) ?? '?'}, bot ${cfg.build ?? '?'}. Base: \`${cfg.base}\`, tactics: \`${cfg.tactics.join(',')}\`. Opponents (pairs in turn): ${POOL.map((o) => '`' + seatLabel(o) + '`').join(', ')}. Search valleys ${cfg.from}-${cfg.from + TOP - 1}, fresh ones - from ${cfg.from + FRESH}.`,
    '',
    `Stage: **${phase}**, generation ${gen}. Packs played: ${packs} in this run (${[...played.values()].reduce((s, m) => s + m.size, 0)} in the journal in total), ${mins.toFixed(0)} min, ${(packs ? packMs / packs / 1000 : 0).toFixed(1)} s per pack per thread on average, ${workers} threads.`,
    '',
    'Share - average points per pack (3-9). Difference - paired: the style\'s share minus the base\'s share on the same valley, ± standard error. A difference larger than two errors is no longer chance. "As base" - packs played exactly like the base: if they are the majority, the difference is a few random packs. "Δ minutes" - the paired difference of the score minus the average of the two opponents at the table, minutes per pack: finer than the share when shares hit the ceiling. "Rejections" - the most frequent ones by source (pulse, head, fill, tactic), order and gatekeeper code.',
    '',
    ...(recheck
      ? ['## Recheck of the winner on a second fresh set', '', 'The winner was chosen on the first fresh set - its difference there is inflated by the selection. Here - valleys neither the search nor the choice has seen.', '', table(recheck, false), '']
      : []),
    ...(validation
      ? ['## Check on fresh valleys', '', 'The honest estimate: the search hasn\'t seen these valleys.', '', table(validation, false), '', '### Difference vs the base against each opponent', '', 'Packs where this opponent sat at the table; in brackets - how many.', '', byOpponent(validation), '']
      : []),
    `## Best on ${TOP} search valleys`,
    '',
    'Selection on the same valleys inflates the winners\' difference; the check on fresh ones decides.',
    '',
    table(all.slice(0, 30), true),
    '',
    `## In the halving (fewer than ${TOP} valleys)`,
    '',
    table(partial, true),
    '',
  ].join('\n');
  writeFileSync(REPORT, text);
  writeFileSync(originFile, JSON.stringify(Object.fromEntries(origin), null, 1));
}

/* Δ vs the base separately against each opponent of the pool: a style that
   wins at the expense of the weak and loses to the strong is a bad bet on real participants */
function byOpponent(rows: readonly Stat[]): string {
  const label = (o: SeatSpec) => (o.kind === 'nakaz' ? 'nakaz ' : o.kind === 'ours' ? 'ours ' : '') + o.name;
  const head = '| style | ' + POOL.map(label).join(' | ') + ' |';
  const sep = '|---|' + POOL.map(() => '---|').join('');
  const base = played.get(cfg.base);
  const lines = rows.map((s) => {
    const mine = played.get(s.spec);
    const cells = POOL.map((o) => {
      const d: number[] = [];
      for (const [seed, r] of mine ?? []) {
        const b = base?.get(seed);
        const [x, y] = PAIRS[(seed - cfg.from) % PAIRS.length]!;
        if (b && (x === o || y === o) && seed >= cfg.from + FRESH) d.push(r.share - b.share);
      }
      return d.length ? `${fmt(d.reduce((a, c) => a + c, 0) / d.length)} (${d.length})` : '-';
    });
    return `| \`${s.spec}\` | ${cells.join(' | ')} |`;
  });
  return [head, sep, ...lines].join('\n');
}

/* ===== halving ===== */

async function halving(gen: number, candidates: string[], reserveMs: () => number): Promise<boolean> {
  /* the base plays all valleys anyway (ensure) - it needs no place in the halving */
  let alive = candidates.filter((spec) => spec !== cfg.base);
  if (!alive.length) return true;
  for (const [k, n] of RUNGS.entries()) {
    const seeds = rungSeeds(n);
    const need = alive.reduce((s, spec) => s + seeds.filter((x) => !played.get(spec)?.has(x)).length, 0);
    if (Date.now() + costMs(need) > deadline - reserveMs()) return false;
    await ensure(alive, seeds);
    const ranked = alive.map((spec) => stat(spec, seeds)).sort((a, b) => b.delta - a.delta);
    console.log(`generation ${gen}, ${n} valleys: ` + ranked.slice(0, 5).map((s) => `${s.spec} ${fmt(s.delta)}`).join(' | '));
    report(gen);
    if (k < RUNGS.length - 1) alive = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2))).map((s) => s.spec);
  }
  return true;
}

/* the check's winner (if it's not the base) - once more on the second fresh set */
async function recheckWinner(rows: readonly Stat[]): Promise<void> {
  const winner = rows.find((s) => s.spec !== cfg.base);
  if (!winner || winner.delta <= 0) return;
  phase = 'recheck of the winner';
  report(0);
  const seeds = range(0, cfg.validate, (i) => cfg.from + RECHECK + i);
  await ensure([winner.spec], seeds);
  recheck = [winner.spec, cfg.base].map((spec) => stat(spec, seeds)).sort((a, b) => b.delta - a.delta);
}

async function main(): Promise<void> {
  console.log(`search ${cfg.id}: ${hours} h, ${workers} threads; report - ${REPORT}`);
  const freshSeeds = range(0, cfg.validate, freshSeed);
  const reserve = () => costMs((FINALISTS + 1) * cfg.validate);
  for (const spec of cfg.start) note(spec, Object.hasOwn(STYLES, spec) ? 'catalogue' : 'start');
  if (cfg.mode === 'eval') {
    /* a comparison without selection: all candidates and the base on the same fresh valleys */
    phase = 'comparison on fresh valleys';
    report(0);
    await ensure(cfg.start, freshSeeds);
    validation = [...new Set([cfg.base, ...cfg.start])].map((spec) => stat(spec, freshSeeds)).sort((a, b) => b.delta - a.delta);
    await recheckWinner(validation);
    phase = 'done';
    report(0);
    console.log('done: ' + REPORT);
    for (const w of pool) await w.terminate();
    return;
  }
  let gen = 0;
  let more = await halving(gen, cfg.start, reserve);
  while (more) {
    gen++;
    const parents = hall()
      .slice(0, PARENTS)
      .map((s) => s.spec);
    const kids = children(gen, parents);
    if (!kids.length) break;
    more = await halving(gen, kids, reserve);
  }
  phase = 'check on fresh valleys';
  report(gen);
  const finalists = hall()
    .slice(0, FINALISTS)
    .map((s) => s.spec);
  console.log('check: ' + finalists.join(' | '));
  await ensure(finalists, freshSeeds);
  validation = [...new Set([cfg.base, ...finalists])].map((spec) => stat(spec, freshSeeds)).sort((a, b) => b.delta - a.delta);
  await recheckWinner(validation);
  phase = 'done';
  report(gen);
  console.log('done: ' + REPORT);
  for (const w of pool) await w.terminate();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
