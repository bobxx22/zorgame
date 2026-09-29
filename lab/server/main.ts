/* lab :: main
   Локальний сервер лабораторії: API запусків і сама панель (dist-web).
   Слухає лише 127.0.0.1. Партії грають потоки (worker_threads), не більше
   ніж ядер мінус одне одночасно.

     GET    /api/options             пресети, архетипи, зразки наказу, рушій
     GET    /api/runs                запуски, найсвіжіші згори
     POST   /api/runs                новий запуск (RunRequest)
     GET    /api/runs/:id            стан запуску
     DELETE /api/runs/:id            видалити запуск із записами
     GET    /api/runs/:id/match/:n   запис партії n (1-3), gzip
     GET    /api/tournaments         турніри
     POST   /api/tournaments         новий турнір (TournamentRequest)
     GET    /api/tournaments/:id     зведення турніру (TournamentView)
     DELETE /api/tournaments/:id     видалити турнір і його запуски */

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { availableParallelism } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { ENGINE_HASH } from '@zoria/engine';
import { ARCHETYPES } from '@zoria/sdk';
import { NAKAZ_SAMPLES } from '@zoria/sdk/nakaz';
import { FILL_CHARTERS, presets } from '../../bot/dist/strategy.js';
import type { LabOptions, RunMeta, RunRequest, SeatSpec } from '../shared/record.ts';
import { deleteRun, listRuns, matchFile, newRunId, parseRequest, readMeta, saveMeta } from './runs.ts';
import { deleteTournament, listTournaments, parseTournament, planTournament, readTournament, viewTournament } from './tournaments.ts';
import type { WorkerJob, WorkerMessage } from './worker.ts';

const PORT = Number(process.env['LAB_PORT'] ?? 4747);
const WEB = fileURLToPath(new URL('../dist-web/', import.meta.url));
const CPUS = availableParallelism();
const PARALLEL = Math.max(1, CPUS - 1);

const options: LabOptions = {
  presets: presets(),
  archetypes: Object.keys(ARCHETYPES),
  nakaz: Object.keys(NAKAZ_SAMPLES),
  charters: [...FILL_CHARTERS],
  engine: ENGINE_HASH,
  cpus: CPUS,
};

/* черга запусків: живий стан тримається тут, на диск - на кожен крок */
const live = new Map<string, RunMeta>();
const queue: string[] = [];
let running = 0;

function pump(): void {
  while (running < PARALLEL && queue.length > 0) {
    const id = queue.shift()!;
    const meta = live.get(id);
    if (!meta) continue;
    running++;
    meta.status = 'running';
    saveMeta(meta);
    const job: WorkerJob = { id, request: meta.request };
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: job });
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') meta.progress = { match: message.match, t: message.t };
      else if (message.type === 'done') {
        meta.status = 'done';
        meta.shares = message.shares;
        meta.matches = message.matches;
        meta.ms = message.ms;
        saveMeta(meta);
      } else {
        meta.status = 'failed';
        meta.error = message.error;
        saveMeta(meta);
      }
    });
    worker.on('error', (e) => {
      meta.status = 'failed';
      meta.error = e.stack ?? e.message;
      saveMeta(meta);
    });
    worker.on('exit', () => {
      running--;
      if (meta.status === 'running') {
        meta.status = 'failed';
        meta.error = meta.error ?? 'worker exited';
        saveMeta(meta);
      }
      pump();
    });
  }
}

function startRun(request: RunRequest, tournament?: RunMeta['tournament']): RunMeta {
  const meta: RunMeta = { id: newRunId(), createdAt: new Date().toISOString(), request, status: 'queued', progress: { match: 0, t: 0 } };
  if (tournament) meta.tournament = tournament;
  saveMeta(meta);
  live.set(meta.id, meta);
  queue.push(meta.id);
  pump();
  return meta;
}

function json(res: ServerResponse, code: number, value: unknown): void {
  const text = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  return new Promise((ok, bad) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        bad(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        bad(new Error('json'));
      }
    });
    req.on('error', bad);
  });
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

function serveStatic(res: ServerResponse, path: string): void {
  const safe = normalize(path).replace(/^([/\\])+/, '');
  let file = join(WEB, safe);
  if (!file.startsWith(WEB) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Панель не зібрана: npm run build (або npm start) у каталозі lab.');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') {
    serveStatic(res, url.pathname);
    return;
  }
  const [, what, id, sub, n] = parts;
  if (req.method === 'GET' && what === 'options') return json(res, 200, options);
  if (what === 'tournaments') return tournaments(req, res, id);
  if (what !== 'runs') return json(res, 404, { error: 'path' });

  if (!id) {
    if (req.method === 'GET') {
      const all = url.searchParams.get('all') === '1';
      return json(res, 200, listRuns().filter((meta) => all || !meta.tournament).map((meta) => live.get(meta.id) ?? meta));
    }
    if (req.method === 'POST') {
      try {
        const request = parseRequest(await readBody(req), options);
        return json(res, 201, startRun(request));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json(res, 404, { error: 'path' });
  }

  let meta: RunMeta | null;
  try {
    meta = live.get(id) ?? readMeta(id);
  } catch {
    return json(res, 400, { error: 'id' });
  }
  if (!meta) return json(res, 404, { error: 'run' });

  if (!sub) {
    if (req.method === 'GET') return json(res, 200, meta);
    if (req.method === 'DELETE') {
      if (meta.status === 'running' || meta.status === 'queued') return json(res, 409, { error: 'running' });
      live.delete(id);
      deleteRun(id);
      return json(res, 200, { deleted: id });
    }
  }
  if (req.method === 'GET' && sub === 'match') {
    const index = Number(n) - 1;
    if (!Number.isInteger(index) || index < 0 || index > 2) return json(res, 400, { error: 'match' });
    const file = matchFile(id, index);
    if (!existsSync(file)) return json(res, 404, { error: 'not recorded' });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-encoding': 'gzip', 'cache-control': 'max-age=3600' });
    res.end(readFileSync(file));
    return;
  }
  return json(res, 404, { error: 'path' });
}

const metaOf = (id: string): RunMeta | null => {
  try {
    return live.get(id) ?? readMeta(id);
  } catch {
    return null;
  }
};

async function tournaments(req: IncomingMessage, res: ServerResponse, id: string | undefined): Promise<void> {
  if (!id) {
    if (req.method === 'GET') return json(res, 200, listTournaments().map((t) => viewTournament(t, metaOf)));
    if (req.method === 'POST') {
      try {
        const request = parseTournament(await readBody(req), options);
        const t = planTournament(request, (seed, lineup: [SeatSpec, SeatSpec, SeatSpec], tag) => startRun({ seed, ticks: request.ticks, lineup, matches: 3 }, tag).id);
        return json(res, 201, viewTournament(t, metaOf));
      } catch (e) {
        return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json(res, 404, { error: 'path' });
  }
  const t = readTournament(id);
  if (!t) return json(res, 404, { error: 'tournament' });
  if (req.method === 'GET') return json(res, 200, viewTournament(t, metaOf));
  if (req.method === 'DELETE') {
    for (const row of t.runs) {
      for (const runId of row) {
        const meta = metaOf(runId);
        if (meta?.status === 'queued') {
          const at = queue.indexOf(runId);
          if (at >= 0) queue.splice(at, 1);
        }
        if (meta?.status === 'running') continue;
        live.delete(runId);
        deleteRun(runId);
      }
    }
    deleteTournament(id);
    return json(res, 200, { deleted: id });
  }
  return json(res, 404, { error: 'path' });
}

/* запуски, що обірвалися разом із попереднім сервером */
for (const meta of listRuns()) {
  if (meta.status === 'running' || meta.status === 'queued') {
    meta.status = 'failed';
    meta.error = 'сервер перезапущено під час гри';
    saveMeta(meta);
  }
}

createServer((req, res) => {
  route(req, res).catch((e: unknown) => {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  });
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`лабораторія: http://127.0.0.1:${PORT}  (рушій ${ENGINE_HASH.slice(0, 12)}, потоків ${PARALLEL})\n`);
});
