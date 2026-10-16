/* hq :: main
   The show: one page that the host feeds with a pack record or with a match in
   progress (part3/01-hq-contract.md). Controls change the view, the view is
   painted once per animation frame, and every number on the page is read from
   memory - the engine runs in workers and never inside a frame. */

import workerSource from 'virtual:worker'
import { answers, cellKey, diaryOwner, fixed1, focusSlot, type Mode, type Sources, type View } from './app/answers.ts'
import { Library, type FileSource, type MatchData } from './app/library.ts'
import { LocalRecord } from './app/local.ts'
import { openHost, type LiveEnd, type LiveTick, type ShowHost } from './host/guest.js'
import { setLang, tr, type Lang } from './i18n.ts'
import { compare, comparedPair, focusSeat, readEntry, type PackEntry } from './model/pack.ts'
import { slotIndex } from './model/wire.ts'
import { Anchors, bindControl, fieldOf, mirror, setOptions } from './view/dom.ts'
import { ValleyMap } from './view/map.ts'
import { ChannelStrip } from './view/strip.ts'

const NAME = 'zorgame-hq'
const MODES: readonly Mode[] = ['truth', 'belief', 'both']
/* seats of the hall, then the Keeper */
const PALETTE = ['#eeb968', '#6fc3c9', '#c58af9'] as const
const KEEPER = '#cdd6dc'
/* ticks per second when the show plays a record by itself */
const PLAY_SPEED = 30
/* a pause of the controls this long is used to compute the matches not looked at yet */
const IDLE_MS = 1500
/* The show says `ready` when the pack it opens with has been computed, and no later than this
   long after the page started: the opening budget is 15 s (HQ contract, 4.4), and a show that
   is not ready by then ends the acceptance run with no report at all. */
const READY_DEADLINE_MS = 8000

/* an element of the page by its id, of the kind the code expects */
function byId<T extends HTMLElement>(id: string, kind: abstract new () => T): T {
  const el = document.getElementById(id)
  if (!(el instanceof kind)) throw new Error(`the page has no #${id}`)
  return el
}

/* a message of the broadcast that came before the show could take it */
type LiveEvent = { type: 'tick'; tick: LiveTick } | { type: 'end'; end: LiveEnd }

class Show {
  readonly #host: ShowHost
  readonly #library: Library
  readonly #anchors = new Anchors(document)
  readonly #map = new ValleyMap(byId('map', HTMLElement), byId('mapCanvas', HTMLCanvasElement))
  readonly #strip = new ChannelStrip(byId('strip', HTMLElement), byId('stripChart', HTMLCanvasElement), byId('stripCursor', HTMLElement))
  readonly #note = byId('note', HTMLElement)
  readonly #play = byId('play', HTMLButtonElement)
  readonly #follow = byId('follow', HTMLButtonElement)
  readonly #promoteDetail = byId('promoteDetail', HTMLElement)
  #files: FileSource
  #packs: PackEntry[] = []
  #preset = ''
  #playing = false
  #playedAt = 0
  #following = true
  #queued = false
  #readySent = false
  #readyTick = -1
  #promoteSeq = 0
  #problem = ''
  #noteShown = ''
  #abShown = ''
  #idle: ReturnType<typeof setTimeout> | null = null
  /** the pack whose computation `ready` waits for; null once the show is ready or never waited */
  #hold: string | null = null
  #deadline: ReturnType<typeof setTimeout> | null = null
  /** what the last frame showed of the match on screen: a change of a match repaints only when this changes */
  #shown = ''
  #frameId = 0
  #stopped = false
  /** ends the listeners of the page */
  readonly #abort = new AbortController()
  /** ends the subscriptions to the host */
  readonly #off: (() => void)[] = []

  readonly #view: View = { packId: null, match: 1, tick: 0, mode: 'truth', focus: '', cell: '', unit: '', order: 0, promote: '-', live: null }

  constructor(host: ShowHost, library: Library) {
    this.#host = host
    this.#library = library
    this.#files = host
    this.#bind()
  }

  /** Something changed: repaint in the next animation frame, once. */
  readonly invalidate = (): void => {
    if (this.#queued || this.#stopped) return
    this.#queued = true
    this.#frameId = requestAnimationFrame(this.#frame)
  }

  /**
   * A match changed in the library. The page is repainted only when that shows: the truth of the
   * tick on screen has arrived, the strip has grown by a step, the match ended or failed. A chunk
   * of a match that is not on screen costs no frame - while the frames are being measured the
   * engine may still be computing.
   */
  readonly changed = (match: MatchData): void => {
    if (!this.#readySent && this.#opened()) this.invalidate()
    else if (match === this.#match() && this.#stamp(match) !== this.#shown) this.invalidate()
  }

  /** `early` - what the broadcast sent while the show was still starting, in the order it came. */
  start(early: readonly LiveEvent[] = []): void {
    const host = this.#host
    setLang(host.lang, document)
    this.#off.push(
      host.on('lang', (lang: Lang) => {
        setLang(lang, document)
        this.#paintLegend()
        this.invalidate()
      }),
    )
    if (host.mode === 'record') {
      this.#openPacks(host.packs().map(readEntry), host, true)
      /* the deadline of `ready` needs a frame of its own: no chunk may arrive at that moment */
      if (this.#hold !== null) this.#deadline = setTimeout(this.invalidate, Math.max(0, READY_DEADLINE_MS - performance.now()) + 1)
    } else if (host.mode === 'live') this.#openLive(early)
    else this.#problem = tr('noHost')
    byId('openBox', HTMLElement).hidden = host.mode !== 'none'
    this.#strip.fit()
    this.#rest()
    this.invalidate()
  }

  /* ---- sources ---- */

  #pack(): PackEntry | null {
    return this.#packs.find((p) => p.id === this.#view.packId) ?? null
  }

  #match(): MatchData | null {
    return this.#view.live ? this.#library.live : this.#library.match(this.#view.packId, this.#view.match)
  }

  #sources(): Sources {
    const match = this.#match()
    return { packs: this.#packs, pack: this.#pack(), index: match?.index ?? null, belief: match?.belief ?? null }
  }

  /* the last tick the show can stand on */
  #lastTick(): number {
    if (this.#view.live) return this.#view.live.cap
    return this.#pack()?.pack.ticks ?? this.#match()?.index?.meta.ticks ?? 0
  }

  /* ---- record ---- */

  /* `opening` - the packs the page starts with: the first one is computed whole before `ready` */
  #openPacks(entries: readonly (PackEntry | null)[], files: FileSource, opening = false): void {
    this.#files = files
    this.#packs = entries.filter((e): e is PackEntry => e !== null)
    setOptions(fieldOf(document, 'go-pack') as HTMLSelectElement | null, this.#packs.map((p) => ({ value: p.id, label: p.title })))
    setOptions(byId('presets', HTMLDataListElement), [...new Set(this.#packs.map((p) => p.preset).filter((p) => p !== ''))].map((p) => ({ value: p, label: p })))
    const first = this.#packs[0]
    if (!first) {
      this.#problem = tr('badPack')
      return
    }
    if (opening) this.#hold = first.id
    this.#usePack(first.id)
  }

  #usePack(id: string): void {
    const entry = this.#packs.find((p) => p.id === id)
    if (!entry) return
    const view = this.#view
    view.packId = id
    view.live = null
    this.#library.openPack(entry, this.#files, this.#hold === id)
    const roster = entry.pack.roster
    setOptions(fieldOf(document, 'go-focus') as HTMLSelectElement | null, roster.map((nick) => ({ value: nick, label: nick })))
    if (!roster.includes(view.focus)) view.focus = roster[focusSeat(entry.pack)] ?? roster[0] ?? ''
    view.tick = Math.min(view.tick, entry.pack.ticks)
    if (this.#preset === '') this.#preset = entry.preset
    this.#paintLegend()
  }

  /* ---- broadcast ---- */

  #openLive(early: readonly LiveEvent[]): void {
    const live = this.#host.live()
    if (!live) return
    const view = this.#view
    const owner = live.roster[live.seat] ?? ''
    view.live = { cap: 0, ended: false, shares: null, roster: live.roster, owner }
    view.focus = owner
    view.tick = 0
    this.#library.openLive(live.manifest, live.bots, live.roster)
    setOptions(fieldOf(document, 'go-focus') as HTMLSelectElement | null, live.roster.map((nick) => ({ value: nick, label: nick })))
    setOptions(fieldOf(document, 'go-pack') as HTMLSelectElement | null, [{ value: '', label: tr('liveName') }])
    const onTick = (tick: LiveTick): void => {
      if (!view.live) return
      view.live.cap = Math.max(view.live.cap, tick.t, this.#host.cap())
      this.#library.liveTick(tick.t, tick.submits, tick.denies, tick.belief)
      this.invalidate()
    }
    const onEnd = (end: LiveEnd): void => {
      if (!view.live) return
      view.live.ended = true
      view.live.shares = Array.isArray(end.shares) ? end.shares : null
      this.invalidate()
    }
    this.#off.push(this.#host.on('tick', onTick), this.#host.on('end', onEnd))
    for (const event of early) {
      if (event.type === 'tick') onTick(event.tick)
      else onEnd(event.end)
    }
    this.#paintLegend()
  }

  /* ---- controls ---- */

  #bind(): void {
    const view = this.#view
    const signal = this.#abort.signal
    const act = (name: string, fn: (value: string) => void): void => {
      bindControl(
        document,
        name,
        (value) => {
          fn(value)
          this.#rest()
          this.invalidate()
        },
        signal,
      )
    }
    act('go-pack', (v) => {
      this.#usePack(v)
    })
    act('go-match', (v) => {
      const n = Number(v)
      if (n === 1 || n === 2 || n === 3) view.match = n
    })
    act('go-tick', (v) => {
      if (v.trim() !== '') this.#seek(Number(v))
    })
    act('go-mode', (v) => {
      const mode = MODES.find((m) => m === v)
      if (mode) view.mode = mode
    })
    act('go-focus', (v) => {
      const roster = view.live ? view.live.roster : (this.#pack()?.pack.roster ?? [])
      if (roster.includes(v)) view.focus = v
    })
    act('go-cell', (v) => {
      view.cell = v.trim()
    })
    act('go-unit', (v) => {
      view.unit = v.trim()
    })
    act('go-order', (v) => {
      const n = Math.round(Number(v))
      if (Number.isFinite(n) && n >= 0) view.order = n
    })
    act('go-preset', (v) => {
      this.#preset = v.trim()
    })
    act('do-promote', () => {
      this.#promote()
    })

    this.#play.addEventListener(
      'click',
      () => {
        this.#playing = !this.#playing
        this.#playedAt = 0
        if (this.#playing && view.tick >= this.#lastTick()) view.tick = 0
        this.invalidate()
      },
      { signal },
    )
    this.#follow.addEventListener(
      'click',
      () => {
        this.#following = true
        this.invalidate()
      },
      { signal },
    )
    this.#map.onPick = (cell) => {
      view.cell = cell
      const field = fieldOf(document, 'go-cell')
      if (field) field.value = cell
      this.invalidate()
    }
    this.#strip.onSeek = (tick) => {
      this.#seek(tick)
      this.invalidate()
    }
    byId('openFiles', HTMLInputElement).addEventListener(
      'change',
      (event) => {
        const input = event.currentTarget as HTMLInputElement
        this.#openLocal([...(input.files ?? [])])
      },
      { signal },
    )
    window.addEventListener(
      'resize',
      () => {
        this.#strip.fit()
        this.invalidate()
      },
      { signal },
    )
  }

  /* the controls were touched: the pause starts over, and with it the wait for the idle work */
  #rest(): void {
    if (this.#idle !== null) clearTimeout(this.#idle)
    this.#idle = setTimeout(() => {
      this.#idle = null
      if (this.#library.fillIdle()) this.#rest()
    }, IDLE_MS)
  }

  /** The page is going away: nothing of the show may fire after it. */
  stop(): void {
    this.#stopped = true
    cancelAnimationFrame(this.#frameId)
    if (this.#idle !== null) clearTimeout(this.#idle)
    this.#idle = null
    if (this.#deadline !== null) clearTimeout(this.#deadline)
    this.#deadline = null
    /* an answer to a promotion that is still on its way belongs to nobody now */
    this.#promoteSeq += 1
    this.#abort.abort()
    for (const off of this.#off.splice(0)) off()
  }

  /* whether the show may say `ready`: nothing is waited for, or it has been computed, or the deadline has come */
  #opened(): boolean {
    return this.#hold === null || this.#library.settled(this.#hold) || performance.now() >= READY_DEADLINE_MS
  }

  /* what the page shows of a match besides the view itself; equal strings - nothing to repaint */
  #stamp(match: MatchData | null): string {
    if (!match) return '-'
    const index = match.index
    const tick = this.#view.tick
    /* on the broadcast every tick shows; in a record the strip grows in steps (view/strip.ts) */
    const reach = !index ? '-' : this.#view.live || index.done === index.meta.ticks ? String(index.done) : String(Math.floor(index.done / 100))
    return `${index ? 1 : 0}/${index?.known(tick) ? 1 : 0}/${reach}/${index?.framesTo ?? 0}/${match.belief ? match.belief.skipped : -1}/${match.problem ?? ''}`
  }

  #seek(tick: number): void {
    if (!Number.isFinite(tick)) return
    const last = this.#lastTick()
    this.#view.tick = Math.max(0, Math.min(last, Math.round(tick)))
    /* on the broadcast a jump back leaves the cap; standing on the cap follows it again */
    this.#following = this.#view.tick >= last
  }

  /* the answer is the host's: the status stays empty until it arrives (Ш4-4) */
  #promote(): void {
    if (this.#preset === '' || this.#host.mode === 'none') return
    const seq = ++this.#promoteSeq
    this.#view.promote = ''
    this.#promoteDetail.textContent = tr('promoteWait')
    this.#host.promote(this.#preset).then(
      (result) => {
        if (seq !== this.#promoteSeq) return
        this.#view.promote = String(result.status)
        this.#promoteDetail.textContent = result.detail
        this.invalidate()
      },
      (error: unknown) => {
        if (seq !== this.#promoteSeq) return
        this.#promoteDetail.textContent = error instanceof Error ? error.message : String(error)
      },
    )
  }

  #openLocal(files: File[]): void {
    if (files.length === 0) return
    LocalRecord.read(files).then(
      (record) => {
        if (this.#stopped) return
        this.#problem = ''
        this.#openPacks([record.entry], record)
        this.invalidate()
      },
      (error: unknown) => {
        this.#problem = error instanceof Error ? tr(error.message) : String(error)
        this.invalidate()
      },
    )
  }

  /* ---- painting ---- */

  #colorOf = (actor: string): string => {
    const view = this.#view
    if (slotIndex(actor) < 0) return KEEPER
    const seat = view.live ? slotIndex(actor) : (this.#pack()?.pack.rotations[view.match - 1]?.indexOf(actor) ?? -1)
    return PALETTE[seat] ?? KEEPER
  }

  #paintLegend(): void {
    const roster = this.#view.live ? this.#view.live.roster : (this.#pack()?.pack.roster ?? [])
    const item = (color: string, label: string): HTMLElement => {
      const el = document.createElement('span')
      const dot = document.createElement('i')
      dot.style.background = color
      el.append(dot, label)
      return el
    }
    byId('legend', HTMLElement).replaceChildren(...roster.map((nick, seat) => item(PALETTE[seat] ?? KEEPER, nick)), item(KEEPER, tr('keeper')), item('#dd8b78', tr('diverged')))
  }

  readonly #frame = (now: number): void => {
    this.#queued = false
    if (this.#stopped) return
    const view = this.#view
    if (!view.live) this.#library.want(view.packId, view.match)
    const match = this.#match()
    const index = match?.index ?? null

    if (view.live && this.#following) {
      /* the show stands on the last tick whose truth has arrived: the tick and its score change together */
      view.tick = Math.max(0, Math.min(view.live.cap, index?.done ?? 0))
    } else if (this.#playing) {
      const last = this.#lastTick()
      const steps = this.#playedAt === 0 ? 1 : Math.floor(((now - this.#playedAt) / 1000) * PLAY_SPEED)
      if (steps > 0) {
        view.tick = Math.min(last, view.tick + steps)
        this.#playedAt = now
      }
      if (view.tick >= last) this.#playing = false
    }

    const sources = this.#sources()
    this.#anchors.show(answers(view, sources))
    const mine = diaryOwner(view, sources.pack) === view.focus
    this.#map.paint({ index, belief: mine ? sources.belief : null, tick: view.tick, mode: view.mode, cell: cellKey(view.cell), unit: view.unit, colorOf: this.#colorOf })
    this.#strip.paint(index, slotIndex(focusSlot(view, sources.pack)), view.tick)
    this.#paintControls(match)
    this.#paintCompare()
    this.#shown = this.#stamp(match)

    if (this.#readySent ? view.live !== null && view.tick !== this.#readyTick : this.#opened()) {
      /* The first `ready`: the page is painted and the pack it opened with is computed. On the
         broadcast every shown tick is a liveness mark after that (contract 6.3). */
      this.#readySent = true
      this.#readyTick = view.tick
      this.#hold = null
      if (this.#deadline !== null) clearTimeout(this.#deadline)
      this.#deadline = null
      this.#host.ready(view.tick)
    }
    if (this.#playing) this.invalidate()
  }

  /* the two compared records item by item: painted when the pair, the match or the language changes */
  #paintCompare(): void {
    const pair = comparedPair(this.#packs)
    const stamp = pair ? `${pair[0].id}/${pair[1].id}/${this.#view.match}/${document.documentElement.lang}` : ''
    if (stamp === this.#abShown) return
    this.#abShown = stamp
    const table = byId('abTable', HTMLElement)
    if (!pair) {
      table.replaceChildren()
      return
    }
    const cmp = compare(pair[0], pair[1], this.#view.match)
    const row = (cells: readonly string[], tag: 'th' | 'td', cls = ''): HTMLElement => {
      const tr = document.createElement('tr')
      tr.className = cls
      tr.append(
        ...cells.map((text) => {
          const cell = document.createElement(tag)
          cell.textContent = text
          return cell
        }),
      )
      return tr
    }
    table.replaceChildren(
      row([tr('abItem'), pair[0].id, pair[1].id, tr('abDelta')], 'th'),
      ...cmp.rows.map((r) => {
        const delta = r.a - r.b
        const line = row([tr(r.item === 'orders' ? 'ordersItem' : r.item), fixed1(r.a), fixed1(r.b), (delta > 0 ? '+' : '') + fixed1(delta)], 'td', r.item === cmp.top ? 'top' : '')
        line.lastElementChild?.classList.add(delta >= 0 ? 'up' : 'down')
        return line
      }),
    )
  }

  #paintControls(match: MatchData | null): void {
    const view = this.#view
    mirror(fieldOf(document, 'go-tick'), String(view.tick))
    mirror(fieldOf(document, 'go-match'), String(view.match))
    mirror(fieldOf(document, 'go-mode'), view.mode)
    mirror(fieldOf(document, 'go-focus'), view.focus)
    mirror(fieldOf(document, 'go-pack'), view.packId ?? '')
    mirror(fieldOf(document, 'go-preset'), this.#preset)
    const label = tr(this.#playing ? 'pause' : 'play')
    if (this.#play.textContent !== label) this.#play.textContent = label
    this.#play.hidden = view.live !== null
    this.#follow.hidden = view.live === null || this.#following

    const skipped = match?.belief?.skipped ?? 0
    const note = match?.problem ? tr('matchProblem') + match.problem : skipped > 0 ? `${tr('diarySkipped')}${skipped} (${match?.belief?.skippedWhy ?? ''})` : this.#problem
    if (note !== this.#noteShown) {
      this.#noteShown = note
      this.#note.textContent = note
      this.#note.hidden = note === ''
    }
  }
}

async function main(): Promise<void> {
  /* the workers start first and load while the host is being greeted: after `ready` the show starts nothing */
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
  let show: Show | null = null
  const library = new Library(
    () => new Worker(url),
    (match) => show?.changed(match),
  )
  /* everything the page holds: the show's timers and listeners, the workers, the worker's text */
  const release = (): void => {
    show?.stop()
    library.close()
    URL.revokeObjectURL(url)
  }
  window.addEventListener('pagehide', release, { once: true })
  /* The broadcast does not wait for the show: its ticks start the moment the host is
     greeted. Until the workers are up they are kept here, and none is lost - a tick
     that never reached the engine would leave it playing a different match. */
  const opening = openHost({ hq: NAME })
  const early: LiveEvent[] = []
  const keep = [
    window.ZARIA_HQ?.on('tick', (tick) => early.push({ type: 'tick', tick })),
    window.ZARIA_HQ?.on('end', (end) => early.push({ type: 'end', end })),
  ]
  try {
    const [host] = await Promise.all([opening, library.ready])
    /* every worker has been started (the pool starts them once, in its constructor) and has
       loaded or given up: the worker's text is not needed any more */
    URL.revokeObjectURL(url)
    show = new Show(host, library)
    show.start(early)
  } catch (error) {
    /* the show did not start: leave nothing running behind the note on the page */
    release()
    throw error
  } finally {
    for (const off of keep) off?.()
  }
}

main().catch((error: unknown) => {
  /* the page could not start at all: say so on the page, the console stays clean (P3-11) */
  const note = document.getElementById('note')
  if (!note) return
  note.textContent = error instanceof Error ? error.message : String(error)
  note.hidden = false
})
