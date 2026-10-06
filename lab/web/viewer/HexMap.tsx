/* The valley map on a canvas: terrain (once, into a background layer), on top
   of it the tick's frame: coverage, threads, needles, heating, units, storms,
   lots, contract, our seat's eyes. Mouse hover reports the cell under the cursor,
   a click picks it (play mode), marks ring extra cells (play mode: the chosen
   unit and the targets of the orders being prepared). */

import { useEffect, useMemo, useRef, useState } from 'react';
import { NF, SLOTS, TASKS } from '../../shared/record.ts';
import type { Actor, Frame, MatchRecord, Slot } from '../../shared/record.ts';
import { corners, disc, fromPlane, hexDist, hexKey, parseKey, SQRT3, toPlane } from '../lib/hex.ts';
import { ACTOR_COLOR, FIND_GLYPH, TERRAIN_COLOR } from '../lib/look.ts';

export interface Layers {
  coverage: boolean;
  threads: boolean;
  targets: boolean;
  storms: boolean;
  eyes: boolean;
  ghosts: boolean;
  ids: boolean;
}

export const DEFAULT_LAYERS: Layers = { coverage: true, threads: true, targets: true, storms: true, eyes: true, ghosts: false, ids: false };

interface Props {
  record: MatchRecord;
  frame: Frame;
  layers: Layers;
  focusSlot: Slot | null;
  highlight: [number, number] | null;
  onHover: (cell: [number, number] | null) => void;
  onPick?: (cell: [number, number]) => void;
  marks?: { cell: [number, number]; color: string }[];
}

const COV = [1, 1, 2 / 3, 1 / 3];

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function shade(hex: string, level: number): string {
  const n = parseInt(hex.slice(1), 16);
  const k = 1 + (level - 1) * 0.09;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function HexMap({ record, frame, layers, focusSlot, highlight, onHover, onPick, marks }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState({ w: 720, h: 640 });
  const st = record.static;
  const R = st.radius;

  /* the map fits both the column width and the window height: the timeline stays on screen */
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setRoom({ w: Math.max(320, Math.floor(el.clientWidth)), h: Math.max(360, window.innerHeight - 250) });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const geo = useMemo(() => {
    const size = Math.min(room.w / (SQRT3 * (2 * R + 1) + 0.5), room.h / (1.5 * 2 * R + 2));
    const width = Math.floor(size * (SQRT3 * (2 * R + 1) + 0.5));
    const height = Math.ceil(size * (1.5 * 2 * R + 2) + 4);
    const cx = width / 2;
    const cy = height / 2;
    const px = (q: number, r: number): [number, number] => {
      const p = toPlane(q, r);
      return [cx + p.x * size, cy + p.y * size];
    };
    return { size, width, height, cx, cy, px };
  }, [room, R]);
  const width = geo.width;

  const needleInfo = useMemo(() => new Map(st.needles.map((n) => [n.k, n])), [st]);

  /* terrain: once per size */
  const terrain = useMemo(() => {
    const off = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    off.width = Math.ceil(width * dpr);
    off.height = Math.ceil(geo.height * dpr);
    const g = off.getContext('2d')!;
    g.scale(dpr, dpr);
    for (const [q, r, type, level] of st.cells) {
      const [x, y] = geo.px(q, r);
      const name = st.types[type] ?? 'bare';
      g.beginPath();
      for (const [i, [a, b]] of corners(x, y, geo.size * 0.985).entries()) (i ? g.lineTo(a, b) : g.moveTo(a, b));
      g.closePath();
      g.fillStyle = shade(TERRAIN_COLOR[name] ?? '#333', level);
      g.fill();
      if (name === 'mount') {
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x - geo.size * 0.4, y + geo.size * 0.3);
        g.lineTo(x, y - geo.size * 0.4);
        g.lineTo(x + geo.size * 0.4, y + geo.size * 0.3);
        g.stroke();
      }
    }
    /* the border (cherta radius) and the citadel */
    g.strokeStyle = 'rgba(179,157,219,0.45)';
    g.setLineDash([4, 4]);
    g.lineWidth = 1.2;
    for (const [q, r] of disc(st.citadel.q, st.citadel.r, st.cherta).filter(([, , d]) => d === st.cherta).map(([q, r]) => [q, r] as const)) {
      const [x, y] = geo.px(q, r);
      g.beginPath();
      g.arc(x, y, geo.size * 0.2, 0, Math.PI * 2);
      g.stroke();
    }
    g.setLineDash([]);
    const [cxp, cyp] = geo.px(st.citadel.q, st.citadel.r);
    g.fillStyle = 'rgba(179,157,219,0.9)';
    g.font = `${Math.round(geo.size * 1.3)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('✹', cxp, cyp);
    /* finds */
    g.font = `${Math.round(geo.size * 0.95)}px sans-serif`;
    for (const f of st.finds) {
      const [x, y] = geo.px(f.q, f.r);
      g.fillStyle = f.kind === 'cache' ? '#ffd166' : f.kind === 'dead' ? '#ff8a80' : '#e0e0e0';
      g.fillText(FIND_GLYPH[f.kind] ?? '?', x, y);
    }
    return off;
  }, [st, geo, width]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.ceil(width * dpr);
    c.height = Math.ceil(geo.height * dpr);
    c.style.width = width + 'px';
    c.style.height = geo.height + 'px';
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, geo.height);
    g.drawImage(terrain, 0, 0, width, geo.height);
    const s = geo.size;
    const t = frame.t;

    const hexPath = (q: number, r: number, k = 0.98) => {
      const [x, y] = geo.px(q, r);
      g.beginPath();
      for (const [i, [a, b]] of corners(x, y, s * k).entries()) (i ? g.lineTo(a, b) : g.moveTo(a, b));
      g.closePath();
    };

    /* coverage: who pulls the cell, by the ring weights of 8.1 */
    if (layers.coverage) {
      const pull = new Map<string, Partial<Record<Actor, number>>>();
      for (const [key, owner, weight, flags] of frame.n) {
        if (weight <= 0 || flags & NF.jam) continue;
        const [q, r] = parseKey(key);
        for (const [cq, cr, d] of disc(q, r, 3)) {
          if (hexDist(0, 0, cq, cr) > R) continue;
          const k = hexKey(cq, cr);
          const row = pull.get(k) ?? {};
          row[owner] = (row[owner] ?? 0) + (COV[d] ?? 0) * Math.min(weight, 2);
          pull.set(k, row);
        }
      }
      for (const [k, row] of pull) {
        let best: Actor | null = null;
        let bestV = 0;
        let total = 0;
        for (const [a, v] of Object.entries(row) as [Actor, number][]) {
          total += v;
          if (v > bestV) [best, bestV] = [a, v];
        }
        if (!best) continue;
        const [q, r] = parseKey(k);
        hexPath(q, r);
        g.fillStyle = rgba(ACTOR_COLOR[best], Math.min(0.42, 0.14 + total * 0.16));
        g.fill();
      }
    }

    /* lots before opening and the contract */
    for (const [i, lot] of st.lots.entries()) {
      if (t >= lot.at) continue;
      for (const cell of lot.cells) {
        hexPath(cell.q, cell.r, 0.9);
        g.strokeStyle = 'rgba(255,209,102,0.85)';
        g.setLineDash([3, 3]);
        g.lineWidth = 1.5;
        g.stroke();
        g.setLineDash([]);
        const [x, y] = geo.px(cell.q, cell.r);
        g.fillStyle = 'rgba(255,209,102,0.9)';
        g.font = `${Math.round(s * 0.6)}px sans-serif`;
        g.fillText('L' + i, x + s * 0.55, y - s * 0.55);
      }
    }
    if (frame.order) {
      for (const key of frame.order.cells) {
        const [q, r] = parseKey(key);
        hexPath(q, r, 1.05);
        g.strokeStyle = '#ffd166';
        g.lineWidth = 2.5;
        g.stroke();
      }
    }

    /* storms (the plane of rules 5.1 at cell scale) */
    if (layers.storms) {
      for (const storm of st.storms) {
        const x = geo.cx + (storm.x0 + storm.vx * t) * s;
        const y = geo.cy + (storm.y0 + storm.vy * t) * s;
        g.beginPath();
        g.arc(x, y, storm.r * s, 0, Math.PI * 2);
        g.fillStyle = 'rgba(160,190,255,0.10)';
        g.fill();
        g.strokeStyle = 'rgba(160,190,255,0.5)';
        g.lineWidth = 1;
        g.stroke();
      }
    }

    /* threads: lit needles of one owner within the thread length */
    if (layers.threads) {
      const byOwner = new Map<Actor, [number, number][]>();
      for (const [key, owner, weight] of frame.n) {
        if (weight <= 0) continue;
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), parseKey(key)]);
      }
      for (const slot of SLOTS) {
        const seat = st.seats[slot];
        byOwner.set(slot, [[seat.q, seat.r], ...(byOwner.get(slot) ?? [])]);
      }
      for (const [owner, list] of byOwner) {
        g.strokeStyle = rgba(ACTOR_COLOR[owner], 0.35);
        g.lineWidth = 1;
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const [aq, ar] = list[i]!;
            const [bq, br] = list[j]!;
            if (hexDist(aq, ar, bq, br) > st.linkRange) continue;
            const [x1, y1] = geo.px(aq, ar);
            const [x2, y2] = geo.px(bq, br);
            g.beginPath();
            g.moveTo(x1, y1);
            g.lineTo(x2, y2);
            g.stroke();
          }
        }
      }
    }

    /* ruins: all manifest needles that are not among the owned ones */
    const owned = new Set(frame.n.map(([k]) => k));
    for (const n of st.needles) {
      if (owned.has(n.k)) continue;
      const [x, y] = geo.px(n.q, n.r);
      g.beginPath();
      g.arc(x, y, s * 0.38, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(230,230,230,0.7)';
      g.lineWidth = 1.2;
      g.stroke();
    }
    /* owned needles */
    for (const [key, owner, weight, flags] of frame.n) {
      const [q, r] = parseKey(key);
      const [x, y] = geo.px(q, r);
      const info = needleInfo.get(key);
      const color = ACTOR_COLOR[owner];
      g.beginPath();
      g.arc(x, y, s * 0.45, 0, Math.PI * 2);
      g.fillStyle = weight > 0 ? rgba(color, 0.35 + 0.65 * Math.min(1, weight)) : 'rgba(20,20,20,0.85)';
      g.fill();
      g.lineWidth = info?.start ? 2.4 : 1.4;
      g.strokeStyle = flags & NF.crown ? '#ffd166' : color;
      g.stroke();
      if (info?.ring) {
        g.beginPath();
        g.arc(x, y, s * 0.62, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(179,157,219,0.6)';
        g.lineWidth = 1;
        g.stroke();
      }
      if (flags & NF.fed) {
        g.beginPath();
        g.arc(x, y, s * 0.12, 0, Math.PI * 2);
        g.fillStyle = '#fff';
        g.fill();
      }
      if (flags & NF.jam) {
        g.strokeStyle = '#ff5252';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x - s * 0.35, y - s * 0.35);
        g.lineTo(x + s * 0.35, y + s * 0.35);
        g.moveTo(x + s * 0.35, y - s * 0.35);
        g.lineTo(x - s * 0.35, y + s * 0.35);
        g.stroke();
      }
    }
    /* heating: a progress arc in the colour of whoever heats */
    const ownerOf = new Map(frame.n.map(([k, o, w]) => [k, { o, w }]));
    for (const [key, who, progress] of frame.heat) {
      const [q, r] = parseKey(key);
      const [x, y] = geo.px(q, r);
      const cur = ownerOf.get(key);
      const price = !cur || (cur.o === 'K' && frame.dawn) ? 8 : cur.w > 0 ? 24 : 16;
      g.beginPath();
      g.arc(x, y, s * 0.72, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress / price));
      g.strokeStyle = ACTOR_COLOR[who];
      g.lineWidth = 3;
      g.stroke();
    }

    /* hearths */
    for (const slot of SLOTS) {
      const seat = st.seats[slot];
      const [x, y] = geo.px(seat.q, seat.r);
      g.beginPath();
      for (const [i, [a, b]] of corners(x, y, s * 0.95).entries()) (i ? g.lineTo(a, b) : g.moveTo(a, b));
      g.closePath();
      g.fillStyle = rgba(ACTOR_COLOR[slot], 0.9);
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#111';
      g.font = `bold ${Math.round(s * 0.95)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(slot, x, y + 1);
    }

    /* units and lines to their targets */
    for (const [id, owner, cls, q, r, task, tq, tr, flags] of frame.u) {
      const [x, y] = geo.px(q, r);
      const color = ACTOR_COLOR[owner];
      if (layers.targets && task && tq !== null && tr !== null) {
        const [x2, y2] = geo.px(tq, tr);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x2, y2);
        g.strokeStyle = rgba(color, TASKS[task] === 'jam' || TASKS[task] === 'ram' ? 0.9 : 0.55);
        g.setLineDash(TASKS[task] === 'needle' ? [2, 2] : [5, 3]);
        g.lineWidth = 1.2;
        g.stroke();
        g.setLineDash([]);
      }
      const k = s * 0.5;
      g.beginPath();
      if (cls === 0) g.rect(x - k * 0.8, y - k * 0.8, k * 1.6, k * 1.6);
      else {
        g.moveTo(x, y - k);
        g.lineTo(x + k * 0.95, y + k * 0.75);
        g.lineTo(x - k * 0.95, y + k * 0.75);
        g.closePath();
      }
      g.fillStyle = flags & 1 ? 'rgba(0,0,0,0.6)' : color;
      g.fill();
      g.strokeStyle = flags & 2 ? '#ffeb3b' : '#0b0b0b';
      g.lineWidth = 1.3;
      g.stroke();
      if (layers.ids) {
        g.fillStyle = '#fff';
        g.font = `${Math.round(s * 0.55)}px sans-serif`;
        g.fillText(id, x, y - k - s * 0.3);
      }
    }

    /* the eyes of the focused seat: the tick's focus and scan; ghosts the bot saw */
    if (layers.eyes && focusSlot) {
      const eye = frame.eye[focusSlot];
      if (eye?.watch) {
        const [x, y] = geo.px(eye.watch.q, eye.watch.r);
        g.strokeStyle = rgba(ACTOR_COLOR[focusSlot], 0.9);
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(x, y, s * 0.8, 0, Math.PI * 2);
        g.moveTo(x - s, y);
        g.lineTo(x + s, y);
        g.moveTo(x, y - s);
        g.lineTo(x, y + s);
        g.stroke();
      }
      if (eye?.scan) {
        const [x, y] = geo.px(eye.scan.q, eye.scan.r);
        g.beginPath();
        g.arc(x, y, s * SQRT3 * (eye.scan.rad + 0.5), 0, Math.PI * 2);
        g.fillStyle = rgba(ACTOR_COLOR[focusSlot], 0.12);
        g.fill();
        g.strokeStyle = rgba(ACTOR_COLOR[focusSlot], 0.8);
        g.stroke();
      }
    }
    if (layers.ghosts && frame.seen) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = `bold ${Math.round(s * 0.8)}px sans-serif`;
      for (const [q, r] of frame.seen.noisy) {
        const [x, y] = geo.px(q, r);
        g.fillText('?', x, y);
      }
    }

    for (const m of marks ?? []) {
      hexPath(m.cell[0], m.cell[1], 1.15);
      g.strokeStyle = m.color;
      g.lineWidth = 2;
      g.setLineDash([4, 3]);
      g.stroke();
      g.setLineDash([]);
    }
    if (highlight) {
      hexPath(highlight[0], highlight[1], 1.25);
      g.strokeStyle = '#fff';
      g.lineWidth = 2.5;
      g.stroke();
    }
  }, [frame, layers, focusSlot, highlight, marks, terrain, geo, width, st, needleInfo, R]);

  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>): [number, number] | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - geo.cx) / geo.size;
    const y = (e.clientY - rect.top - geo.cy) / geo.size;
    const [q, r] = fromPlane(x, y);
    return hexDist(0, 0, q, r) <= R ? [q, r] : null;
  };

  return (
    <div ref={box} className="map">
      <canvas
        ref={canvas}
        className={onPick ? 'pick' : undefined}
        onMouseMove={(e) => onHover(cellAt(e))}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          const c = cellAt(e);
          if (c && onPick) onPick(c);
        }}
      />
    </div>
  );
}
