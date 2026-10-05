/* Viewer side panels: players at the tick, score chart, event journal, a
   seat's orders with verdicts, match summary, the cell under the cursor. */

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
          <th>seat</th>
          <th>who</th>
          <th title="score: minutes + contracts - pact tax">score</th>
          <th>charge</th>
          <th title="lit / total needles">needles</th>
          <th>units</th>
          <th title="channel: left / tick budget">channel</th>
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
                {record.meta.ours === s && <b className="tag">ours</b>}
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
            <Dot a="K" /> Keeper
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
  score: { i: P.score, name: 'score' },
  energy: { i: P.energy, name: 'charge' },
  lit: { i: P.lit, name: 'lit needles' },
  units: { i: P.units, name: 'units' },
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
        <span className="muted">max {fmt(series.max, metric === 'score' ? 1 : 0)}</span>
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
            {a === 'all' ? 'all' : a}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={future} onChange={() => setFuture(!future)} /> whole match
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
          <input type="checkbox" checked={onlyDenied} onChange={() => setOnlyDenied(!onlyDenied)} /> rejections only (per match: {totalDenied})
        </label>
        {ours && <span className="muted">pulse - dashed, filler nakaz orders - green</span>}
      </div>
      <ol className="log">
        {[...rows].reverse().map((f) => {
          const orders = (f.ord[slot] ?? []) as Record<string, unknown>[];
          const denied = new Map(f.den[slot] ?? []);
          return (
            <li key={f.t} className={f.t === t ? 'now' : ''} onClick={() => onSeek(f.t)}>
              <span className="t">{f.t}</span>
              {orders.length === 0 && <span className="muted">silence</span>}
              <span className="cmds">
                {orders.map((o, i) => {
                  const code = denied.get(i);
                  const src = ours ? (f.src?.[i] ?? (i === 0 && f.pulse ? 'pulse' : 'head')) : 'head';
                  return (
                    <span
                      key={i}
                      className={'cmd' + (code !== undefined ? ' denied' : '') + (src === 'pulse' ? ' pulse' : '') + (src === 'fill' ? ' fill' : '')}
                      title={src === 'fill' ? 'filler nakaz' : src === 'pulse' ? 'pulse' : undefined}
                    >
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

const BREAKDOWN: Record<string, string> = { network: 'network', orders: 'contracts', stolen: 'jamming loot', pactTax: 'pact tax', jams: 'jams', rams: 'rams', total: 'total' };

export function Summary({ record }: { record: MatchRecord }) {
  const rows = [...record.result].sort((a, b) => a.place - b.place);
  const keys = ['network', 'orders', 'stolen', 'pactTax', 'jams', 'rams'];
  return (
    <div className="summary">
      <table className="grid">
        <thead>
          <tr>
            <th>seat</th>
            <th>who</th>
            <th>share</th>
            <th>score</th>
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
            <th>who</th>
            <th>lit</th>
            <th>needles</th>
            <th>charge</th>
            <th>orders</th>
            <th>rejections</th>
            <th>pulses</th>
            <th title="ticks when a nakaz inside the bot filled idle time">filled</th>
            <th title="ticks when the nakaz ran the slot: the bot was silent for 6 ticks or longer (rules 23.2)">under nakaz</th>
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
              <td className="num">{r.fills ?? 0}</td>
              <td className={'num' + (r.nakazTicks > 0 ? ' bad' : '')} title={r.nakazEpisodes.map((e) => `${e.from}-${e.to}`).join(', ')}>
                {r.nakazTicks}
                {r.nakazEpisodes.length > 0 && <span className="muted"> ({r.nakazEpisodes.length} ep.)</span>}
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
  if (!cell) return <div className="cellinfo muted">hover over a cell</div>;
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
      {TERRAIN_NAME[record.static.types[c?.type ?? 0] ?? 'bare']}, level {c?.level}
      {needle && (
        <div>
          needle <Dot a={needle[1]} /> {needle[1]} · {needle[2] > 0 ? `lit ${fmt(needle[2], 2)}` : 'dark'}
          {needle[3] & NF.jam ? ' · jammed' : ''}
          {needle[3] & NF.crown ? ' · crown' : ''}
          {needle[3] & NF.fed ? ' · fed' : ''}
          {ruin?.ring ? ' · ring' : ''}
          {ruin?.start ? ' · start' : ''}
        </div>
      )}
      {!needle && ruin && <div>ruin (unowned){ruin.ring ? ' · ring' : ''}</div>}
      {heat.map(([, a, p]) => (
        <div key={a}>
          heated by <Dot a={a} /> {a}: {fmt(p, 1)} ticks
        </div>
      ))}
      {units.map(([id, owner, cls, , , task, tq, tr]) => (
        <div key={id}>
          <Dot a={owner} /> {id} · {cls ? 'Klinok' : 'Tkach'}
          {task ? ` · ${TASKS[task]} → (${tq}, ${tr})` : ' · no task'}
        </div>
      ))}
      {find && <div>find: {FIND_NAME[find.kind] ?? find.kind}</div>}
    </div>
  );
}
