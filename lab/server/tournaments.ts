/* lab :: tournaments
   A tournament - several variants in participant 1's seat on the same valleys
   and with the same opponent pairs. Each variant × valley is an ordinary run
   (a pack of three matches). The comparison is paired: the share difference
   of a variant vs variant 1 on each valley, so the noise of the valley and the opponents cancels out. */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seatText } from '../shared/record.ts';
import type { RunMeta, SeatLine, SeatSpec, Tournament, TournamentRequest, TournamentView, VariantStats } from '../shared/record.ts';
import { newRunId, parseSeat, RUNS } from './runs.ts';
import type { Known } from './runs.ts';

const DIR = join(RUNS, 'tournaments');
const ID = /^[a-z0-9-]{8,40}$/;

export const MAX_PACKS = 600;

export function parseTournament(body: unknown, known: Known): TournamentRequest {
  const b = body as Partial<TournamentRequest> | null;
  if (!b || typeof b !== 'object') throw new Error('body');
  const variants = Array.isArray(b.variants) ? b.variants.map((v) => parseSeat(v, known)) : [];
  const opponents = Array.isArray(b.opponents) ? b.opponents.map((v) => parseSeat(v, known)) : [];
  const seedFrom = Number(b.seedFrom);
  const seeds = Number(b.seeds);
  const ticks = Number(b.ticks);
  if (variants.length < 1 || variants.length > 8) throw new Error('variants: 1-8');
  if (opponents.length < 1 || opponents.length > 12) throw new Error('opponents: 1-12');
  if (!Number.isInteger(seedFrom) || seedFrom < 0 || seedFrom > 2 ** 31 - 1000) throw new Error('seedFrom');
  if (!Number.isInteger(seeds) || seeds < 1 || seeds > 200) throw new Error('seeds: 1-200');
  if (!Number.isInteger(ticks) || ticks < 10 || ticks > 1200) throw new Error('ticks');
  if (variants.length * seeds > MAX_PACKS) throw new Error(`no more than ${MAX_PACKS} packs per tournament`);
  const name = String(b.name ?? '').slice(0, 80);
  return { name, variants, opponents, seedFrom, seeds, ticks };
}

/* opponent pairs: all unordered pairs of the pool, and from a single opponent - a pair of itself */
export function opponentPairs(pool: readonly SeatSpec[]): [SeatSpec, SeatSpec][] {
  if (pool.length === 1) return [[pool[0]!, pool[0]!]];
  const pairs: [SeatSpec, SeatSpec][] = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) pairs.push([pool[i]!, pool[j]!]);
  return pairs;
}

export function saveTournament(t: Tournament): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, t.id + '.json'), JSON.stringify(t));
}

export function readTournament(id: string): Tournament | null {
  if (!ID.test(id)) return null;
  const path = join(DIR, id + '.json');
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Tournament) : null;
}

export function listTournaments(): Tournament[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readTournament(f.slice(0, -5)))
    .filter((t): t is Tournament => t !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteTournament(id: string): void {
  if (ID.test(id)) rmSync(join(DIR, id + '.json'), { force: true });
}

/* a new tournament: runs are created by the server's startRun, here - the schedule */
export function planTournament(request: TournamentRequest, startRun: (seed: number, lineup: [SeatSpec, SeatSpec, SeatSpec], tag: RunMeta['tournament']) => string): Tournament {
  const id = newRunId();
  const pairs = opponentPairs(request.opponents);
  const schedule = Array.from({ length: request.seeds }, (_, i) => pairs[i % pairs.length]!);
  const runs: string[][] = request.variants.map(() => []);
  /* valley by valley, all variants side by side: a partial tournament is already comparable */
  for (let i = 0; i < request.seeds; i++) {
    for (const [v, variant] of request.variants.entries()) {
      const [a, b] = schedule[i]!;
      runs[v]!.push(startRun(request.seedFrom + i, [variant, a, b], { id, variant: v, seed: i }));
    }
  }
  const tournament: Tournament = { id, createdAt: new Date().toISOString(), request, pairs: schedule, runs };
  saveTournament(tournament);
  return tournament;
}

const mean = (a: readonly number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const se = (a: readonly number[]): number => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1) / a.length);
};

/* summary: shares per pack, paired difference vs variant 1, places and score components */
export function viewTournament(t: Tournament, meta: (id: string) => RunMeta | null): TournamentView {
  const status = { queued: 0, running: 0, done: 0, failed: 0 };
  const metas = t.runs.map((row) => row.map((id) => meta(id)));
  for (const row of metas) for (const m of row) if (m) status[m.status]++;
  const grid: (number | null)[][] = Array.from({ length: t.request.seeds }, (_, i) =>
    metas.map((row) => {
      const m = row[i];
      return m?.status === 'done' && m.shares ? m.shares[0] : null;
    }),
  );
  const stats: VariantStats[] = t.request.variants.map((variant, v) => {
    const shares: number[] = [];
    const deltas: number[] = [];
    const lines: SeatLine[] = [];
    const opponents: SeatLine[] = [];
    for (let i = 0; i < t.request.seeds; i++) {
      const own = grid[i]![v];
      if (own === null || own === undefined) continue;
      shares.push(own);
      const base = grid[i]![0];
      if (v > 0 && base !== null && base !== undefined) deltas.push(own - base);
      for (const match of metas[v]![i]?.matches ?? []) {
        for (const seat of match.seats ?? []) (seat.participant === 0 ? lines : opponents).push(seat);
      }
    }
    const pick = (f: (s: SeatLine) => number) => mean(lines.map(f));
    return {
      variant: v,
      label: seatText(variant),
      done: shares.length,
      total: t.request.seeds,
      mean: mean(shares),
      se: se(shares),
      min: shares.length ? Math.min(...shares) : 0,
      max: shares.length ? Math.max(...shares) : 0,
      delta: v > 0 && deltas.length ? { mean: mean(deltas), se: se(deltas), n: deltas.length } : null,
      places: [1, 2, 3].map((p) => lines.filter((s) => s.place === p).length) as [number, number, number],
      score: pick((s) => s.score),
      network: pick((s) => s.network),
      orders: pick((s) => s.orders),
      stolen: pick((s) => s.stolen),
      tax: pick((s) => s.tax),
      lit: pick((s) => s.lit),
      denials: pick((s) => s.denials),
      pulses: pick((s) => s.pulses),
      fills: pick((s) => s.fills),
      nakazTicks: pick((s) => s.nakazTicks),
      opponentScore: mean(opponents.map((s) => s.score)),
    };
  });
  return { tournament: t, stats, grid, status };
}
