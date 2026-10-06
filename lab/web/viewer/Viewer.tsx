/* Match viewer: map, timeline with playback, side panels. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { seatText, SLOTS } from '../../shared/record.ts';
import type { MatchRecord, RunMeta, Slot } from '../../shared/record.ts';
import { api } from '../lib/api.ts';
import { tr, useLang } from '../lib/i18n.ts';
import { ACTOR_COLOR } from '../lib/look.ts';
import { DEFAULT_LAYERS, HexMap } from './HexMap.tsx';
import type { Layers } from './HexMap.tsx';
import { CellInfo, Chart, Events, Orders, Players, Summary } from './panels.tsx';

const SPEEDS = [2, 10, 30, 90, 240];
const LAYER_NAME: Record<keyof Layers, [string, string]> = {
  coverage: ['coverage', 'покриття'],
  threads: ['threads', 'нитки'],
  targets: ['unit targets', 'цілі юнитів'],
  storms: ['storms', 'бурі'],
  eyes: ['focus and scan', 'фокус і скан'],
  ghosts: ["ghosts (the bot's view)", 'привиди (очима бота)'],
  ids: ['unit names', 'імена юнитів'],
};

type Tab = 'events' | 'orders' | 'summary';

export function Viewer({ run, match }: { run: RunMeta; match: number }) {
  const lang = useLang();
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

  /* seat labels in the panel's language, from the run's lineup (the record keeps the line it was played with) */
  const shown = useMemo(() => {
    if (!record) return null;
    const labels = { ...record.meta.labels };
    for (const s of SLOTS) {
      const spec = run.request.lineup[record.meta.seating[s] ?? -1];
      if (spec) labels[s] = spec.kind === 'human' ? (lang === 'uk' ? 'людина' : 'human') : seatText(spec, lang);
    }
    return { ...record, meta: { ...record.meta, labels } };
  }, [record, run, lang]);

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
        if (type === 'dawn') out.push({ t: f.t, color: '#b39ddb', title: tr('dawn', 'зоря') });
        else if (type === 'lot' && e['p']) out.push({ t: f.t, color: '#ffd166', title: tr('lot → ', 'лот → ') + String(e['p']) });
        else if (type === 'orderDone') out.push({ t: f.t, color: '#ffd166', title: tr('contract done ', 'контракт виконано ') + String(e['p'] ?? '') });
        else if (focus && type === 'cap' && e['p'] === focus) out.push({ t: f.t, color: ACTOR_COLOR[focus], title: tr('capture', 'захоплення') });
        else if (focus && type === 'cap' && e['from'] === focus) out.push({ t: f.t, color: '#ff5252', title: tr('needle lost', 'втрата голки') });
      }
    }
    const seat = record.result.find((r) => r.slot === focus);
    for (const ep of seat?.nakazEpisodes ?? []) out.push({ t: ep.from, color: '#ffffff', title: `${tr('nakaz ran the slot', 'наказ вів слот')} ${ep.from}-${ep.to}` });
    return out;
  }, [record, focus, lang]);

  if (error) return <p className="error">{tr('The record could not be read', 'Запис не прочитався')}: {error}</p>;
  if (!record) return <p className="muted">{tr('Reading the match record…', 'Читаю запис партії…')}</p>;
  const view = shown ?? record;
  const frame = record.frames[Math.min(t, record.frames.length - 1)]!;
  const phase = frame.dawn ? tr('dawn', 'зоря') : t < 5 ? tr('start', 'старт') : tr('battle', 'бій');

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
            <button onClick={() => seek(0)} title={tr('to the start', 'на початок')}>⏮</button>
            <button onClick={() => seek(t - 1)} title={tr('tick back (←)', 'такт назад (←)')}>◀</button>
            <button className="play" onClick={() => setPlaying(!playing)} title={tr('space', 'пробіл')}>
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => seek(t + 1)} title={tr('tick forward (→)', 'такт вперед (→)')}>▶|</button>
            <button onClick={() => seek(ticks)} title={tr('to the end', 'на кінець')}>⏭</button>
            <span className="tick">
              {tr('tick', 'такт')} <b>{t}</b> / {ticks} · {phase}
            </span>
            <label>
              {tr('speed', 'швидкість')}{' '}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s} {tr('t/s', 'т/с')}{s === 2 ? tr(' (as on the node)', ' (як на вузлі)') : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="layers">
            {(Object.keys(LAYER_NAME) as (keyof Layers)[]).map((k) => (
              <label key={k}>
                <input type="checkbox" checked={layers[k]} onChange={() => setLayers({ ...layers, [k]: !layers[k] })} /> {tr(...LAYER_NAME[k])}
              </label>
            ))}
          </div>
        </div>
        <CellInfo record={view} frame={frame} cell={hover} />
      </section>
      <section className="right">
        <Players record={view} frame={frame} focus={focus} onFocus={setFocus} />
        <Chart record={record} t={t} onSeek={(x) => seek(x)} />
        <div className="tabs">
          <button className={tab === 'events' ? 'on' : ''} onClick={() => setTab('events')}>
            {tr('event journal', 'журнал подій')}
          </button>
          <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
            {tr('orders', 'команди')} {focus ?? ''}
          </button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
            {tr('summary', 'підсумок')}
          </button>
          <span className="muted">
            {tr('in focus', 'у фокусі')}:{' '}
            {SLOTS.map((s) => (
              <button key={s} className={'mini' + (s === focus ? ' on' : '')} style={{ color: ACTOR_COLOR[s] }} onClick={() => setFocus(s)}>
                {s}
              </button>
            ))}
          </span>
        </div>
        {tab === 'events' && <Events record={record} t={t} onSeek={seek} />}
        {tab === 'orders' && focus && <Orders record={record} slot={focus} t={t} onSeek={(x) => seek(x)} />}
        {tab === 'summary' && <Summary record={view} />}
      </section>
    </div>
  );
}
