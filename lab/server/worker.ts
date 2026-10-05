/* lab :: worker
   A thread that plays one run: the pack's matches in turn, each written to
   disk, progress - as messages to the main thread. */

import { writeFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import type { RunRequest, SeatLine, Slot } from '../shared/record.ts';
import { recordMatch } from './recorder.ts';
import { matchFile } from './runs.ts';

export interface WorkerJob {
  id: string;
  request: RunRequest;
}

export type WorkerMessage =
  | { type: 'progress'; match: number; t: number }
  | {
      type: 'done';
      shares: [number, number, number];
      matches: { index: number; places: Record<Slot, number>; scores: Record<Slot, number>; seats: SeatLine[] }[];
      ms: number;
    }
  | { type: 'failed'; error: string };

const job = workerData as WorkerJob;
const send = (message: WorkerMessage): void => {
  parentPort?.postMessage(message);
};

try {
  const started = Date.now();
  const { seed, ticks, lineup, matches } = job.request;
  const shares: [number, number, number] = [0, 0, 0];
  const summary: { index: number; places: Record<Slot, number>; scores: Record<Slot, number>; seats: SeatLine[] }[] = [];
  for (let index = 0; index < matches; index++) {
    const record = recordMatch(index, seed, ticks, lineup, (t) => {
      send({ type: 'progress', match: index, t });
    });
    writeFileSync(matchFile(job.id, index), gzipSync(JSON.stringify(record)));
    const places = {} as Record<Slot, number>;
    const scores = {} as Record<Slot, number>;
    const seats: SeatLine[] = [];
    for (const row of record.result) {
      places[row.slot] = row.place;
      scores[row.slot] = row.score;
      const participant = record.meta.seating[row.slot] ?? 0;
      shares[participant as 0 | 1 | 2] += row.share;
      const b = row.breakdown;
      seats.push({
        participant,
        slot: row.slot,
        place: row.place,
        share: row.share,
        score: row.score,
        network: b['network'] ?? 0,
        orders: b['orders'] ?? 0,
        stolen: b['stolen'] ?? 0,
        tax: b['pactTax'] ?? 0,
        lit: row.lit,
        denials: row.denials,
        pulses: row.pulses,
        fills: row.fills,
        nakazTicks: row.nakazTicks,
      });
    }
    summary.push({ index, places, scores, seats });
    send({ type: 'progress', match: index + 1, t: 0 });
  }
  send({ type: 'done', shares, matches: summary, ms: Date.now() - started });
} catch (e) {
  send({ type: 'failed', error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
}
