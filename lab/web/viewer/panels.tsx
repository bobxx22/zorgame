/* Бокові панелі перегляду: гравці на такті, графік рахунку, журнал подій,
   команди місця з вердиктами, підсумок партії, сота під курсором. */

import { useMemo, useState } from 'react';
import { NF, P, SLOTS, TASKS } from '../../shared/record.ts';
import type { Actor, Frame, MatchRecord, Slot } from '../../shared/record.ts';
import { hexKey } from '../lib/hex.ts';
import { ACTOR_COLOR, DENY, EVENT_NAME, eventText, fmt, orderText, TERRAIN_NAME, FIND_NAME } from '../lib/look.ts';

const Dot = ({ a }: { a: Actor }) => <span className="dot" style={{ background: ACTOR_COLOR[a] }} />;

export function Players({ record, frame, focus, onFocus }: { record: MatchRecord; frame: Frame; focus: Slot | null; onFocus: (s: Slot) => void }) {
  const rank = [...SLOTS].sort((a, b) => frame.p[b][P.score] - frame.p[a][P.score]);
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>місце</th>
          <th>хто</th>
          <th title="рахунок: хвилини + контракти - податок угоди">рахунок</th>
          <th>заряд</th>
          <th title="горить / усього голок">голки</th>
          <th>юнити</th>
          <th title="канал: залишок / бюджет такту">канал</th>
        </tr>
      </thead>
      <tbody>
        {rank.map((s, i) => {
          const row = frame.p[s];
          return (
            <tr key={s} className={s === focus ? 'sel' : ''} onClick={() => onFocus(s)}>
              <td>{i + 1}</td>
              <td>
                <Dot a={s} /> {s} · {record.meta.labels[s]}
                {record.meta.ours === s && <b className="tag">наш</b>}
              </td>
              <td className="num">{fmt(row[P.score])}</td>
              <td className="num">{fmt(row[P.energy], 0)}</td>
              <td className="num">
                {row[P.lit]} / {row[P.needles]}
              </td>
              <td className="num">{row[P.units]}</td>
              <td className="num">
                {row[P.chan]} / {row[P.chanAt]}
              </td>
            </tr>
          );
        })}
        <tr className="keeper">
          <td>—</td>
          <td>
            <Dot a="K" /> Хранитель
          </td>
          <td />
          <td className="num">{fmt(frame.p.K[P.energy], 0)}</td>
          <td className="num">
            {frame.p.K[P.lit]} / {frame.p.K[P.needles]}
          </td>
          <td className="num">{frame.p.K[P.units]}</td>
          <td />
        </tr>
      </tbody>
    </table>
  );
}

type Metric = 'score' | 'energy' | 'lit' | 'units';
const METRIC: Record<Metric, { i: number; name: string }> = {
  score: { i: P.score, name: 'рахунок' },
  energy: { i: P.energy, name: 'заряд' },
  lit: { i: P.lit, name: 'горить голок' },
  units: { i: P.units, name: 'юнити' },
};

export function Chart({ record, t, onSeek }: { record: MatchRecord; t: number; onSeek: (t: number) => void }) {
  const [metric, setMetric] = useState<Metric>('score');
  const W = 420;
  const H = 150;
  const frames = record.frames;
  const series = useMemo(() => {
    const idx = METRIC[metric].i;
    let max = 1;
    for (const f of frames) for (const s of SLOTS) max = Math.max(max, f.p[s][idx] ?? 0);
    const step = Math.max(1, Math.floor(frames.length / 400));
    const lines = SLOTS.map((s) => {
      const pts: string[] = [];
      for (let i = 0; i < frames.length; i += step) {
        const f = frames[i]!;
        pts.push(`${((f.t / record.meta.ticks) * W).toFixed(1)},${(H - ((f.p[s][idx] ?? 0) / max) * (H - 8)).toFixed(1)}`);
      }
      return { s, pts: pts.join(' ') };
    });
    return { lines, max };
  }, [frames, metric, record.meta.ticks]);
  const x = (t / record.meta.ticks) * W;
  return (
    <div className="chart">
      <div className="seg">
        {(Object.keys(METRIC) as Metric[]).map((m) => (
          <button key={m} className={m === metric ? 'on' : ''} onClick={() => setMetric(m)}>
            {METRIC[m].name}
          </button>
        ))}
        <span className="muted">макс {fmt(series.max, metric === 'score' ? 1 : 0)}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(Math.round(((e.clientX - rect.left) / rect.width) * record.meta.ticks));
        }}
      >
        {record.static.dawn > 0 && record.static.dawn < record.meta.ticks && (
          <line x1={(record.static.dawn / record.meta.ticks) * W} x2={(record.static.dawn / record.meta.ticks) * W} y1={0} y2={H} className="dawn" />
        )}
        {series.lines.map(({ s, pts }) => (
          <polyline key={s} points={pts} fill="none" stroke={ACTOR_COLOR[s]} strokeWidth={record.meta.ours === s ? 2.4 : 1.4} />
        ))}
        <line x1={x} x2={x} y1={0} y2={H} className="cursor" />
      </svg>
    </div>
  );
}

const DEFAULT_HIDDEN = new Set(['note', 'scan', 'build']);

export function Events({ record, t, onSeek }: { record: MatchRecord; t: number; onSeek: (t: number, cell: [number, number] | null) => void }) {
  const [hidden, setHidden] = useState<Set<string>>(DEFAULT_HIDDEN);
  const [who, setWho] = useState<Actor | 'all'>('all');
  const [future, setFuture] = useState(false);
  const all = useMemo(() => record.frames.flatMap((f) => f.ev.map((e) => ({ t: f.t, e }))), [record]);
  const types = useMemo(() => [...new Set(all.map(({ e }) => String(e['type'])))].sort(), [all]);
  const rows = all
    .filter(({ t: et, e }) => (future || et <= t) && !hidden.has(String(e['type'])) && (who === 'all' || e['p'] === who || e['own'] === who || e['tgt'] === who))
    .slice(future ? 0 : -400)
    .reverse();
  return (
    <div className="events">
      <div className="filters">
        {types.map((type) => (
          <label key={type} className={hidden.has(type) ? 'off' : ''}>
            <input
              type="checkbox"
              checked={!hidden.has(type)}
              onChange={() => {
                const next = new Set(hidden);
                if (next.has(type)) next.delete(type);
                else next.add(type);
                setHidden(next);
              }}
            />
            {EVENT_NAME[type] ?? type}
          </label>
        ))}
      </div>
      <div className="filters">
        {(['all', ...SLOTS, 'K'] as const).map((a) => (
          <button key={a} className={who === a ? 'on' : ''} onClick={() => setWho(a)}>
            {a === 'all' ? 'усі' : a}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={future} onChange={() => setFuture(!future)} /> уся партія
        </label>
      </div>
      <ol className="log">
        {rows.map(({ t: et, e }, i) => (
          <li
            key={et + '-' + i}
            className={et === t ? 'now' : ''}
            onClick={() => onSeek(et, typeof e['q'] === 'number' ? [e['q'] as number, e['r'] as number] : null)}
          >
            <span className="t">{et}</span>
            {typeof e['p'] === 'string' && e['p'] in ACTOR_COLOR && <Dot a={e['p'] as Actor} />}
            {eventText(e)}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Orders({ record, slot, t, onSeek }: { record: MatchRecord; slot: Slot; t: number; onSeek: (t: number) => void }) {
  const [onlyDenied, setOnlyDenied] = useState(false);
  const frames = record.frames;
  const rows = onlyDenied
    ? frames.filter((f) => (f.den[slot]?.length ?? 0) > 0)
    : frames.slice(Math.max(1, t - 40), t + 1).filter((f) => (f.ord[slot]?.length ?? 0) > 0 || f.t === t);
  const ours = record.meta.ours === slot;
  const totalDenied = frames.reduce((n, f) => n + (f.den[slot]?.length ?? 0), 0);
  return (
    <div className="orders">
      <div className="filters">
        <label>
          <input type="checkbox" checked={onlyDenied} onChange={() => setOnlyDenied(!onlyDenied)} /> лише відмови (за партію: {totalDenied})
        </label>
        {ours && <span className="muted">пульс підсвічено</span>}
      </div>
      <ol className="log">
        {[...rows].reverse().map((f) => {
          const orders = (f.ord[slot] ?? []) as Record<string, unknown>[];
          const denied = new Map(f.den[slot] ?? []);
          return (
            <li key={f.t} className={f.t === t ? 'now' : ''} onClick={() => onSeek(f.t)}>
              <span className="t">{f.t}</span>
              {orders.length === 0 && <span className="muted">мовчання</span>}
              <span className="cmds">
                {orders.map((o, i) => {
                  const code = denied.get(i);
                  const pulse = ours && i === 0 && f.pulse;
                  return (
                    <span key={i} className={'cmd' + (code !== undefined ? ' denied' : '') + (pulse ? ' pulse' : '')}>
                      {orderText(o)}
                      {code !== undefined && <b> ✗ {DENY[code] ?? code}</b>}
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const BREAKDOWN: Record<string, string> = { network: 'мережа', orders: 'контракти', stolen: 'здобич глушіння', pactTax: 'податок угоди', jams: 'глушінь', rams: 'таранів', total: 'разом' };

export function Summary({ record }: { record: MatchRecord }) {
  const rows = [...record.result].sort((a, b) => a.place - b.place);
  const keys = ['network', 'orders', 'stolen', 'pactTax', 'jams', 'rams'];
  return (
    <div className="summary">
      <table className="grid">
        <thead>
          <tr>
            <th>місце</th>
            <th>хто</th>
            <th>частка</th>
            <th>рахунок</th>
            {keys.map((k) => (
              <th key={k}>{BREAKDOWN[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slot} className={record.meta.ours === r.slot ? 'sel' : ''}>
              <td>{r.place}</td>
              <td>
                <Dot a={r.slot} /> {r.slot} · {record.meta.labels[r.slot]}
              </td>
              <td className="num">{r.share}</td>
              <td className="num">{fmt(r.score)}</td>
              {keys.map((k) => (
                <td key={k} className="num">
                  {fmt(r.breakdown[k] ?? 0, k === 'jams' || k === 'rams' ? 0 : 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <table className="grid">
        <thead>
          <tr>
            <th>хто</th>
            <th>горить</th>
            <th>голок</th>
            <th>заряд</th>
            <th>команд</th>
            <th>відмов</th>
            <th>пульсів</th>
            <th title="такти, коли слот вів наказ: бот мовчав 6 тактів і довше (правила 23.2)">під наказом</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slot}>
              <td>
                <Dot a={r.slot} /> {r.slot}
              </td>
              <td className="num">{r.lit}</td>
              <td className="num">{r.needles}</td>
              <td className="num">{fmt(r.energy, 0)}</td>
              <td className="num">{r.orders}</td>
              <td className={'num' + (r.denials ? ' bad' : '')}>{r.denials}</td>
              <td className="num">{r.pulses}</td>
              <td className={'num' + (r.nakazTicks > 0 ? ' bad' : '')} title={r.nakazEpisodes.map((e) => `${e.from}-${e.to}`).join(', ')}>
                {r.nakazTicks}
                {r.nakazEpisodes.length > 0 && <span className="muted"> ({r.nakazEpisodes.length} еп.)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CellInfo({ record, frame, cell }: { record: MatchRecord; frame: Frame; cell: [number, number] | null }) {
  const info = useMemo(() => new Map(record.static.cells.map(([q, r, type, level]) => [hexKey(q, r), { type, level }])), [record]);
  if (!cell) return <div className="cellinfo muted">наведіть на соту</div>;
  const key = hexKey(cell[0], cell[1]);
  const c = info.get(key);
  const needle = frame.n.find(([k]) => k === key);
  const ruin = record.static.needles.find((n) => n.k === key);
  const units = frame.u.filter(([, , , q, r]) => q === cell[0] && r === cell[1]);
  const heat = frame.heat.filter(([k]) => k === key);
  const find = record.static.finds.find((f) => f.q === cell[0] && f.r === cell[1]);
  return (
    <div className="cellinfo">
      <b>
        ({cell[0]}, {cell[1]})
      </b>{' '}
      {TERRAIN_NAME[record.static.types[c?.type ?? 0] ?? 'bare']}, рівень {c?.level}
      {needle && (
        <div>
          голка <Dot a={needle[1]} /> {needle[1]} · {needle[2] > 0 ? `горить ${fmt(needle[2], 2)}` : 'темна'}
          {needle[3] & NF.jam ? ' · заглушена' : ''}
          {needle[3] & NF.crown ? ' · корона' : ''}
          {needle[3] & NF.fed ? ' · живиться' : ''}
          {ruin?.ring ? ' · кільце' : ''}
          {ruin?.start ? ' · стартова' : ''}
        </div>
      )}
      {!needle && ruin && <div>руїна (нічия){ruin.ring ? ' · кільце' : ''}</div>}
      {heat.map(([, a, p]) => (
        <div key={a}>
          гріє <Dot a={a} /> {a}: {fmt(p, 1)} тактів
        </div>
      ))}
      {units.map(([id, owner, cls, , , task, tq, tr]) => (
        <div key={id}>
          <Dot a={owner} /> {id} · {cls ? 'клинок' : 'ткач'}
          {task ? ` · ${TASKS[task]} → (${tq}, ${tr})` : ' · без завдання'}
        </div>
      ))}
      {find && <div>знахідка: {FIND_NAME[find.kind] ?? find.kind}</div>}
    </div>
  );
}
