/* lab :: search-worker
   Потік нічного пошуку: бере пакети по одному з головного потоку і віддає
   підсумок. Живе весь пошук - рушій і бот завантажуються один раз. */

import { parentPort } from 'node:worker_threads';
import type { SeatSpec } from '../shared/record.ts';
import { playPack } from './play.ts';
import type { PackSeat } from './play.ts';

export interface SearchJob {
  key: number;
  seed: number;
  ticks: number;
  lineup: [SeatSpec, SeatSpec, SeatSpec];
}

export type SearchReply = { key: number; ok: true; seats: PackSeat[]; ms: number } | { key: number; ok: false; error: string };

parentPort?.on('message', (job: SearchJob) => {
  const started = Date.now();
  let reply: SearchReply;
  try {
    reply = { key: job.key, ok: true, seats: playPack(job.seed, job.ticks, job.lineup), ms: Date.now() - started };
  } catch (e) {
    reply = { key: job.key, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
  }
  parentPort?.postMessage(reply);
});
