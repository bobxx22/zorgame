/* lab :: search
   Нічний пошук стилю голови. Наш бот (з типовими надбудовами) грає різними
   стилями (bot/src/styles.ts) на тих самих долинах проти тих самих пар
   архетипів SDK; мірило - парна різниця часток за пакет зі стилем-основою.

   Покоління - відсів половинами: усі кандидати на 30 долинах, краща половина
   ще на 30, далі на 120 (шум парної різниці - 1.1-1.8 частки за пакет, на 10
   долинах відсів був би жеребом). Покоління 0 - --start або весь каталог;
   далі кращі за весь час стають батьками: наступне покоління - їхні мутації і
   схрещення. Коли часу лишається лише на перевірку, п'ятеро кращих і основа
   грають на свіжих долинах, яких пошук не бачив: відбір на тих самих долинах
   завищує різницю переможця, свіжі долини показують чесну.

   Запуск (з каталогу lab/):
     npm run search -- --hours 8
     npm run search -- --resume <id> --hours 3   продовжити; зігране не повторюється
   Прапорці: --hours 8, --workers <ядра-1>, --from 5000 (перша долина),
   --validate 60 (свіжих долин), --base <стиль бою>, --ticks 1200,
   --start стиль;стиль;... (покоління 0; типово - весь каталог),
   --pool arch|mixed (суперники: пари архетипів SDK або змішаний пул).

   Змішаний пул - на випадок, коли стиль «заточився» під архетипи SDK: наш
   бот у бойовій конфігурації (самогра), архетипи рівний і облягач (шаблон
   учасника), стилі рушія опортуніст і рейдер у нашій обгортці і бот, чий
   слот увесь матч веде наказ експансія (учасник, чий бот не запустився).

   Результати: runs/search/<id>/results.ndjson (пакет на рядок),
   report.md (таблиця кращих, оновлюється після кожного кроку). Ctrl+C
   безпечний: кожен пакет пишеться, щойно зіграний. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { ARCHETYPES } from '@zoria/sdk';
import { DEFAULT_PRESET, DEFAULT_TACTICS } from '../../bot/dist/strategy.js';
import { fullStyle, KNOB_MAX, KNOBS, parseStyle, STYLES, styleSpec } from '../../bot/dist/styles.js';
import type { Knob, Style } from '../../bot/dist/styles.js';
import type { SeatSpec } from '../shared/record.ts';
import type { PackSeat } from './play.ts';
import { newRunId, RUNS } from './runs.ts';
import type { SearchJob, SearchReply } from './search-worker.ts';

/* ===== прапорці ===== */

function flags(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error('незрозумілий аргумент ' + a);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error('прапорцю ' + a + ' бракує значення');
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
  pool: 'arch' | 'mixed';
  /* суперники, закріплені на старті: зміна стилю бою не міняє пул продовження */
  opponents: SeatSpec[];
}

const RUNGS = [30, 60, 120];
const TOP = RUNGS[RUNGS.length - 1]!;
const PARENTS = 4;
const CHILDREN = 8;
const FINALISTS = 5;
/* свіжі долини - далеко від пошукових */
const FRESH = 100_000;

function poolOf(pool: Config['pool']): SeatSpec[] {
  if (pool === 'arch') return Object.keys(ARCHETYPES).map((name) => ({ kind: 'archetype', name }));
  const tactics = DEFAULT_TACTICS.split(',');
  return [
    { kind: 'ours', name: DEFAULT_PRESET, tactics },
    { kind: 'archetype', name: 'рівний' },
    { kind: 'archetype', name: 'облягач' },
    { kind: 'ours', name: 'опортуніст', tactics },
    { kind: 'ours', name: 'рейдер', tactics },
    { kind: 'nakaz', name: 'експансія' },
  ];
}

const f = flags(process.argv.slice(2));
const known = new Set(['hours', 'workers', 'from', 'validate', 'base', 'ticks', 'resume', 'start', 'pool']);
for (const k of Object.keys(f)) if (!known.has(k)) throw new Error('прапорця --' + k + ' немає');
const hours = Number(f['hours'] ?? 8);
const workers = Number(f['workers'] ?? Math.max(1, availableParallelism() - 1));
if (!(hours > 0 && hours <= 48)) throw new Error('--hours: 0-48');
if (!Number.isInteger(workers) || workers < 1 || workers > 64) throw new Error('--workers: 1-64');

const DIR = join(RUNS, 'search');
let cfg: Config;
if (f['resume']) {
  const path = join(DIR, f['resume'], 'config.json');
  if (!/^[a-z0-9-]{8,40}$/.test(f['resume']) || !existsSync(path)) throw new Error('пошуку ' + f['resume'] + ' немає');
  cfg = JSON.parse(readFileSync(path, 'utf8')) as Config;
  cfg.start ??= Object.keys(STYLES);
  cfg.pool ??= 'arch';
  cfg.opponents ??= poolOf('arch');
} else {
  cfg = {
    id: newRunId(),
    base: f['base'] ?? DEFAULT_PRESET,
    from: Number(f['from'] ?? 5000),
    ticks: Number(f['ticks'] ?? 1200),
    validate: Number(f['validate'] ?? 60),
    tactics: DEFAULT_TACTICS.split(','),
    /* стилі-рядки мають коми, тож список - через крапку з комою */
    start: f['start'] ? f['start'].split(';').map((x) => x.trim()).filter(Boolean) : Object.keys(STYLES),
    pool: (f['pool'] ?? 'arch') as Config['pool'],
    opponents: [],
  };
  if (cfg.pool !== 'arch' && cfg.pool !== 'mixed') throw new Error('--pool: arch або mixed');
  cfg.opponents = poolOf(cfg.pool);
  for (const spec of cfg.start) if (!parseStyle(spec)) throw new Error('--start: незрозумілий стиль ' + spec);
  if (!Object.hasOwn(STYLES, cfg.base)) throw new Error('--base: одне з ' + Object.keys(STYLES).join(', '));
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

/* ===== суперники: усі пари пулу, пара долини - за її номером ===== */

const POOL: SeatSpec[] = cfg.opponents;

const PAIRS: [SeatSpec, SeatSpec][] = [];
for (let i = 0; i < POOL.length; i++) for (let j = i + 1; j < POOL.length; j++) PAIRS.push([POOL[i]!, POOL[j]!]);

const searchSeed = (i: number): number => cfg.from + i;
const freshSeed = (i: number): number => cfg.from + FRESH + i;
function lineupOf(spec: string, seed: number): [SeatSpec, SeatSpec, SeatSpec] {
  const [a, b] = PAIRS[(seed - cfg.from) % PAIRS.length]!;
  return [{ kind: 'ours', name: spec, tactics: cfg.tactics }, a, b];
}

/* ===== зігране: спец -> долина -> наше місце ===== */

interface Row {
  spec: string;
  seed: number;
  share: number;
  places: number[];
  score: number;
  denials: number;
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
/* зігране раніше (--resume); обірваний рядок наприкінці - пакет, що не дописався при зупинці */
let pastPacks = 0;
let pastMs = 0;
if (existsSync(RESULTS)) {
  const text = readFileSync(RESULTS, 'utf8');
  /* обірваний хвіст закрити, інакше наступний пакет доклеїться до нього і загубиться */
  if (text && !text.endsWith('\n')) appendFileSync(RESULTS, '\n');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Row;
      remember(row);
      pastPacks++;
      pastMs += row.ms;
    } catch {
      console.log('пропускаю обірваний рядок журналу');
    }
  }
}
const originFile = join(HOME, 'origin.json');
if (existsSync(originFile)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(originFile, 'utf8')) as Record<string, string>)) origin.set(k, v);
function note(spec: string, why: string): void {
  if (!origin.has(spec)) origin.set(spec, why);
}

/* ===== пул потоків ===== */

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
    console.error('потік упав: ' + (e.stack ?? e.message));
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
      const row: Row = { spec, seed, share: s.share, places: s.places, score: Math.round(s.score * 10) / 10, denials: s.denials, nakazTicks: s.nakazTicks, ms: r.ms };
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

/* усі пари (спец, долина), яких ще немає; основа - завжди */
async function ensure(specs: readonly string[], seeds: readonly number[]): Promise<void> {
  const todo: Promise<Row>[] = [];
  for (const spec of new Set([cfg.base, ...specs])) for (const seed of seeds) if (!played.get(spec)?.has(seed)) todo.push(play(spec, seed));
  await Promise.all(todo);
}

/* скільки мс займе цей обсяг пакетів на всіх потоках; мірило - і зігране до --resume;
   до першого пакета взагалі - невідомо, нуль */
function costMs(n: number): number {
  const count = packs + pastPacks;
  return count ? (n * (packMs + pastMs)) / count / workers : 0;
}

/* ===== мірило ===== */

interface Stat {
  spec: string;
  n: number;
  mean: number;
  delta: number;
  se: number;
  first: number;
  nakaz: number;
  denials: number;
  /* пакетів, зіграних точнісінько як основа: стиль нічого не змінив */
  same: number;
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
  }
  const n = d.length;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
  const m = mean(d);
  const se = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) / n) : 0;
  return { spec, n, mean: mean(shares), delta: m, se, first: matches ? first / matches : 0, nakaz: n ? nakaz / n : 0, denials: n ? denials / n : 0, same };
}
const range = (from: number, n: number, seed: (i: number) => number): number[] => Array.from({ length: n }, (_, i) => seed(from + i));
const rungSeeds = (n: number) => range(0, n, searchSeed);

/* ===== потомство ===== */

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

/* klinok - поріг частки клинків у рої (верф: клинків/юнитів < klinok). Рій
   ваги 8 - це 2-8 юнитів, і досяжні частки - 1/6, 1/5, 1/4, 1/3, 2/5, 1/2,
   3/5, 2/3: будь-які два значення між сусідніми частками грають однаково
   (klinok 0.35 і 0.5 дали 60 з 60 однакових пакетів). Тож - лише ступені */
const KLINOK_STEPS = [0.1, 0.18, 0.22, 0.3, 0.37, 0.45, 0.55, 0.63];
/* guard і pact - пороги жеребу: крок 0.05 міняє виліт лише зрідка */
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
        /* нуль множенням не зрушиш: спляча ручка прокидається з імовірністю */
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
      /* land - необов'язкова: з'являється, крокує або зникає */
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

function children(gen: number, parents: readonly string[]): string[] {
  const r = rng(gen * 7919 + 17);
  const out: string[] = [];
  let tries = 0;
  while (out.length < CHILDREN && tries++ < 500) {
    const p = parents[Math.floor(r() * parents.length)]!;
    const pst = parseStyle(p)!;
    let st: Style;
    let why: string;
    if (r() < 0.33 && parents.length > 1) {
      const q = parents[Math.floor(r() * parents.length)]!;
      if (q === p) continue;
      st = cross(pst, parseStyle(q)!, r);
      if (r() < 0.5) st = mutate(st, r);
      why = 'покоління ' + gen + ': схрещення ' + p + ' × ' + q;
    } else {
      st = mutate(pst, r);
      why = 'покоління ' + gen + ': мутація ' + p;
    }
    const spec = styleSpec(baseOf(p), st);
    if (played.has(spec) || out.includes(spec) || !parseStyle(spec)) continue;
    note(spec, why);
    out.push(spec);
  }
  return out;
}

/* ===== звіт ===== */

const fmt = (x: number, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
function hall(): Stat[] {
  const seeds = rungSeeds(TOP);
  return [...played.keys()]
    .map((spec) => stat(spec, seeds))
    .filter((s) => s.n >= TOP)
    .sort((a, b) => b.delta - a.delta);
}
function table(rows: readonly Stat[], showOrigin: boolean): string {
  const head = '| # | стиль | долин | частка | різниця з основою | як основа | 1-ші місця | наказ, тактів | відмов за пакет |' + (showOrigin ? ' звідки |' : '');
  const sep = '|---|---|---|---|---|---|---|---|---|' + (showOrigin ? '---|' : '');
  const lines = rows.map(
    (s, i) =>
      `| ${i + 1} | \`${s.spec}\` | ${s.n} | ${s.mean.toFixed(2)} | ${fmt(s.delta)} ± ${s.se.toFixed(2)} | ${s.same} | ${(s.first * 100).toFixed(0)}% | ${s.nakaz.toFixed(1)} | ${s.denials.toFixed(1)} |` +
      (showOrigin ? ` ${origin.get(s.spec) ?? ''} |` : ''),
  );
  return [head, sep, ...lines].join('\n');
}
let validation: Stat[] | null = null;
let phase = 'пошук';
function report(gen: number): void {
  const mins = (Date.now() - started) / 60_000;
  const all = hall();
  const partial = [...played.keys()]
    .map((spec) => stat(spec, rungSeeds(TOP)))
    .filter((s) => s.n > 0 && s.n < TOP)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 15);
  const text = [
    `# Нічний пошук стилю ${cfg.id}`,
    '',
    `Основа: \`${cfg.base}\`, надбудови: \`${cfg.tactics.join(',')}\`. Суперники: ${cfg.pool === 'mixed' ? 'змішаний пул (наш бот, рівний, облягач, опортуніст, рейдер, наказ експансія)' : 'пари архетипів SDK'} по черзі. Долини пошуку ${cfg.from}-${cfg.from + TOP - 1}, свіжі - з ${cfg.from + FRESH}.`,
    '',
    `Етап: **${phase}**, покоління ${gen}. Зіграно пакетів: ${packs} за цей запуск (усього в журналі ${[...played.values()].reduce((s, m) => s + m.size, 0)}), ${mins.toFixed(0)} хв, пакет у середньому ${(packs ? packMs / packs / 1000 : 0).toFixed(1)} с на потік, потоків ${workers}.`,
    '',
    'Частка - середні очки за пакет (3-9). Різниця - парна: частка стилю мінус частка основи на тій самій долині, ± стандартна похибка. Різниця більша за дві похибки - уже не випадок. «Як основа» - пакетів, зіграних точнісінько як основа: якщо їх більшість, різниця - кілька випадкових пакетів.',
    '',
    ...(validation
      ? ['## Перевірка на свіжих долинах', '', 'Чесна оцінка: ці долини пошук не бачив.', '', table(validation, false), '']
      : []),
    `## Кращі на ${TOP} долинах пошуку`,
    '',
    'Відбір на тих самих долинах завищує різницю переможців; вирішує перевірка на свіжих.',
    '',
    table(all.slice(0, 30), true),
    '',
    `## У відсіві (менше ${TOP} долин)`,
    '',
    table(partial, true),
    '',
  ].join('\n');
  writeFileSync(REPORT, text);
  writeFileSync(originFile, JSON.stringify(Object.fromEntries(origin), null, 1));
}

/* ===== відсів половинами ===== */

async function halving(gen: number, candidates: string[], reserveMs: () => number): Promise<boolean> {
  /* основа грає всі долини й так (ensure) - місце у відсіві їй не потрібне */
  let alive = candidates.filter((spec) => spec !== cfg.base);
  if (!alive.length) return true;
  for (const [k, n] of RUNGS.entries()) {
    const seeds = rungSeeds(n);
    const need = alive.reduce((s, spec) => s + seeds.filter((x) => !played.get(spec)?.has(x)).length, 0);
    if (Date.now() + costMs(need) > deadline - reserveMs()) return false;
    await ensure(alive, seeds);
    const ranked = alive.map((spec) => stat(spec, seeds)).sort((a, b) => b.delta - a.delta);
    console.log(`покоління ${gen}, ${n} долин: ` + ranked.slice(0, 5).map((s) => `${s.spec} ${fmt(s.delta)}`).join(' | '));
    report(gen);
    if (k < RUNGS.length - 1) alive = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2))).map((s) => s.spec);
  }
  return true;
}

async function main(): Promise<void> {
  console.log(`пошук ${cfg.id}: ${hours} год, потоків ${workers}; звіт - ${REPORT}`);
  const freshSeeds = range(0, cfg.validate, freshSeed);
  const reserve = () => costMs((FINALISTS + 1) * cfg.validate);
  for (const spec of cfg.start) note(spec, Object.hasOwn(STYLES, spec) ? 'каталог' : 'старт');
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
  phase = 'перевірка на свіжих долинах';
  report(gen);
  const finalists = hall()
    .slice(0, FINALISTS)
    .map((s) => s.spec);
  console.log('перевірка: ' + finalists.join(' | '));
  await ensure(finalists, freshSeeds);
  validation = [...new Set([cfg.base, ...finalists])].map((spec) => stat(spec, freshSeeds)).sort((a, b) => b.delta - a.delta);
  phase = 'готово';
  report(gen);
  console.log('готово: ' + REPORT);
  for (const w of pool) await w.terminate();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
  process.exit(1);
});
