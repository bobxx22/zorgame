/* hq :: view/strip
   The channel of the focus over the whole match on one strip: the bytes of
   every orders frame as a bar, the ticks with denials as marks on top, the
   score as a line. It is painted when the data changes, not when the tick
   does: the tick is a cursor that slides over it. A click is a jump. */

import type { MatchIndex } from '../model/match.ts'

const HEIGHT = 72
const BYTES = 'rgba(238,185,104,.75)'
const DENIED = '#dd8b78'
const SCORE = 'rgba(205,214,220,.55)'

export class ChannelStrip {
  readonly #ctx: CanvasRenderingContext2D
  readonly #box: HTMLElement
  readonly #cursor: HTMLElement
  #width = 0
  #ticks = 0
  #painted = ''
  #at = -1
  onSeek: (tick: number) => void = () => undefined

  constructor(box: HTMLElement, canvas: HTMLCanvasElement, cursor: HTMLElement) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('the canvas is not available')
    this.#ctx = ctx
    this.#box = box
    this.#cursor = cursor
    const seek = (event: PointerEvent): void => {
      if (this.#ticks <= 0 || this.#width <= 0) return
      const x = Math.max(0, Math.min(this.#width, event.offsetX))
      this.onSeek(Math.round((x / this.#width) * this.#ticks))
    }
    box.addEventListener('pointerdown', (event) => {
      box.setPointerCapture(event.pointerId)
      seek(event)
    })
    box.addEventListener('pointermove', (event) => {
      if (event.buttons !== 0) seek(event)
    })
  }

  /** Fits the canvas to its box; called at start and when the window changes. */
  fit(): void {
    const width = Math.floor(this.#box.clientWidth)
    if (width === this.#width || width <= 0) return
    this.#width = width
    const canvas = this.#ctx.canvas
    canvas.width = width
    canvas.height = HEIGHT
    this.#painted = ''
    this.#at = -1
  }

  paint(index: MatchIndex | null, slot: number, tick: number): void {
    const ticks = index?.meta.ticks ?? 0
    /* the score line grows while the truth is being computed: repaint it in steps, not every chunk */
    const stamp = index ? `${ticks}/${slot}/${index.framesTo}/${index.done === ticks ? 'all' : Math.floor(index.done / 100)}` : '-'
    if (stamp !== this.#painted || ticks !== this.#ticks) {
      this.#painted = stamp
      this.#ticks = ticks
      this.#paintChart(index, slot)
      this.#at = -1
    }
    const x = ticks > 0 ? Math.round((Math.min(tick, ticks) / ticks) * this.#width) : 0
    if (x !== this.#at) {
      this.#at = x
      this.#cursor.style.transform = `translateX(${x}px)`
    }
  }

  #paintChart(index: MatchIndex | null, slot: number): void {
    const ctx = this.#ctx
    const width = this.#width
    ctx.clearRect(0, 0, width, HEIGHT)
    if (!index || slot < 0 || width <= 0) return
    const ticks = index.meta.ticks
    const step = width / ticks

    let top = 1
    for (let t = 1; t <= index.framesTo; t++) top = Math.max(top, index.bytesAt(slot, t))
    ctx.fillStyle = BYTES
    for (let t = 1; t <= index.framesTo; t++) {
      const bytes = index.bytesAt(slot, t)
      if (bytes === 0) continue
      const h = Math.max(1, (bytes / top) * (HEIGHT - 14))
      ctx.fillRect((t - 1) * step, HEIGHT - h, Math.max(1, step), h)
    }
    ctx.fillStyle = DENIED
    for (let t = 1; t <= index.framesTo; t++) {
      const denied = index.deniesAt(slot, t).length
      if (denied > 0) ctx.fillRect((t - 1) * step, 2, Math.max(1, step), Math.min(10, 2 + denied * 2))
    }

    if (index.done < 1) return
    const best = Math.max(1, index.scoreAt(0, index.done), index.scoreAt(1, index.done), index.scoreAt(2, index.done))
    ctx.strokeStyle = SCORE
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let t = 0; t <= index.done; t += 4) {
      const y = HEIGHT - 1 - (index.scoreAt(slot, t) / best) * (HEIGHT - 16)
      if (t === 0) ctx.moveTo(0, y)
      else ctx.lineTo(t * step, y)
    }
    ctx.stroke()
  }
}
