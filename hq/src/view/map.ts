/* hq :: view/map
   The valley: terrain and needle sites on a canvas that is painted once per
   match, and over it the layer that changes with the tick - who owns a needle,
   whether it is lit, where the units stand, what the focus bot believed.

   The layer on top is repainted only when what it shows has changed: a tick in
   which nothing moved costs nothing. */

import type { Mode } from '../app/answers.ts'
import type { BeliefIndex } from '../model/belief.ts'
import type { MatchIndex } from '../model/match.ts'
import type { MatchMeta } from '../model/wire.ts'

export interface Scene {
  index: MatchIndex | null
  /** the diary of the focus; null when the focus has none */
  belief: BeliefIndex | null
  tick: number
  mode: Mode
  /** the chosen cell, `q,r`, or empty */
  cell: string
  /** the chosen enemy unit, or empty */
  unit: string
  /** the colour of an actor of this match: a slot letter or K */
  colorOf: (actor: string) => string
}

/* pixels from the centre of a hex to its corner */
const SIZE = 10
const PAD = 10
const SQRT3 = Math.sqrt(3)
/* how long a contact stays on the belief layer, ticks */
const GHOST_TICKS = 60

const TERRAIN: Readonly<Record<string, string>> = {
  bare: '#1a1815',
  meadow: '#1b2117',
  wood: '#15221a',
  sand: '#272216',
  marsh: '#152220',
  hill: '#26211c',
  water: '#101b27',
  mount: '#2c2927',
}
const UNKNOWN_LAND = '#1a1815'
const RUIN = 'rgba(242,236,226,.34)'
const SELECT = '#ffdf9f'
const DIVERGED = '#dd8b78'

export class ValleyMap {
  readonly #base: CanvasRenderingContext2D
  readonly #top: CanvasRenderingContext2D
  readonly #box: HTMLElement
  #meta: MatchMeta | null = null
  #cx = 0
  #cy = 0
  #painted = ''
  onPick: (cell: string) => void = () => undefined

  constructor(box: HTMLElement, base: HTMLCanvasElement, top: HTMLCanvasElement) {
    const b = base.getContext('2d', { alpha: false })
    const t = top.getContext('2d')
    if (!b || !t) throw new Error('the canvas is not available')
    this.#base = b
    this.#top = t
    this.#box = box
    top.addEventListener('click', (event) => {
      const cell = this.#cellAt(event.offsetX, event.offsetY)
      if (cell) this.onPick(cell)
    })
    this.#resize(20)
  }

  paint(scene: Scene): void {
    const meta = scene.index?.meta ?? null
    if (meta !== this.#meta) {
      this.#meta = meta
      this.#resize(meta?.radius ?? 20)
      this.#paintBase(meta)
      this.#painted = ''
    }
    const stamp = this.#stamp(scene)
    if (stamp === this.#painted) return
    this.#painted = stamp
    this.#paintTop(scene)
  }

  /* everything the top layer depends on, as one string: equal strings - equal pictures */
  #stamp(scene: Scene): string {
    const { index, belief, tick } = scene
    const truth = index ? `${index.changeStamp(tick)}/${index.known(tick) ? 1 : 0}` : '-'
    const believed = belief && scene.mode !== 'truth' ? `${belief.changeStamp(tick)}/${tick}` : '-'
    return `${truth}|${believed}|${scene.mode}|${scene.cell}|${scene.unit}`
  }

  #resize(radius: number): void {
    const played = Math.max(1, radius - 1)
    const width = Math.ceil(SIZE * SQRT3 * (2 * played + 1)) + PAD * 2
    const height = Math.ceil(SIZE * (3 * played + 2)) + PAD * 2
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    for (const ctx of [this.#base, this.#top]) {
      const canvas = ctx.canvas
      if (canvas.width === width * ratio && canvas.height === height * ratio) continue
      canvas.width = width * ratio
      canvas.height = height * ratio
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    this.#box.style.width = `${width}px`
    this.#box.style.height = `${height}px`
    this.#cx = width / 2
    this.#cy = height / 2
  }

  #x(q: number, r: number): number {
    return this.#cx + SIZE * SQRT3 * (q + r / 2)
  }

  #y(r: number): number {
    return this.#cy + SIZE * 1.5 * r
  }

  #cellAt(px: number, py: number): string | null {
    const meta = this.#meta
    if (!meta) return null
    const fr = (py - this.#cy) / (SIZE * 1.5)
    const fq = (px - this.#cx) / (SIZE * SQRT3) - fr / 2
    /* cube rounding */
    const fs = -fq - fr
    let q = Math.round(fq)
    let r = Math.round(fr)
    const s = Math.round(fs)
    const dq = Math.abs(q - fq)
    const dr = Math.abs(r - fr)
    const ds = Math.abs(s - fs)
    if (dq > dr && dq > ds) q = -r - s
    else if (dr > ds) r = -q - s
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) < meta.radius ? `${q},${r}` : null
  }

  #hex(ctx: CanvasRenderingContext2D | Path2D, q: number, r: number, size: number): void {
    const x = this.#x(q, r)
    const y = this.#y(r)
    const w = (size * SQRT3) / 2
    ctx.moveTo(x, y - size)
    ctx.lineTo(x + w, y - size / 2)
    ctx.lineTo(x + w, y + size / 2)
    ctx.lineTo(x, y + size)
    ctx.lineTo(x - w, y + size / 2)
    ctx.lineTo(x - w, y - size / 2)
    ctx.closePath()
  }

  #paintBase(meta: MatchMeta | null): void {
    const ctx = this.#base
    const { width, height } = ctx.canvas
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = '#0f0d0b'
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
    if (!meta) return

    const played = meta.radius - 1
    const land = new Map<string, number>()
    for (const [q, r, type] of meta.cells) land.set(`${q},${r}`, type)
    const byColor = new Map<string, Path2D>()
    for (let q = -played; q <= played; q++) {
      for (let r = Math.max(-played, -q - played); r <= Math.min(played, -q + played); r++) {
        const type = meta.types[land.get(`${q},${r}`) ?? 0] ?? ''
        const color = TERRAIN[type] ?? UNKNOWN_LAND
        let path = byColor.get(color)
        if (!path) {
          path = new Path2D()
          byColor.set(color, path)
        }
        this.#hex(path, q, r, SIZE - 0.6)
      }
    }
    for (const [color, path] of byColor) {
      ctx.fillStyle = color
      ctx.fill(path)
    }

    /* the line around the Keeper's ring */
    ctx.strokeStyle = 'rgba(205,214,220,.22)'
    ctx.setLineDash([4, 5])
    ctx.beginPath()
    ctx.arc(this.#x(meta.citadel.q, meta.citadel.r), this.#y(meta.citadel.r), SIZE * SQRT3 * (meta.cherta + 0.5), 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])

    /* needle sites of the valley: a ruin until someone owns it */
    ctx.strokeStyle = RUIN
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const site of meta.needles) {
      const x = this.#x(site.q, site.r)
      const y = this.#y(site.r)
      ctx.moveTo(x + SIZE * 0.45, y)
      ctx.arc(x, y, SIZE * 0.45, 0, Math.PI * 2)
    }
    ctx.stroke()

    /* the hearths */
    ctx.strokeStyle = 'rgba(242,236,226,.5)'
    ctx.beginPath()
    for (const seat of meta.seats) this.#hex(ctx, seat.q, seat.r, SIZE - 1.5)
    ctx.stroke()
  }

  #paintTop(scene: Scene): void {
    const ctx = this.#top
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    ctx.restore()
    const { index, belief, tick, mode } = scene
    if (!index) return
    const known = index.known(tick)

    if (mode !== 'belief' && known) this.#paintTruth(scene, index)
    if (mode !== 'truth' && belief) this.#paintBelief(scene, index, belief, known)
    if (known) this.#paintUnits(scene, index)
    if (mode !== 'truth' && belief) this.#paintGhosts(scene, belief)

    if (scene.cell !== '') {
      const [q, r] = scene.cell.split(',').map(Number) as [number, number]
      ctx.strokeStyle = SELECT
      ctx.lineWidth = 1.5
      ctx.beginPath()
      this.#hex(ctx, q, r, SIZE - 0.5)
      ctx.stroke()
    }
  }

  #needle(x: number, y: number, color: string, lit: boolean): void {
    const ctx = this.#top
    ctx.globalAlpha = lit ? 1 : 0.4
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(x, y, SIZE * 0.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  #paintTruth(scene: Scene, index: MatchIndex): void {
    for (const [cell, changes] of index.own) {
      const who = index.ownerAt(cell, scene.tick)
      if (who === null || changes.t.length === 0) continue
      const [q, r] = cell.split(',').map(Number) as [number, number]
      this.#needle(this.#x(q, r), this.#y(r), scene.colorOf(who), index.litAt(cell, scene.tick))
    }
  }

  /* the belief layer: alone - the needles as the bot believes them; over the truth - only where it is wrong */
  #paintBelief(scene: Scene, index: MatchIndex, belief: BeliefIndex, known: boolean): void {
    const ctx = this.#top
    const { tick, mode } = scene
    for (const cell of belief.own.keys()) {
      const who = belief.ownerAt(cell, tick)
      if (who === undefined) continue
      const [q, r] = cell.split(',').map(Number) as [number, number]
      const x = this.#x(q, r)
      const y = this.#y(r)
      const dark = belief.darkAt(cell, tick)
      if (mode === 'belief') {
        if (who !== null) this.#needle(x, y, scene.colorOf(who), !dark)
        continue
      }
      if (!known || who === index.ownerAt(cell, tick)) continue
      ctx.strokeStyle = DIVERGED
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, SIZE * 0.78, 0, Math.PI * 2)
      ctx.stroke()
      if (who !== null) {
        ctx.fillStyle = scene.colorOf(who)
        ctx.beginPath()
        ctx.arc(x, y, SIZE * 0.22, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  #paintUnits(scene: Scene, index: MatchIndex): void {
    const ctx = this.#top
    ctx.lineWidth = 1
    ctx.strokeStyle = '#0d0a07'
    for (const unit of index.unitsAt(scene.tick)) {
      const x = this.#x(unit.q, unit.r)
      const y = this.#y(unit.r)
      const h = SIZE * 0.42
      ctx.fillStyle = scene.colorOf(unit.owner)
      ctx.beginPath()
      if (unit.cls === 'клинок') {
        ctx.moveTo(x, y - h * 1.25)
        ctx.lineTo(x + h * 1.1, y + h * 0.8)
        ctx.lineTo(x - h * 1.1, y + h * 0.8)
        ctx.closePath()
      } else ctx.rect(x - h, y - h, h * 2, h * 2)
      ctx.fill()
      ctx.stroke()
      if (unit.id === scene.unit) {
        ctx.strokeStyle = SELECT
        ctx.strokeRect(x - h * 1.9, y - h * 1.9, h * 3.8, h * 3.8)
        ctx.strokeStyle = '#0d0a07'
      }
    }
  }

  /* where the bot last saw the enemy units: a hollow mark that fades with the age of the memory */
  #paintGhosts(scene: Scene, belief: BeliefIndex): void {
    const ctx = this.#top
    ctx.lineWidth = 1.5
    for (const unit of belief.foe.keys()) {
      const contact = belief.contact(unit, scene.tick)
      if (!contact) continue
      const age = scene.tick - contact.t
      const chosen = unit === scene.unit
      if (age > GHOST_TICKS && !chosen) continue
      const x = this.#x(contact.q, contact.r)
      const y = this.#y(contact.r)
      ctx.globalAlpha = chosen ? 1 : Math.max(0.15, 1 - age / GHOST_TICKS)
      ctx.strokeStyle = chosen ? SELECT : scene.colorOf(contact.slot)
      ctx.beginPath()
      ctx.moveTo(x - SIZE * 0.5, y - SIZE * 0.5)
      ctx.lineTo(x + SIZE * 0.5, y + SIZE * 0.5)
      ctx.moveTo(x + SIZE * 0.5, y - SIZE * 0.5)
      ctx.lineTo(x - SIZE * 0.5, y + SIZE * 0.5)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
}
