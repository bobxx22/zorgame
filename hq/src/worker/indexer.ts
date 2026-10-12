/* hq :: worker/indexer
   A worker of the show: it owns the engine, runs the pass over a journal and
   posts the truth to the page in chunks. The page starts a few of these once,
   before it tells the host it is ready, and then hands them jobs: a recorded
   match is passed to the end at once, a live one steps with every tick the
   page forwards. */

import type { DenyRow, FrameRow, FromWorker, ToWorker, TruthChunk } from '../model/wire.ts'
import { Pass } from './pass.ts'

/* ticks per chunk of a record: small enough for the first answers to come early */
const CHUNK = 25

const scope = self as unknown as DedicatedWorkerGlobalScope

/* the live match of this worker and the channel rows that have not left with a chunk yet */
let live: { job: number; pass: Pass; frames: FrameRow[]; denies: DenyRow[] } | null = null

function post(message: FromWorker, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer)
}

function postChunk(job: number, chunk: TruthChunk): void {
  post({ type: 'chunk', job, chunk }, [chunk.score.buffer, chunk.needles.buffer])
}

function announce(job: number, pass: Pass, framesTo: number): void {
  post({ type: 'meta', job, meta: pass.meta, frames: pass.frames, denies: pass.denies, framesTo })
}

function handle(message: ToWorker): void {
  const job = message.job
  if (message.type === 'open') {
    const pass = Pass.ofRecord(new Uint8Array(message.runlog))
    announce(job, pass, pass.meta.ticks)
    for (let chunk = pass.run(CHUNK); chunk; chunk = pass.run(CHUNK)) postChunk(job, chunk)
    post({ type: 'done', job })
  } else if (message.type === 'live') {
    const pass = Pass.ofLive(new Uint8Array(message.manifest), message.bots, message.roster)
    live = { job, pass, frames: [], denies: [] }
    announce(job, pass, 0)
    const first = pass.run(1)
    if (first) postChunk(job, first)
  } else if (live && live.job === job) {
    const frames: [string, Uint8Array][] = message.submits.map(([slot, bytes]) => [slot, new Uint8Array(bytes)])
    const fed = live.pass.feed(message.t, frames, message.denies)
    live.frames.push(...fed.frames)
    live.denies.push(...fed.denies)
    const chunk = live.pass.run(live.pass.meta.ticks)
    if (chunk) {
      chunk.frames = live.frames
      chunk.denies = live.denies
      live.frames = []
      live.denies = []
      postChunk(job, chunk)
    }
    if (live.pass.finished) {
      post({ type: 'done', job })
      live = null
    }
  }
}

scope.onmessage = (event: MessageEvent<ToWorker>) => {
  try {
    handle(event.data)
  } catch (error) {
    /* a journal of another engine, a broken file: the page shows the reason */
    post({ type: 'error', job: event.data.job, why: error instanceof Error ? error.message : String(error) })
  }
}

post({ type: 'up' })
