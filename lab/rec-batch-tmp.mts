// one-off: record packs of the battle config for the reviewer; part i of n by argv
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { recordMatch } from './server/recorder.ts';
import { matchFile, newRunId, saveMeta } from './server/runs.ts';
import type { RunMeta, SeatSpec, Slot } from './shared/record.ts';

const [part, parts] = process.argv.slice(2).map(Number) as [number, number];
const pool: SeatSpec[] = [
  { kind: 'ours', name: 'полудень' },
  { kind: 'archetype', name: 'рівний' },
  { kind: 'archetype', name: 'облягач' },
  { kind: 'ours', name: 'опортуніст', tactics: ['fill:наш:6'] },
  { kind: 'ours', name: 'рейдер', tactics: ['fill:наш:6'] },
  { kind: 'nakaz', name: 'експансія' },
  { kind: 'ours', name: 'світанок', tactics: ['fill:наш:6', 'nofeed:1200', 'ram:6'] },
];
const pairs: [SeatSpec, SeatSpec][] = [];
for (let i = 1; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) pairs.push([pool[i]!, pool[j]!]);
for (let i = 0; i < 21; i++) {
  if (i % parts !== part) continue;
  const seed = 120000 + i;
  const [a, b] = pairs[i % pairs.length]!;
  const lineup: [SeatSpec, SeatSpec, SeatSpec] = [{ kind: 'ours', name: 'полудень' }, a, b];
  const meta: RunMeta = { id: newRunId(), createdAt: new Date().toISOString(), request: { seed, ticks: 1200, lineup, matches: 3 }, status: 'running', progress: { match: 0, t: 0 } };
  saveMeta(meta);
  const started = Date.now();
  const shares: [number, number, number] = [0, 0, 0];
  meta.matches = [];
  for (let index = 0; index < 3; index++) {
    const rec = recordMatch(index, seed, 1200, lineup);
    writeFileSync(matchFile(meta.id, index), gzipSync(JSON.stringify(rec)));
    const places = {} as Record<Slot, number>;
    const scores = {} as Record<Slot, number>;
    for (const row of rec.result) {
      places[row.slot] = row.place;
      scores[row.slot] = row.score;
      shares[(rec.meta.seating[row.slot] ?? 0) as 0 | 1 | 2] += row.share;
    }
    meta.matches.push({ index, places, scores, seats: [] });
  }
  meta.status = 'done';
  meta.shares = shares;
  meta.ms = Date.now() - started;
  saveMeta(meta);
  console.log('recorded', seed, meta.id, shares.join('/'));
}
