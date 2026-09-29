/* lab :: recorder
   Партія в процесі тим самим рушієм, що й у вузлі, з кадром на кожен такт.
   Нашого бота бере зібраний bot/dist (та сама стратегія, що грає на вузлі),
   суперників - дзеркала архетипів SDK або зразки наказу. Запис - формат
   shared/record.ts. */

import { readFileSync } from 'node:fs';
import { createEngine } from '@zoria/engine';
import { openMatch, placementShares, sampleBot } from '@zoria/sdk';
import type { EngineFull, WireBot } from '@zoria/sdk';
import { createNakazSparring, NAKAZ_SAMPLES, NakazGuard } from '@zoria/sdk/nakaz';
import type { SampleName } from '@zoria/sdk/nakaz';
import { decodeManifest, decodeObserve, decodeOrders } from '@zoria/protocol';
import type { Order } from '@zoria/protocol';
import { createStrategy, parseTactics } from '../../bot/dist/strategy.js';
import type { PulseStrategy } from '../../bot/dist/strategy.js';
import { seatText, SLOTS, TASKS } from '../shared/record.ts';
import type {
  Actor,
  Contract,
  Eye,
  Frame,
  MatchRecord,
  MatchStatic,
  NeedleRow,
  PlayerRow,
  SeatResult,
  SeatSpec,
  Slot,
  UnitRow,
} from '../shared/record.ts';

const OUR_NAKAZ = new URL('../../bot/nakaz.yaml', import.meta.url);
const ACTORS: readonly Actor[] = ['A', 'B', 'C', 'K'];

/* наш бот: WireBot, що запам'ятовує останній кадр спостереження */
interface Ours extends WireBot {
  strategy: PulseStrategy;
  lastObserve: Uint8Array | null;
}

/* наказ місця, як його бере вузол: наш бот - bot/nakaz.yaml, архетип - «черепаха»
   (kit/src/rival.mjs), наказ - він сам */
function seatNakaz(spec: SeatSpec): string {
  if (spec.kind === 'ours' || spec.kind === 'our-nakaz') return readFileSync(OUR_NAKAZ, 'utf8');
  if (spec.kind === 'nakaz') return NAKAZ_SAMPLES[spec.name as SampleName];
  return NAKAZ_SAMPLES['черепаха'];
}

function makeBot(spec: SeatSpec): WireBot | Ours {
  if (spec.kind === 'archetype') return sampleBot(createEngine, spec.name);
  if (spec.kind === 'nakaz') return createNakazSparring(NAKAZ_SAMPLES[spec.name as SampleName]);
  if (spec.kind === 'our-nakaz') return createNakazSparring(readFileSync(OUR_NAKAZ, 'utf8'));
  const strategy = createStrategy(spec.name, () => undefined, parseTactics(spec.tactics ?? []));
  const ours: Ours = {
    strategy,
    lastObserve: null,
    init: (manifest, slot) => {
      strategy.init(manifest, slot);
    },
    tick: (observe) => {
      ours.lastObserve = observe;
      return strategy.tick(observe);
    },
    feedback: (verdicts) => {
      strategy.feedback?.(verdicts);
    },
  };
  return ours;
}

function staticOf(manifest: Uint8Array): MatchStatic {
  const m = decodeManifest(manifest);
  if (!m) throw new Error('manifest does not decode');
  const R = m.terrain.radius - 1;
  const typeAt = new Map(m.terrain.cells.map(([q, r, type]) => [q + ',' + r, type]));
  const cells: [number, number, number, number][] = [];
  let i = 0;
  // the order of manifest.levels: r ascending, then q ascending (protocol bridge.js)
  for (let r = -R; r <= R; r++) {
    for (let q = -R; q <= R; q++) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > R) continue;
      cells.push([q, r, typeAt.get(q + ',' + r) ?? 0, m.levels[i] ?? 0]);
      i++;
    }
  }
  return {
    radius: R,
    types: m.terrain.types.map((t) => t.name),
    cells,
    needles: m.needles.map((n) => ({ k: n.q + ',' + n.r, q: n.q, r: n.r, start: n.start, ring: n.ring })),
    seats: { A: m.seats[0], B: m.seats[1], C: m.seats[2] },
    citadel: m.citadel,
    cherta: m.cherta,
    finds: m.finds.map((f) => ({ kind: f.kind, q: f.q, r: f.r })),
    lots: m.lots.map((l) => ({ at: l.at, cells: l.cells.map((c) => ({ q: c.q, r: c.r })) })),
    storms: m.storms.map((s) => ({ x0: s.x0, y0: s.y0, vx: s.vx, vy: s.vy, r: s.r })),
    dawn: m.dawn.at,
    linkRange: m.cfg['linkRange'] ?? 5,
  };
}

const keyHex = (key: string | null | undefined): [number, number] | null => {
  if (!key) return null;
  const [q, r] = key.split(',').map(Number);
  return q === undefined || r === undefined || Number.isNaN(q) || Number.isNaN(r) ? null : [q, r];
};

interface EngineUnitTask {
  goal?: string | null;
  path?: { q: number; r: number }[];
  jam?: string | null;
  feed?: string | null;
  site?: string | null;
  ram?: string | null;
  home?: boolean;
}

function unitRow(u: EngineFull['SIM']['units'][number] & Record<string, unknown>, find: (id: string) => { q: number; r: number } | null): UnitRow {
  const task = (u.task ?? null) as EngineUnitTask | null;
  let kind = 0;
  let target: [number, number] | null = null;
  if (task) {
    if (task.site) [kind, target] = [TASKS.indexOf('needle'), keyHex(task.site)];
    else if (task.feed) [kind, target] = [TASKS.indexOf('feed'), keyHex(task.feed)];
    else if (task.jam) [kind, target] = [TASKS.indexOf('jam'), keyHex(task.jam)];
    else if (task.ram) {
      const victim = find(task.ram);
      [kind, target] = [TASKS.indexOf('ram'), victim ? [victim.q, victim.r] : null];
    } else if (task.path && task.path.length > 0) {
      const last = task.path[task.path.length - 1]!;
      [kind, target] = [task.home ? TASKS.indexOf('home') : TASKS.indexOf('move'), [last.q, last.r]];
    }
  }
  const flags = (u.mute ? 1 : 0) | (typeof u['away'] === 'number' && (u['away'] as number) > 0 ? 2 : 0);
  return [u.id, u.p as Actor, u.cls === 'клинок' ? 1 : 0, u.q, u.r, kind, target?.[0] ?? null, target?.[1] ?? null, flags];
}

type World = EngineFull['SIM']['world'] & {
  heat: Record<string, Record<string, number>>;
  emb: Record<string, number>;
  crown: Record<string, Record<string, number>>;
  fed: Record<string, string>;
};

function frameOf(E: EngineFull, t: number, events: Record<string, unknown>[], tapped: Map<Slot, Order[]>, denied: Map<Slot, [number, number][]>): Frame {
  const S = E.SIM;
  const w = S.world as World;
  const alive = S.units.filter((u) => !u.dead);
  const where = new Map(alive.map((u) => [u.id, { q: u.q, r: u.r }]));
  const p = {} as Record<Actor, PlayerRow>;
  for (const a of ACTORS) {
    p[a] = [
      a === 'K' ? 0 : E.simScore(a),
      w.minutes[a] ?? 0,
      w.energy[a] ?? 0,
      w.needles[a] ?? 0,
      Object.keys(w.lit[a] ?? {}).length,
      alive.filter((u) => u.p === a).length,
      w.chan[a] ?? 0,
      w.chanAt[a] ?? 0,
      w.ear[a] ?? 0,
      w.earAt[a] ?? 0,
    ];
  }
  const n: NeedleRow[] = [];
  for (const [key, owner] of Object.entries(w.own)) {
    const weight = w.lit[owner]?.[key] ?? 0;
    const flags =
      (w.jam[key] ? 1 : 0) | (w.crown[owner]?.[key] ? 2 : 0) | (w.fed[key] ? 4 : 0) | ((w.emb[key] ?? 8) < 8 ? 8 : 0);
    n.push([key, owner as Actor, Math.round(weight * 1000) / 1000, flags]);
  }
  const heat: [string, Actor, number][] = [];
  for (const [key, by] of Object.entries(w.heat ?? {})) {
    for (const [a, progress] of Object.entries(by ?? {})) heat.push([key, a as Actor, Math.round(progress * 100) / 100]);
  }
  const eye: Partial<Record<Slot, Eye>> = {};
  for (const s of SLOTS) {
    const watch = w.watch[s];
    const shot = w.shot[s];
    eye[s] = {
      watch: watch ? { q: watch.q, r: watch.r } : null,
      scan: shot && shot.t === t ? { q: shot.q, r: shot.r, rad: shot.rad } : null,
    };
  }
  const order: Contract | null = S.order
    ? {
        cells: [...S.order.cells],
        from: S.order.from,
        to: S.order.to,
        progress: Object.fromEntries(Object.entries(S.order.progress).map(([s, v]) => [s, { ticks: v?.ticks ?? 0, reason: v?.reason ?? null }])),
      }
    : null;
  return {
    t,
    p,
    n,
    u: alive.map((u) => unitRow(u as never, (id) => where.get(id) ?? null)),
    heat,
    ev: events,
    ord: Object.fromEntries(tapped),
    den: Object.fromEntries(denied),
    eye,
    order,
    dawn: (w.dawn ?? 0) > 0,
  };
}

export interface MatchProgress {
  (t: number): void;
}

/* одна партія: учасники пакета сидять на місцях за пересадкою правил 25.1 */
export function recordMatch(
  index: number,
  seed: number,
  ticks: number,
  lineup: readonly [SeatSpec, SeatSpec, SeatSpec],
  onTick: MatchProgress = () => undefined,
): MatchRecord {
  const seating = {} as Record<Slot, number>;
  const labels = {} as Record<Slot, string>;
  const bots: Partial<Record<Slot, WireBot>> = {};
  const guards = new Map<Slot, NakazGuard>();
  let ours: { slot: Slot; bot: Ours } | null = null;
  for (let k = 0; k < 3; k++) {
    const slot = SLOTS[(k + index) % 3]!;
    const spec = lineup[k]!;
    const bot = makeBot(spec);
    seating[slot] = k;
    labels[slot] = seatText(spec);
    /* як на вузлі: шість тактів мовчання - і слот веде наказ місця (правила 23.2) */
    const guard = new NakazGuard(bot, seatNakaz(spec));
    guards.set(slot, guard);
    bots[slot] = guard;
    if (spec.kind === 'ours' && !ours) ours = { slot, bot: bot as Ours };
  }

  const tapped = new Map<Slot, Order[]>();
  const denied = new Map<Slot, [number, number][]>();
  const match = openMatch(createEngine, {
    seed,
    ticks,
    bots,
    roster: labels,
    tapOrders: (_t, slot, bytes) => {
      tapped.set(slot as Slot, decodeOrders(bytes) ?? []);
    },
    tapDenies: (_t, slot, denies) => {
      denied.set(
        slot as Slot,
        denies.filter(([, code]) => code !== 0),
      );
    },
  });
  const E = match.engine;
  const stat = staticOf(match.manifest);
  const frames: Frame[] = [];
  let logSeen = E.SIM.log.length;
  frames.push(frameOf(E, 0, [], tapped, denied));

  while (!match.done()) {
    tapped.clear();
    denied.clear();
    match.step();
    const t = match.t();
    const log = E.SIM.log;
    const events = (log.length >= logSeen ? log.slice(logSeen) : log.filter((e) => e['t'] === t)).map(({ key: _key, ...rest }) => rest);
    logSeen = log.length;
    const frame = frameOf(E, t, events, tapped, denied);
    if (ours) {
      const obs = ours.bot.lastObserve ? decodeObserve(ours.bot.lastObserve) : null;
      if (obs) {
        frame.seen = {
          foe: obs.foe.map((f) => [f.id, f.p, f.q, f.r]),
          noisy: obs.noisy.map((h) => [h.q, h.r]),
        };
      }
      frame.pulse = ours.bot.strategy.lastPulse ?? null;
      frame.src = [...ours.bot.strategy.lastSources];
    }
    frames.push(frame);
    if (t % 25 === 0) onTick(t);
  }

  const summary = match.summary();
  const rows = SLOTS.map((s) => ({ score: summary.score[s], lit: summary.lit[s], energy: summary.energy[s], needles: summary.needles[s] }));
  const shares = placementShares(rows);
  const placeOf = (s: Slot): number => 1 + SLOTS.filter((o) => o !== s && (summary.score[o] ?? 0) > (summary.score[s] ?? 0)).length;
  const result: SeatResult[] = SLOTS.map((s, i) => {
    let orders = 0;
    let denials = 0;
    let pulses = 0;
    let fills = 0;
    for (const f of frames.slice(1)) {
      orders += f.ord[s]?.length ?? 0;
      denials += f.den[s]?.length ?? 0;
      if (s === ours?.slot && f.pulse) pulses++;
      if (s === ours?.slot && f.src?.includes('fill')) fills++;
    }
    const guard = guards.get(s);
    return {
      slot: s,
      score: summary.score[s] ?? 0,
      place: placeOf(s),
      share: shares[i] ?? 0,
      breakdown: { ...summary.breakdown[s] } as unknown as Record<string, number>,
      lit: summary.lit[s] ?? 0,
      energy: summary.energy[s] ?? 0,
      needles: summary.needles[s] ?? 0,
      denials,
      orders,
      pulses,
      fills,
      nakazTicks: guard?.nakazTicks ?? 0,
      nakazEpisodes: (guard?.episodes ?? []).map((e) => ({ from: e.from, to: e.to })),
    };
  });

  return {
    v: 1,
    meta: { index, seed, ticks, engine: E.ENGINE_HASH, seating, labels, ours: ours?.slot ?? null },
    static: stat,
    frames,
    result,
  };
}
