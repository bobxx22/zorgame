/* lab :: main
   The lab's local server: the runs API and the panel itself (dist-web).
   Listens on 127.0.0.1 only. Matches are played by threads (worker_threads),
   at most cores minus one at a time.

     GET    /api/options             presets, archetypes, nakaz samples, engine
     GET    /api/runs                runs, newest first
     POST   /api/runs                a new run (RunRequest)
     GET    /api/runs/:id            run status
     DELETE /api/runs/:id            delete a run with its records
     GET    /api/runs/:id/match/:n   record of match n (1-3), gzip
     GET    /api/tournaments         tournaments
     POST   /api/tournaments         a new tournament (TournamentRequest)
     GET    /api/tournaments/:id     tournament summary (TournamentView)
     DELETE /api/tournaments/:id     delete a tournament and its runs
     GET    /api/play                play-mode games (PlayState without the turn)
     POST   /api/play                a new game against bots (PlayRequest); answers at the first decision tick
     GET    /api/play/:id            the game's state; ?wait=1 - long poll until the next decision tick
     POST   /api/play/:id/act        the human's move (PlayAction); answers at the next decision tick
     DELETE /api/play/:id            close the game */

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
import { DEFAULT_PRESET, DEFAULT_TACTICS, FILL_CHARTERS, NAKAZ_HEADS, presets } from '../../bot/dist/strategy.js';
import type { LabOptions, RunMeta, RunRequest, SeatSpec } from '../shared/record.ts';
import { EXT_BOTS } from './ext.ts';
import { deleteRun, listRuns, matchFile, newRunId, parseRequest, readMeta, saveMeta } from './runs.ts';
import { actPlay, closePlay, playState, playStates, startPlay, waitPlay } from './sessions.ts';
import { deleteTournament, listTournaments, parseTournament, planTournament, readTournament, viewTournament } from './tournaments.ts';
import type { WorkerJob, WorkerMessage } from './worker.ts';

const PORT = Number(process.env['LAB_PORT'] ?? 4747);
const WEB = fileURLToPath(new URL('../dist-web/', import.meta.url));
const CPUS = availableParallelism();
const PARALLEL = Math.max(1, CPUS - 1);

const NAKAZ_BROKEN: readonly string[] = ['хвилини', 'тиск'];

const options: LabOptions = {
  presets: [...presets(), ...NAKAZ_HEADS],
  archetypes: Object.keys(ARCHETYPES),
  /* nakaz samples as opponents - without the two with a logic hole: "хвилини"
     and "тиск" build Tkachs only until tick 600 and 400 and don't replace lost
     ones, and their dawn rule stands after the growth rule and never fires. A
     win over such a dying swarm gives false points (NAKAZ_BROKEN) */
  nakaz: Object.keys(NAKAZ_SAMPLES).filter((name) => !NAKAZ_BROKEN.includes(name)),
  ext: [...EXT_BOTS],
  charters: [...FILL_CHARTERS],
  defaultPreset: DEFAULT_PRESET,
  defaultTactics: DEFAULT_TACTICS.split(','),
  engine: ENGINE_HASH,
  cpus: CPUS,
};

/* the run queue: live state is kept here, on disk - at every step */
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
    res.end('The panel is not built: npm run build (or npm start) in the lab directory.');
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
  if (what === 'play') return play(req, res, id, sub, url.searchParams.get('wait') === '1');
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

async function play(req: IncomingMessage, res: ServerResponse, id: string | undefined, sub: string | undefined, wait: boolean): Promise<void> {
  try {
    if (!id) {
      if (req.method === 'GET') return json(res, 200, playStates());
      if (req.method === 'POST') return json(res, 201, await startPlay(await readBody(req), options));
      return json(res, 404, { error: 'path' });
    }
    if (req.method === 'POST' && sub === 'act') return json(res, 200, await actPlay(id, await readBody(req)));
    if (req.method === 'DELETE' && !sub) return json(res, closePlay(id) ? 200 : 404, { closed: id });
    if (req.method === 'GET' && !sub) {
      const state = wait ? await waitPlay(id) : playState(id);
      return state ? json(res, 200, state) : json(res, 404, { error: 'game' });
    }
    return json(res, 404, { error: 'path' });
  } catch (e) {
    return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

/* runs that broke off together with the previous server */
for (const meta of listRuns()) {
  if (meta.status === 'running' || meta.status === 'queued') {
    meta.status = 'failed';
    meta.error = 'the server was restarted during the game';
    saveMeta(meta);
  }
}

createServer((req, res) => {
  route(req, res).catch((e: unknown) => {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  });
}).listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`lab: http://127.0.0.1:${PORT}  (engine ${ENGINE_HASH.slice(0, 12)}, ${PARALLEL} threads)\n`);
});
