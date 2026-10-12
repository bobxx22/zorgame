/* hq :: app/library
   Everything the show has read: the packs the host supplied, their journals
   and diaries, and the workers that turn a journal into the truth of the
   world.

   The workers are started once, before the show tells the host it is ready,
   and are reused for every match after that: starting one later would be a
   request from the show, and the show makes none (HQ contract, 1.2).

   A match is computed when the show first stands on it, not when its file
   arrives: three engines running side by side would take the processor from
   the page exactly while it is being looked at. The rest is computed in the
   pauses, one match at a time (`fillIdle`). */

import { BeliefIndex, readDiary, readFrame } from '../model/belief.ts'
import { MatchIndex } from '../model/match.ts'
import type { PackEntry } from '../model/pack.ts'
import type { FromWorker, ToWorker } from '../model/wire.ts'

export interface MatchData {
  index: MatchIndex | null
  belief: BeliefIndex | null
  /** why the match cannot be shown: a journal of another engine, a missing file */
  problem: string | null
}

export interface FileSource {
  file(id: string, name: string): Promise<ArrayBuffer | string>
}

/* matches of one pack are computed side by side */
const POOL = 3
/* a worker that has not loaded in this time is not waited for any longer */
const UP_WAIT_MS = 4000
const NO_WORKERS = 'the workers of the show did not start'

const why = (error: unknown): string => (error instanceof Error ? error.message : String(error))

type JobAnswer = Exclude<FromWorker, { type: 'up' }>
/* a message to a worker without its job number: the pool adds it */
type JobBody = ToWorker extends infer M ? (M extends { job: number } ? Omit<M, 'job'> : never) : never
type Send = (message: JobBody, transfer?: Transferable[]) => void

class MatchFeed implements MatchData {
  index: MatchIndex | null = null
  belief: BeliefIndex | null = null
  problem: string | null = null
  /** the truth is still being computed */
  open = true
  /** hands the journal to a worker; null before the file has arrived and after the hand-over */
  begin: (() => void) | null = null
  /** the show already stands on this match: begin as soon as the file arrives */
  wanted = false

  take(message: JobAnswer): void {
    if (message.type === 'meta') {
      this.index = new MatchIndex(message.meta)
      this.index.addFrames(message.frames, message.framesTo)
      this.index.addDenies(message.denies)
    } else if (message.type === 'chunk') this.index?.addChunk(message.chunk)
    else if (message.type === 'done') this.open = false
    else this.fail(message.why)
  }

  fail(problem: string): void {
    this.problem = problem
    this.open = false
    this.begin = null
  }
}

interface Seat {
  worker: Worker
  /** jobs this worker has been given and has not finished */
  load: number
}

/** A fixed set of workers and the matches they are computing. */
class Pool {
  /** resolves when every worker has loaded, failed or run out of time */
  readonly ready: Promise<void>
  readonly #seats: Seat[] = []
  readonly #jobs = new Map<number, { feed: MatchFeed; seat: Seat }>()
  readonly #onChange: () => void
  #seq = 0

  constructor(spawn: () => Worker, onChange: () => void) {
    this.#onChange = onChange
    let waiting = 0
    let settle: () => void = () => undefined
    const up = (): void => {
      waiting -= 1
      if (waiting <= 0) settle()
    }
    for (let i = 0; i < POOL; i++) {
      let worker: Worker
      try {
        worker = spawn()
      } catch {
        /* the sandbox forbids workers: the matches will say so on the page (NO_WORKERS) */
        break
      }
      const seat: Seat = { worker, load: 0 }
      let loaded = false
      waiting += 1
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data
        if (message.type === 'up') {
          if (!loaded) up()
          loaded = true
          return
        }
        this.#take(message)
      }
      worker.onerror = (event) => {
        event.preventDefault()
        if (!loaded) up()
        loaded = true
        this.#drop(seat, event.message || 'a worker of the show stopped')
      }
      this.#seats.push(seat)
    }
    this.ready = new Promise((resolve) => {
      const timer = setTimeout(resolve, UP_WAIT_MS)
      settle = () => {
        clearTimeout(timer)
        resolve()
      }
      if (waiting <= 0) settle()
    })
  }

  /** Gives the match to the least loaded worker; returns how to talk to it, or null when there is none. */
  assign(feed: MatchFeed): Send | null {
    const seat = this.#seats.reduce<Seat | null>((best, s) => (best === null || s.load < best.load ? s : best), null)
    if (!seat) {
      feed.fail(NO_WORKERS)
      return null
    }
    const job = ++this.#seq
    seat.load += 1
    this.#jobs.set(job, { feed, seat })
    return (message, transfer = []) => {
      seat.worker.postMessage({ ...message, job } satisfies ToWorker, transfer)
    }
  }

  /** Whether any worker is computing a match right now. */
  get busy(): boolean {
    return this.#jobs.size > 0
  }

  close(): void {
    for (const seat of this.#seats) seat.worker.terminate()
    this.#seats.length = 0
    this.#jobs.clear()
  }

  #take(message: JobAnswer): void {
    const held = this.#jobs.get(message.job)
    if (!held) return
    held.feed.take(message)
    if (!held.feed.open) {
      held.seat.load -= 1
      this.#jobs.delete(message.job)
    }
    this.#onChange()
  }

  /* a worker died: its matches cannot be finished, and it takes no more */
  #drop(seat: Seat, problem: string): void {
    seat.worker.terminate()
    const at = this.#seats.indexOf(seat)
    if (at >= 0) this.#seats.splice(at, 1)
    for (const [job, held] of this.#jobs) {
      if (held.seat !== seat) continue
      held.feed.fail(problem)
      this.#jobs.delete(job)
    }
    this.#onChange()
  }
}

export class Library {
  readonly #pool: Pool
  readonly #onChange: () => void
  readonly #packs = new Map<string, MatchFeed[]>()
  #live: MatchFeed | null = null
  #liveSend: Send | null = null
  /** the last tick of the broadcast that was forwarded to the engine */
  #liveAt = 0

  constructor(spawn: () => Worker, onChange: () => void) {
    this.#onChange = onChange
    this.#pool = new Pool(spawn, onChange)
  }

  /** Resolves when the workers have loaded: from then on the show starts nothing new. */
  get ready(): Promise<void> {
    return this.#pool.ready
  }

  /** The match `n` (1..3) of a pack; null until the pack has been opened. */
  match(packId: string | null, n: number): MatchData | null {
    return (packId === null ? undefined : this.#packs.get(packId)?.[n - 1]) ?? null
  }

  get live(): MatchData | null {
    return this.#live
  }

  /** The show stands on this match: its truth is computed now. */
  want(packId: string | null, n: number): void {
    const feed = packId === null ? undefined : this.#packs.get(packId)?.[n - 1]
    if (!feed) return
    feed.wanted = true
    this.#begin(feed)
  }

  /** A pause in the show: computes one more match nobody has asked for yet; false when none is left. */
  fillIdle(): boolean {
    if (this.#pool.busy) return true
    for (const feeds of this.#packs.values()) {
      for (const feed of feeds) {
        if (!feed.begin) continue
        this.#begin(feed)
        return true
      }
    }
    return [...this.#packs.values()].some((feeds) => feeds.some((feed) => feed.open && feed.problem === null))
  }

  #begin(feed: MatchFeed): void {
    const begin = feed.begin
    feed.begin = null
    begin?.()
  }

  /** Starts reading the three matches of a pack; a pack already opened is left as it is. */
  openPack(entry: PackEntry, source: FileSource): void {
    if (this.#packs.has(entry.id)) return
    const feeds = entry.pack.matches.map((match, i) => {
      const feed = new MatchFeed()
      this.#readMatch(feed, entry, match.file, i, source).then(this.#onChange, (error: unknown) => {
        feed.fail(why(error))
        this.#onChange()
      })
      return feed
    })
    this.#packs.set(entry.id, feeds)
  }

  /** A match in progress: the manifest now, the ticks through `liveTick`. */
  openLive(manifest: ArrayBuffer, bots: string[], roster: string[]): void {
    const feed = new MatchFeed()
    feed.belief = new BeliefIndex()
    this.#live = feed
    this.#liveAt = 0
    this.#liveSend = this.#pool.assign(feed)
    this.#liveSend?.({ type: 'live', manifest, bots, roster })
  }

  liveTick(t: number, submits: [string, ArrayBuffer][], denies: [string, number, number][], belief: unknown): void {
    const feed = this.#live
    if (!feed) return
    /* the engine replays the frames tick by tick: a tick that did not arrive leaves it in another world */
    if (t !== this.#liveAt + 1 && feed.problem === null) feed.problem = `the broadcast skipped from tick ${this.#liveAt} to tick ${t}`
    this.#liveAt = t
    if (belief !== null && belief !== undefined && feed.belief) {
      const frame = readFrame(typeof belief === 'string' ? parseLine(belief) : belief)
      if (frame) feed.belief.push(frame)
      else feed.belief.skipped += 1
    }
    this.#liveSend?.({ type: 'tick', t, submits, denies })
  }

  /** Stops every worker: the page is going away. */
  close(): void {
    this.#pool.close()
  }

  async #readMatch(feed: MatchFeed, entry: PackEntry, file: string, i: number, source: FileSource): Promise<void> {
    const diary = entry.pack.belief?.files[i]
    const [runlog, text] = await Promise.all([source.file(entry.id, file), diary ? source.file(entry.id, diary) : null])
    if (typeof runlog === 'string') throw new Error(`${file} arrived as text, a journal is bytes`)
    if (typeof text === 'string') feed.belief = readDiary(text)
    feed.begin = () => {
      this.#pool.assign(feed)?.({ type: 'open', runlog }, [runlog])
    }
    if (feed.wanted) this.#begin(feed)
  }
}

/* a diary line that is not JSON is not a frame: liveTick counts it as unread */
function parseLine(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
