/* Перегляд партії: карта, шкала часу з відтворенням, бокові панелі. */

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
  coverage: 'покриття',
  threads: 'нитки',
  targets: 'цілі юнитів',
  storms: 'бурі',
  eyes: 'фокус і скан',
  ghosts: 'привиди (очима бота)',
  ids: 'імена юнитів',
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

  /* відтворення: speed тактів за секунду */
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

  /* позначки на шкалі: захоплення і втрати місця у фокусі, лоти, контракти, зоря */
  const marks = useMemo(() => {
    if (!record) return [];
    const out: { t: number; color: string; title: string }[] = [];
    for (const f of record.frames) {
      for (const e of f.ev) {
        const type = e['type'];
        if (type === 'dawn') out.push({ t: f.t, color: '#b39ddb', title: 'зоря' });
        else if (type === 'lot' && e['p']) out.push({ t: f.t, color: '#ffd166', title: 'лот → ' + String(e['p']) });
        else if (type === 'orderDone') out.push({ t: f.t, color: '#ffd166', title: 'контракт виконано ' + String(e['p'] ?? '') });
        else if (focus && type === 'cap' && e['p'] === focus) out.push({ t: f.t, color: ACTOR_COLOR[focus], title: 'захоплення' });
        else if (focus && type === 'cap' && e['from'] === focus) out.push({ t: f.t, color: '#ff5252', title: 'втрата голки' });
      }
    }
    const seat = record.result.find((r) => r.slot === focus);
    for (const ep of seat?.nakazEpisodes ?? []) out.push({ t: ep.from, color: '#ffffff', title: `наказ вів слот ${ep.from}-${ep.to}` });
    return out;
  }, [record, focus]);

  if (error) return <p className="error">Запис не прочитався: {error}</p>;
  if (!record) return <p className="muted">Читаю запис партії…</p>;
  const frame = record.frames[Math.min(t, record.frames.length - 1)]!;
  const phase = frame.dawn ? 'зоря' : t < 5 ? 'старт' : 'бій';

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
            <button onClick={() => seek(0)} title="на початок">⏮</button>
            <button onClick={() => seek(t - 1)} title="такт назад (←)">◀</button>
            <button className="play" onClick={() => setPlaying(!playing)} title="пробіл">
              {playing ? '⏸' : '▶'}
            </button>
            <button onClick={() => seek(t + 1)} title="такт вперед (→)">▶|</button>
            <button onClick={() => seek(ticks)} title="на кінець">⏭</button>
            <span className="tick">
              такт <b>{t}</b> / {ticks} · {phase}
            </span>
            <label>
              швидкість{' '}
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s} т/с{s === 2 ? ' (як на вузлі)' : ''}
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
            журнал подій
          </button>
          <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>
            команди {focus ?? ''}
          </button>
          <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
            підсумок
          </button>
          <span className="muted">
            у фокусі:{' '}
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
