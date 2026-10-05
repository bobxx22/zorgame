/* Match viewer: map, timeline with playback, side panels. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SLOTS } from '../../shared/record.ts';
import type { MatchRecord, RunMeta, Slot } from '../../shared/record.ts';
import { api } from '../lib/api.ts';
import { ACTOR_COLOR } from '../lib/look.ts';
import { DEFAULT_LAYERS, HexMap } from './HexMap.tsx';
import type { Layers } from './HexMap.tsx';
import { CellInfo, Chart, Events, Orders, Players, Summary } from './panels.tsx';

const SPEEDS = [2, 10, 30, 90, 240];
const LAYER_NAME: Record<keyof Layers, string> = {
  coverage: 'coverage',
  threads: 'threads',
  targets: 'unit targets',
  storms: 'storms',
  eyes: 'focus and scan',
  ghosts: 'ghosts (the bot\'s view)',
  ids: 'unit names',
};

type Tab = 'events' | 'orders' | 'summary';

export function Viewer({ run, match }: { run: RunMeta; match: number }) {
  const [record, setRecord] = useState<MatchRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  const [focus, setFocus] = useState<Slot | null>(null);
  const [tab, setTab] = useState<Tab>('events');
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [highlight, setHighlight] = useState<[number, number] | null>(null);

  useEffect(() => {
    let alive = true;
    setRecord(null);
    setError(null);
    api
      .match(run.id, match)
      .then((r) => {
        if (!alive) return;
        setRecord(r);
        setT(r.meta.ticks);
        setFocus(r.meta.ours ?? 'A');
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [run.id, match]);

  const ticks = record?.meta.ticks ?? 0;
  const seek = useCallback(
    (to: number, cell: [number, number] | null = null) => {
      setT(Math.max(0, Math.min(ticks, to)));
      setHighlight(cell);
    },
    [ticks],
  );

  /* playback: speed in ticks per second */
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let acc = 0;
    const loop = (now: number) => {
      if (last.current !== null) acc += ((now - last.current) / 1000) * speed;
      last.current = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        setT((cur) => {
          const next = Math.min(ticks, cur + step);
          if (next >= ticks) setPlaying(false);
          return next;
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed, ticks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'ArrowRight') seek(t + (e.shiftKey ? 25 : 1));
      else if (e.key === 'ArrowLeft') seek(t - (e.shiftKey ? 25 : 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [t, seek]);

  /* timeline marks: captures and losses of the focused seat, lots, contracts, dawn */
  const marks = useMemo(() => {
    if (!record) return [];
    const out: { t: number; color: string; title: string }[] = [];
    for (const f of record.frames) {
      for (const e of f.ev) {
        const type = e['type'];
        if (type === 'dawn') out.push({ t: f.t, color: '#b39ddb', title: 'dawn' });
        else if (type === 'lot' && e['p']) out.push({ t: f.t, color: '#ffd166', title: 'lot → ' + String(e['p']) });
        else if (type === 'orderDone') out.push({ t: f.t, color: '#ffd166', title: 'contract done ' + String(e['p'] ?? '') });
        else if (focus && type === 'cap' && e['p'] === focus) out.push({ t: f.t, color: ACTOR_COLOR[focus], title: 'capture' });
        else if (focus && type === 'cap' && e['from'] === focus) out.push({ t: f.t, color: '#ff5252', title: 'needle lost' });
      }
    }
    const seat = record.result.find((r) => r.slot === focus);
    for (const ep of seat?.nakazEpisodes ?? []) out.push({ t: ep.from, color: '#ffffff', title: `nakaz ran the slot ${ep.from}-${ep.to}` });
    return out;
  }, [record, focus]);

  if (error) return <p className="error">The record could not be read: {error}</p>;
  if (!record) return <p className="muted">Reading the match record…</p>;
  const frame = record.frames[Math.min(t, record.frames.length - 1)]!;
  const phase = frame.dawn ? 'dawn' : t < 5 ? 'start' : 'battle';

  return (
    <div className="viewer">
      <section className="left">
        <HexMap record={record} frame={frame} layers={layers} focusSlot={focus} highlight={highlight} onHover={setHover} />
        <div className="timeline">
          <div className="marks">
            {marks.map((m, i) => (
              <span key={i} title={`${m.t}: ${m.title}`} style={{ left: `${(m.t / ticks) * 100}%`, background: m.color }} onClick={() => seek(m.t)} />
            ))}
          </div>
          <input type="range" min={0} max={ticks} value={t} onChange={(e) => seek(Number(e.target.value))} />
          <div className="controls">
            <button onClick={() => seek(0)} title="to the start">⏮</button>
            <button onClick={() => seek(t - 1)} title="tick back (←)">◀</button>
            <button className="play" onClick={() => setPlaying(!playing)} title="space">
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => seek(t + 1)} title="tick forward (→)">▶|</button>
            <button onClick={() => seek(ticks)} title="to the end">⏭</button>
            <span className="tick">
              tick <b>{t}</b> / {ticks} · {phase}
            </span>
            <label>
              speed{' '}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s} t/s{s === 2 ? ' (as on the node)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="layers">
            {(Object.keys(LAYER_NAME) as (keyof Layers)[]).map((k) => (
              <label key={k}>
                <input type="checkbox" checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} /> {LAYER_NAME[k]}
              </label>
            ))}
          </div>
        </div>
        <CellInfo record={record} frame={frame} cell={hover} />
      </section>
      <section className="right">
        <Players record={record} frame={frame} focus={focus} onFocus={setFocus} />
        <Chart record={record} t={t} onSeek={(x) => seek(x)} />
        <div className="tabs">
          <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>
            event journal
          </button>
          <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
            orders {focus ?? ''}
          </button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
            summary
          </button>
          <span className="muted">
            in focus:{' '}
            {SLOTS.map((s) => (
              <button key={s} className={'mini' + (s === focus ? ' on' : '')} style={{ color: ACTOR_COLOR[s] }} onClick={() => setFocus(s)}>
                {s}
              </button>
            ))}
          </span>
        </div>
        {tab === 'events' && <Events record={record} t={t} onSeek={seek} />}
        {tab === 'orders' && focus && <Orders record={record} slot={focus} t={t} onSeek={(x) => seek(x)} />}
        {tab === 'summary' && <Summary record={record} />}
      </section>
    </div>
  );
}
