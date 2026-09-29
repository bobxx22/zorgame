/* lab :: runs
   Запуски лабораторії на диску: runs/<id>/meta.json і по файлу на партію
   (match-<n>.json.gz). Каталог runs/ не комітиться. */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RunMeta, RunRequest } from '../shared/record.ts';

export const RUNS = fileURLToPath(new URL('../runs/', import.meta.url));

const ID = /^[a-z0-9-]{8,40}$/;

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return stamp + '-' + randomBytes(3).toString('hex');
}

export function runDir(id: string): string {
  if (!ID.test(id)) throw new Error('bad run id');
  return join(RUNS, id);
}

export function matchFile(id: string, index: number): string {
  return join(runDir(id), `match-${index + 1}.json.gz`);
}

export function saveMeta(meta: RunMeta): void {
  mkdirSync(runDir(meta.id), { recursive: true });
  writeFileSync(join(runDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 1));
}

export function readMeta(id: string): RunMeta | null {
  const path = join(runDir(id), 'meta.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as RunMeta;
}

export function listRuns(): RunMeta[] {
  if (!existsSync(RUNS)) return [];
  return readdirSync(RUNS)
    .filter((name) => ID.test(name))
    .map((name) => readMeta(name))
    .filter((meta): meta is RunMeta => meta !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteRun(id: string): void {
  rmSync(runDir(id), { recursive: true, force: true });
}

/* запит із панелі: перевірити все, що піде в рушій */
export function parseRequest(body: unknown, known: { presets: string[]; archetypes: string[]; nakaz: string[] }): RunRequest {
  const b = body as Partial<RunRequest> | null;
  if (!b || typeof b !== 'object') throw new Error('body');
  const seed = Number(b.seed);
  const ticks = Number(b.ticks);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2 ** 31) throw new Error('seed');
  if (!Number.isInteger(ticks) || ticks < 10 || ticks > 1200) throw new Error('ticks');
  const matches = b.matches === 1 ? 1 : 3;
  if (!Array.isArray(b.lineup) || b.lineup.length !== 3) throw new Error('lineup');
  const lineup = b.lineup.map((seat) => {
    const kind = seat?.kind;
    const name = String(seat?.name ?? '');
    if (kind === 'ours' && known.presets.includes(name)) return { kind, name };
    if (kind === 'archetype' && known.archetypes.includes(name)) return { kind, name };
    if (kind === 'nakaz' && known.nakaz.includes(name)) return { kind, name };
    if (kind === 'our-nakaz') return { kind, name: 'nakaz.yaml' };
    throw new Error('seat ' + String(kind) + ' ' + name);
  }) as RunRequest['lineup'];
  return { seed, ticks, lineup, matches };
}
