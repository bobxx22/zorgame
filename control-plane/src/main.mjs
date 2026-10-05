/* control-plane :: the bot's service handles
   the stack's control plane: everything asked of the bot from outside.

     GET  /health           readiness; a bot that is not ready - 503, not 200
                            with a sad field: the run relies on this handle
     GET  /metrics          Prometheus; the five canon counters are required
     POST /presets/promote  strategy change without a rebuild; mid-match - 409
     GET  /belief-stream    SSE of the belief diary: the file's tail, line by line
     GET  /livez, /presets  beyond the contract: liveness and the preset list

   Standardized by the canon - the first four (`kit/02-control-plane.md`).

   control-plane keeps no state of its own about the match: the snapshot is
   taken from the head on every request over its internal port (the plane
   network, does not go outward). What the seam is for: the head keeps
   playing the match through even if this plane restarts, and belief-stream
   subscribers read the file in this process, not in the tick loop.

   No dependencies on purpose: node:http plus the diary file. Bring your
   own NestJS, your own cache and your own queue - that is your
   architecture, and it is graded by code. */

import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { createServer } from 'node:http';

const int = (name, def, min, max) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(name + ' - not a number within allowed bounds: ' + raw);
  return n;
};

const CFG = {
  port: int('PORT', 7801, 0, 65535),
  host: process.env.HOST || '0.0.0.0',
  headUrl: (process.env.HEAD_URL || 'http://127.0.0.1:7811').replace(/\/+$/, ''),
  headTimeoutMs: int('HEAD_TIMEOUT_MS', 1000, 50, 60_000),
  belief: process.env.ZARIA_BELIEF || '/data/belief.ndjson',
  tailMs: int('TAIL_MS', 100, 10, 5000),
};

/* ===== the head: a snapshot on every request ===== */

async function headState() {
  try {
    const r = await fetch(CFG.headUrl + '/state', { signal: AbortSignal.timeout(CFG.headTimeoutMs) });
    if (!r.ok) return { ok: false, why: 'HTTP ' + r.status };
    return { ok: true, state: await r.json() };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e) };
  }
}

async function headPost(path, body) {
  const r = await fetch(CFG.headUrl + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CFG.headTimeoutMs),
  });
  const text = await r.text();
  try {
    return { code: r.status, body: JSON.parse(text) };
  } catch {
    return { code: r.status, body: { error: text } };
  }
}

/* the head's refusal words are machine-readable - whoever talks to the human translates them */
const REFUSAL = {
  preset: 'no preset with that name',
  live: 'a run is in progress: changing strategy mid-match would be swapping the player',
  freeze: 'the submission is frozen',
  json: 'the request body must be a JSON object with a preset field',
};

/* ===== the belief diary: the file's tail ===== */

const NL = 0x0a;

/* Polling the size, not fs.watch: this is shared by two containers, and
   inotify across a volume boundary behaves differently on different hosts.
   A new match zeroes the diary; truncation is detected as in tail -F -
   the file is shorter than what was read, or the bytes of the last whole
   line are already different */
class Tail {
  constructor(file, everyMs) {
    this.file = file;
    this.offset = 0;
    this.lastStart = 0;
    this.lastLine = null;
    this.partial = Buffer.alloc(0);
    this.skip = false;
    this.clients = new Set();
    const fd = this.open();
    if (fd !== null) {
      try {
        this.offset = fstatSync(fd).size;
        if (this.offset > 0) {
          const last = Buffer.alloc(1);
          readSync(fd, last, 0, 1, this.offset - 1);
          this.skip = last[0] !== NL;
        }
      } finally {
        closeSync(fd);
      }
    }
    this.timer = setInterval(() => this.poll(), everyMs);
    this.timer.unref();
  }

  open() {
    try {
      return openSync(this.file, 'r');
    } catch {
      return null; /* the diary does not exist yet: the head has not sat down at the table */
    }
  }

  poll() {
    const fd = this.open();
    if (fd === null) return;
    try {
      let size = fstatSync(fd).size;
      if (size < this.offset || this.rewritten(fd)) {
        this.offset = 0;
        this.lastStart = 0;
        this.lastLine = null;
        this.partial = Buffer.alloc(0);
        this.skip = false;
        size = fstatSync(fd).size;
      }
      if (size <= this.offset) return;
      const buf = Buffer.alloc(size - this.offset);
      const n = readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += n;
      this.feed(buf.subarray(0, n));
    } finally {
      closeSync(fd);
    }
  }

  rewritten(fd) {
    if (!this.lastLine) return false;
    const probe = Buffer.alloc(this.lastLine.length);
    const n = readSync(fd, probe, 0, probe.length, this.lastStart);
    return n !== probe.length || !probe.equals(this.lastLine);
  }

  feed(chunk) {
    const data = this.partial.length ? Buffer.concat([this.partial, chunk]) : chunk;
    const base = this.offset - data.length;
    let from = 0;
    for (;;) {
      const nl = data.indexOf(NL, from);
      if (nl < 0) break;
      if (this.skip) this.skip = false;
      else {
        this.lastStart = base + from;
        this.lastLine = Buffer.from(data.subarray(from, nl + 1));
        const line = data.subarray(from, nl).toString('utf8');
        for (const res of this.clients) res.write('data: ' + line + '\n\n');
      }
      from = nl + 1;
    }
    this.partial = Buffer.from(data.subarray(from));
  }
}

const tail = new Tail(CFG.belief, CFG.tailMs);

/* ===== handles ===== */

function json(res, code, value) {
  const text = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function body(req, limit = 1024) {
  return new Promise((ok, bad) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        bad(new Error('json'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('json');
        ok(v);
      } catch {
        bad(new Error('json'));
      }
    });
    req.on('error', bad);
  });
}

async function health(res) {
  const h = await headState();
  if (!h.ok) {
    json(res, 503, { status: 'starting', state: 'unreachable', slot: null, tick: 0, frames: 0, ticks: 0, why: 'the head is not answering: ' + h.why, engine: '', head: 'unreachable' });
    return;
  }
  const v = h.state;
  /* readiness means "the wire is alive, or the run has honestly finished"; the
     lobby and idling do not count as readiness, and an emergency ending even less so */
  const ready = v.state === 'live' || (v.state === 'done' && v.why === 'end');
  json(res, ready ? 200 : 503, {
    status: ready ? 'ok' : v.state === 'done' ? 'failed' : 'starting',
    state: v.state,
    slot: v.slot,
    preset: v.preset,
    tick: v.tick,
    frames: v.frames,
    ticks: v.ticks,
    why: v.why,
    engine: v.engine,
    uptimeMs: v.uptimeMs,
    head: 'ok',
  });
}

function metric(name, help, type, value) {
  return ['# HELP ' + name + ' ' + help, '# TYPE ' + name + ' ' + type, name + ' ' + value];
}

async function metrics(res) {
  const h = await headState();
  const lines = [...metric('bot_head_up', 'Whether the head answers on the internal port', 'gauge', h.ok ? 1 : 0)];
  if (h.ok) {
    const v = h.state;
    const s = v.stats;
    /* five canon counters: they cannot be removed - the run and the judge
       read every bot by them the same way (kit/02-control-plane.md) */
    lines.push(
      ...metric('bot_ticks_processed', 'Ticks processed on the wire', 'counter', s.ticks),
      ...metric('bot_orders_sent', 'Order frames sent', 'counter', s.orders),
      ...metric('bot_nacks', 'Gatekeeper denials', 'counter', s.nacks),
      ...metric('bot_resync_seconds', 'Seconds on the oath and rebuilding the world picture', 'counter', (s.resyncMs / 1000).toFixed(3)),
      ...metric('bot_belief_snapshot_age', 'Seconds since the last belief frame', 'gauge', (v.belief.ageMs / 1000).toFixed(3)),
      /* beyond the canon - anything goes: add your own */
      ...metric('bot_live', 'The head is at the table', 'gauge', v.state === 'live' ? 1 : 0),
      ...metric('bot_wire_bytes_in', 'Bytes from the wire', 'counter', s.bytesIn),
      ...metric('bot_wire_bytes_out', 'Bytes onto the wire', 'counter', s.bytesOut),
      ...metric('bot_resumes', 'Resumes per match', 'counter', s.resumes),
      ...metric('bot_faults', 'Faults raised by the head', 'counter', s.faults),
      ...metric('bot_belief_frames', 'Belief frames recorded', 'counter', v.belief.frames),
    );
  }
  lines.push(...metric('bot_belief_stream_clients', 'belief-stream subscribers', 'gauge', tail.clients.size));
  const text = lines.join('\n') + '\n';
  res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function beliefStream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  res.write(': belief-stream\n\n');
  tail.clients.add(res);
  req.on('close', () => tail.clients.delete(res));
}

async function route(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && path === '/livez') return json(res, 200, { status: 'ok' });
  if (req.method === 'GET' && path === '/health') return health(res);
  if (req.method === 'GET' && path === '/metrics') return metrics(res);
  if (req.method === 'GET' && path === '/belief-stream') return beliefStream(req, res);
  if (req.method === 'GET' && path === '/presets') {
    const h = await headState();
    if (!h.ok) return json(res, 503, { error: 'the head is not answering: ' + h.why });
    return json(res, 200, { active: h.state.preset, known: h.state.presets });
  }
  if (req.method === 'POST' && path === '/presets/promote') {
    let asked;
    try {
      asked = (await body(req)).preset;
    } catch {
      return json(res, 400, { error: REFUSAL.json });
    }
    let answer;
    try {
      answer = await headPost('/preset', { preset: asked });
    } catch (e) {
      return json(res, 503, { error: 'the head is not answering: ' + (e instanceof Error ? e.message : String(e)) });
    }
    if (answer.code === 200) return json(res, 200, answer.body);
    return json(res, answer.code, { error: REFUSAL[answer.body.error] || String(answer.body.error) });
  }
  return json(res, 404, { error: 'no such handle' });
}

const server = createServer((req, res) => {
  void route(req, res).catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }));
});

server.listen(CFG.port, CFG.host, () => {
  process.stdout.write('[control-plane] ' + CFG.host + ':' + CFG.port + ', head ' + CFG.headUrl + '\n');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.once(sig, () => {
    for (const res of tail.clients) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
