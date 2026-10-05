/* bot :: status
   the head's internal service port - the only way into the bot from outside
   its process. The stack's control-plane listens to it (`zaria-kit init
   stack`), and from this snapshot it builds `/health` and `/metrics` of the
   service contract (`kit/02-control-plane.md`). There is no second channel
   from the head: only it sees the wire counters.

   The port is enabled by the STATUS_PORT variable. Without it there is no
   server at all: the local pack (`npm run play`) doesn't need it, and in the
   stack it lives in the internal network and is not published outside.

     GET  /state    head snapshot: wire, tick, counters, diary
     POST /preset   {"preset"} - between matches; in battle and when frozen 409

   Request bodies - up to a kilobyte: only the control-plane comes here.
   Refusal words are machine words (`preset`, `live`, `freeze`, `json`,
   `path`) - whoever talks to the participant retells them in their language. */

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { errText } from './errors.js';

export interface HeadStats {
  ticks: number;
  orders: number;
  nacks: number;
  bytesIn: number;
  bytesOut: number;
  resyncMs: number;
  resumes: number;
  faults: number;
  deferred: number;
  lastTickAt: number;
}

export interface HeadState {
  /* lobby - not in a match yet; live - the wire is alive; done - the match is over */
  state: 'lobby' | 'live' | 'done';
  slot: string | null;
  preset: string;
  presets: string[];
  freeze: boolean;
  /* world tick from the header of the last observe frame */
  tick: number;
  /* frames the head answered; a mismatch with tick - skips */
  frames: number;
  ticks: number;
  /* reason the match ended: end - the node said goodbye, close:<code> - closed */
  why: string;
  engine: string;
  uptimeMs: number;
  stats: HeadStats;
  belief: { frames: number; ageMs: number };
}

export interface Head {
  state(): HeadState;
  /* change the preset between matches; a refusal - Refusal with its own HTTP code */
  promote(preset: unknown): string;
}

export class Refusal extends Error {
  readonly code: number;

  constructor(code: number, word: string) {
    super(word);
    this.code = code;
    this.name = 'Refusal';
  }
}

const LIMIT = 1024;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, bad) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > LIMIT) {
        bad(new Refusal(400, 'json'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('json');
        ok(v as Record<string, unknown>);
      } catch {
        bad(new Refusal(400, 'json'));
      }
    });
    req.on('error', bad);
  });
}

function send(res: ServerResponse, code: number, value: unknown): void {
  const text = JSON.stringify(value);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function route(head: Head, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '/').split('?')[0];
  try {
    if (req.method === 'GET' && path === '/state') send(res, 200, head.state());
    else if (req.method === 'POST' && path === '/preset') send(res, 200, { preset: head.promote((await readBody(req))['preset']) });
    else send(res, 404, { error: 'path' });
  } catch (e) {
    if (e instanceof Refusal) send(res, e.code, { error: e.message });
    else send(res, 500, { error: errText(e) });
  }
}

export function statusServer(head: Head): Server {
  return createServer((req, res) => {
    void route(head, req, res);
  });
}
