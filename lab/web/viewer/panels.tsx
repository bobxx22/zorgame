/* Viewer side panels: players at the tick, score chart, event journal, a
   seat's orders with verdicts, match summary, the cell under the cursor. */

import { useMemo, useState } from 'react';
import { NF, P, SLOTS, TASKS } from '../../shared/record.ts';
import type { Actor, Frame, MatchRecord, Slot } from '../../shared/record.ts';
import { hexKey } from '../lib/hex.ts';
import { tr } from '../lib/i18n.ts';
import { ACTOR_COLOR, clsName, denyWord, eventName, eventText, findName, fmt, orderText, terrainName } from '../lib/look.ts';

const Dot = ({ a }: { a: Actor }) => <span className="dot" style={{ background: ACTOR_COLOR[a] }} />;

export function Players({ record, frame, focus, onFocus }: { record: MatchRecord; frame: Frame; focus: Slot | null; onFocus: (s: Slot) => void }) {
  const rank = [...SLOTS].sort((a, b) => frame.p[b][P.score] - frame.p[a][P.score]);
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>{tr('seat', 'місце')}</th>
          <th>{tr('who', 'хто')}</th>
          <th title={tr('score: minutes + contracts - pact tax', 'рахунок: хвилини + контракти - податок угоди')}>{tr('score', 'рахунок')}</th>
          <th>{tr('charge', 'заряд')}</th>
          <th title={tr('lit / total needles', 'горить / усього голок')}>{tr('needles', 'голки')}</th>
          <th>{tr('units', 'юніти')}</th>
          <th title={tr('channel: left / tick budget', 'канал: залишок / бюджет такту')}>{tr('channel', 'канал')}</th>
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
                {record.meta.ours === s && <b className="tag">{tr('ours', 'наш')}</b>}
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
            <Dot a="K" /> {tr('Keeper', 'Ключник')}
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
const METRIC: Record<Metric, { i: number; name: [string, string] }> = {
  score: { i: P.score, name: ['score', 'рахунок'] },
  energy: { i: P.energy, name: ['charge', 'заряд'] },
  lit: { i: P.lit, name: ['lit needles', 'горить голок'] },
  units: { i: P.units, name: ['units', 'юніти'] },
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
            {tr(...METRIC[m].name)}
          </button>
        ))}
        <span className="muted">{tr('max', 'макс')} {fmt(series.max, metric === 'score' ? 1 : 0)}</span>
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
            {eventName(type)}
          </label>
        ))}
      </div>
      <div className="filters">
        {(['all', ...SLOTS, 'K'] as const).map((a) => (
          <button key={a} className={who === a ? 'on' : ''} onClick={() => setWho(a)}>
            {a === 'all' ? tr('all', 'усі') : a}
          </button>
        ))}
        <label>
          <input type="checkbox" checked={future} onChange={() => setFuture(!future)} /> {tr('whole match', 'уся партія')}
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
          <input type="checkbox" checked={onlyDenied} onChange={() => setOnlyDenied(!onlyDenied)} /> {tr('rejections only', 'лише відмови')} ({tr('per match', 'за партію')}: {totalDenied})
        </label>
        {ours && <span className="muted">{tr('pulse - dashed, filler nakaz orders - green', 'пульс - пунктир, команди наказу-заповнювача - зелені')}</span>}
      </div>
      <ol className="log">
        {[...rows].reverse().map((f) => {
          const orders = (f.ord[slot] ?? []) as Record<string, unknown>[];
          const denied = new Map(f.den[slot] ?? []);
          return (
            <li key={f.t} className={f.t === t ? 'now' : ''} onClick={() => onSeek(f.t)}>
              <span className="t">{f.t}</span>
              {orders.length === 0 && <span className="muted">{tr('silence', 'мовчання')}</span>}
              <span className="cmds">
                {orders.map((o, i) => {
                  const code = denied.get(i);
                  const src = ours ? (f.src?.[i] ?? (i === 0 && f.pulse ? 'pulse' : 'head')) : 'head';
                  return (
                    <span
                      key={i}
                      className={'cmd' + (code !== undefined ? ' denied' : '') + (src === 'pulse' ? ' pulse' : '') + (src === 'fill' ? ' fill' : '')}
                      title={src === 'fill' ? tr('filler nakaz', 'наказ-заповнювач') : src === 'pulse' ? tr('pulse', 'пульс') : undefined}
                    >
                      {orderText(o)}
                      {code !== undefined && <b> ✗ {denyWord(code)}</b>}
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

const BREAKDOWN: Record<string, [string, string]> = {
  network: ['network', 'мережа'],
  orders: ['contracts', 'контракти'],
  stolen: ['jamming loot', 'здобич глушіння'],
  pactTax: ['pact tax', 'податок угоди'],
  jams: ['jams', 'глушінь'],
  rams: ['rams', 'таранів'],
  total: ['total', 'разом'],
};

export function Summary({ record }: { record: MatchRecord }) {
  const rows = [...record.result].sort((a, b) => a.place - b.place);
  const keys = ['network', 'orders', 'stolen', 'pactTax', 'jams', 'rams'];
  return (
    <div className="summary">
      <table className="grid">
        <thead>
          <tr>
            <th>{tr('seat', 'місце')}</th>
            <th>{tr('who', 'хто')}</th>
            <th>{tr('share', 'частка')}</th>
            <th>{tr('score', 'рахунок')}</th>
            {keys.map((k) => (
              <th key={k}>{BREAKDOWN[k] ? tr(...BREAKDOWN[k]) : k}</th>
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
            <th>{tr('who', 'хто')}</th>
            <th>{tr('lit', 'горить')}</th>
            <th>{tr('needles', 'голок')}</th>
            <th>{tr('charge', 'заряд')}</th>
            <th>{tr('orders', 'команд')}</th>
            <th>{tr('rejections', 'відмов')}</th>
            <th>{tr('pulses', 'пульсів')}</th>
            <th title={tr('ticks when a nakaz inside the bot filled idle time', 'тактів, коли простій заповнював наказ усередині бота')}>{tr('filled', 'заповнено')}</th>
            <th title={tr('ticks when the nakaz ran the slot: the bot was silent for 6 ticks or longer (rules 23.2)', 'такти, коли слот вів наказ: бот мовчав 6 тактів і довше (правила 23.2)')}>
              {tr('under nakaz', 'під наказом')}
            </th>
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
                {r.nakazEpisodes.length > 0 && <span className="muted"> ({r.nakazEpisodes.length} {tr('ep.', 'еп.')})</span>}
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
  if (!cell) return <div className="cellinfo muted">{tr('hover over a cell', 'наведіть на соту')}</div>;
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
      {terrainName(record.static.types[c?.type ?? 0] ?? 'bare')}, {tr('level', 'рівень')} {c?.level}
      {needle && (
        <div>
          {tr('needle', 'голка')} <Dot a={needle[1]} /> {needle[1]} · {needle[2] > 0 ? `${tr('lit', 'горить')} ${fmt(needle[2], 2)}` : tr('dark', 'темна')}
          {needle[3] & NF.jam ? ' · ' + tr('jammed', 'заглушена') : ''}
          {needle[3] & NF.crown ? ' · ' + tr('crown', 'корона') : ''}
          {needle[3] & NF.fed ? ' · ' + tr('fed', 'живиться') : ''}
          {ruin?.ring ? ' · ' + tr('ring', 'кільце') : ''}
          {ruin?.start ? ' · ' + tr('start', 'стартова') : ''}
        </div>
      )}
      {!needle && ruin && (
        <div>
          {tr('ruin (unowned)', 'руїна (нічия)')}
          {ruin.ring ? ' · ' + tr('ring', 'кільце') : ''}
        </div>
      )}
      {heat.map(([, a, p]) => (
        <div key={a}>
          {tr('heated by', 'гріє')} <Dot a={a} /> {a}: {fmt(p, 1)} {tr('ticks', 'тактів')}
        </div>
      ))}
      {units.map(([id, owner, cls, , , task, tq, tr2]) => (
        <div key={id}>
          <Dot a={owner} /> {id} · {clsName(cls)}
          {task ? ` · ${TASKS[task]} → (${tq}, ${tr2})` : ' · ' + tr('no task', 'без завдання')}
        </div>
      ))}
      {find && (
        <div>
          {tr('find', 'знахідка')}: {findName(find.kind)}
        </div>
      )}
    </div>
  );
}
