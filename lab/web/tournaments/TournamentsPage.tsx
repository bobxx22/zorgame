/* Tournaments: several variants on the same valleys and opponents, a summary
   with the paired difference vs variant 1 and a grid of shares by valley. */

import { useEffect, useState } from 'react';
import { seatText } from '../../shared/record.ts';
import type { LabOptions, SeatSpec, TournamentRequest, TournamentView, VariantStats } from '../../shared/record.ts';
import { api } from '../lib/api.ts';
import { fmt } from '../lib/look.ts';
import { SeatEditor } from '../runs/SeatEditor.tsx';

/* the battle configuration first: the paired difference of the rest is against it */
const DEFAULT_VARIANTS: SeatSpec[] = [
  { kind: 'ours', name: 'полудень' },
  { kind: 'ours', name: 'світанок' },
  { kind: 'ours', name: 'широблог' },
];

const key = (s: SeatSpec) => s.kind + ':' + s.name;

export function TournamentsPage({ onOpen }: { onOpen: (id: string) => void }) {
  const [options, setOptions] = useState<LabOptions | null>(null);
  const [list, setList] = useState<TournamentView[]>([]);
  const [name, setName] = useState('');
  const [variants, setVariants] = useState<SeatSpec[]>(DEFAULT_VARIANTS);
  const [pool, setPool] = useState<SeatSpec[]>([]);
  const [seedFrom, setSeedFrom] = useState(1000);
  const [seeds, setSeeds] = useState(20);
  const [ticks, setTicks] = useState(1200);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.options().then((o) => {
      setOptions(o);
      setPool(o.archetypes.map((name) => ({ kind: 'archetype', name })));
    }, (e: unknown) => setError(String(e)));
  }, []);

  const busy = list.some((t) => t.status.queued + t.status.running > 0);
  useEffect(() => {
    let alive = true;
    const load = () => api.tournaments().then((l) => alive && setList(l), () => undefined);
    void load();
    const timer = setInterval(load, busy ? 1500 : 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busy]);

  const inPool = (s: SeatSpec) => pool.some((p) => key(p) === key(s));
  const toggle = (s: SeatSpec) => setPool(inPool(s) ? pool.filter((p) => key(p) !== key(s)) : [...pool, s]);
  const pairs = pool.length <= 1 ? pool.length : (pool.length * (pool.length - 1)) / 2;
  const packs = variants.length * seeds;
  const minutes = Math.ceil((packs * 20 * (ticks / 1200)) / Math.max(1, (options?.cpus ?? 2) - 1) / 60);

  const start = async () => {
    setError(null);
    const request: TournamentRequest = { name, variants, opponents: pool, seedFrom, seeds, ticks };
    try {
      const t = await api.startTournament(request);
      onOpen(t.tournament.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="runs">
      <section className="card">
        <h2>New tournament</h2>
        <p className="muted">
          Each variant plays a pack in participant 1's seat on the same valleys and against the same opponent pairs. The comparison is paired: on each valley
          the variant's share minus variant 1's share, so the randomness of the valley and the opponents cancels out. A pack's share is 0 to 9, the fair middle is 6.
        </p>
        {options && (
          <>
            <div className="variants">
              {variants.map((v, i) => (
                <div key={i} className="variant-row">
                  <SeatEditor
                    label={`variant ${i + 1}${i === 0 ? ' (reference)' : ''}`}
                    options={options}
                    value={v}
                    onChange={(next) => setVariants(variants.map((x, j) => (j === i ? next : x)))}
                  />
                  <button className="mini" disabled={variants.length === 1} onClick={() => setVariants(variants.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <button className="mini" disabled={variants.length >= 8} onClick={() => setVariants([...variants, { kind: 'ours', name: 'полудень' }])}>
                  + variant
                </button>
              </div>
            </div>
            <h3>Opponents (pairs from the pool in turn: {pairs})</h3>
            <div className="pool">
              {options.archetypes.map((name) => {
                const s: SeatSpec = { kind: 'archetype', name };
                return (
                  <label key={'a' + name}>
                    <input type="checkbox" checked={inPool(s)} onChange={() => toggle(s)} /> archetype · {name}
                  </label>
                );
              })}
              {options.nakaz.map((name) => {
                const s: SeatSpec = { kind: 'nakaz', name };
                return (
                  <label key={'n' + name}>
                    <input type="checkbox" checked={inPool(s)} onChange={() => toggle(s)} /> nakaz · {name}
                  </label>
                );
              })}
              {options.ext.map((name) => {
                const s: SeatSpec = { kind: 'ext', name };
                return (
                  <label key={'l' + name}>
                    <input type="checkbox" checked={inPool(s)} onChange={() => toggle(s)} /> external · {name}
                  </label>
                );
              })}
            </div>
            <div className="form" style={{ marginTop: 12 }}>
              <label className="field">
                <span>name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. idle filling" />
              </label>
              <label className="field">
                <span>valleys: from the lot</span>
                <input type="number" value={seedFrom} onChange={(e) => setSeedFrom(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>how many valleys</span>
                <input type="number" min={1} max={200} value={seeds} onChange={(e) => setSeeds(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} />
              </label>
              <label className="field">
                <span>ticks per match</span>
                <select value={ticks} onChange={(e) => setTicks(Number(e.target.value))}>
                  <option value={1200}>1200 (full)</option>
                  <option value={600}>600</option>
                  <option value={300}>300</option>
                </select>
              </label>
              <button className="primary" disabled={pool.length === 0} onClick={() => void start()}>
                Start: {packs} packs, ~{minutes} min
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>Tournaments</h2>
        {list.length === 0 && <p className="muted">None yet.</p>}
        <table className="grid">
          <thead>
            <tr>
              <th>when</th>
              <th>name</th>
              <th>variants: share per pack</th>
              <th>status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.tournament.id}>
                <td>{new Date(t.tournament.createdAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>
                  <a href={`#/tournament/${t.tournament.id}`}>{t.tournament.request.name || 'untitled'}</a>
                  <div className="muted">
                    {t.tournament.request.seeds} valleys · {t.tournament.request.ticks} t
                  </div>
                </td>
                <td>
                  {t.stats.map((s) => (
                    <div key={s.variant}>
                      {s.variant + 1}. {s.label}: <b>{s.done ? fmt(s.mean, 2) : '—'}</b>
                    </div>
                  ))}
                </td>
                <td>
                  {t.status.done} / {t.status.done + t.status.queued + t.status.running + t.status.failed}
                  {t.status.failed > 0 && <span className="error"> · errors {t.status.failed}</span>}
                </td>
                <td>
                  <button
                    className="mini"
                    title="delete the tournament and its runs"
                    onClick={() => void api.removeTournament(t.tournament.id).then(() => setList(list.filter((x) => x.tournament.id !== t.tournament.id)))}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function deltaText(s: VariantStats): string {
  if (!s.delta) return '—';
  const sign = s.delta.mean >= 0 ? '+' : '';
  return `${sign}${fmt(s.delta.mean, 2)} ± ${fmt(s.delta.se, 2)}`;
}

/* a difference is noticeable when its mean is larger than two standard errors */
function deltaClass(s: VariantStats): string {
  if (!s.delta || s.delta.n < 3 || s.delta.se === 0) return '';
  if (s.delta.mean > 2 * s.delta.se) return 'good';
  if (s.delta.mean < -2 * s.delta.se) return 'bad';
  return '';
}

function cellColor(v: number | null): string {
  if (v === null) return 'transparent';
  const k = Math.max(0, Math.min(1, (v - 3) / 6));
  return `rgba(${Math.round(255 - 150 * k)}, ${Math.round(90 + 120 * k)}, 110, 0.35)`;
}

export function TournamentView({ id, onRun }: { id: string; onRun: (runId: string) => void }) {
  const [view, setView] = useState<TournamentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = view ? view.status.queued + view.status.running > 0 : true;

  useEffect(() => {
    let alive = true;
    const load = () => api.tournament(id).then((v) => alive && setView(v), (e: unknown) => alive && setError(String(e)));
    void load();
    const timer = busy ? setInterval(load, 1500) : null;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
  }, [id, busy]);

  if (error) return <p className="error">{error}</p>;
  if (!view) return <p className="muted">Reading the tournament…</p>;
  const t = view.tournament;
  const total = view.status.done + view.status.queued + view.status.running + view.status.failed;
  const best = [...view.stats].filter((s) => s.done > 0).sort((a, b) => b.mean - a.mean)[0];

  return (
    <div className="runs">
      <section className="card">
        <h2>{t.request.name || 'Tournament'}</h2>
        <p className="muted">
          {t.request.seeds} valleys from lot {t.request.seedFrom} · {t.request.ticks} ticks · opponents: {t.request.opponents.map(seatText).join(', ')} · played{' '}
          {view.status.done} of {total}
          {view.status.running > 0 && ` · playing ${view.status.running}`}
          {view.status.failed > 0 && <span className="error"> · errors {view.status.failed}</span>}
        </p>
        {view.status.done < total && <progress max={total} value={view.status.done} style={{ width: 320 }} />}
        <table className="grid stats">
          <thead>
            <tr>
              <th>variant</th>
              <th title="average share per pack ± standard error; 0-9, middle 6">share</th>
              <th title="paired difference vs variant 1 on the same valleys; green - more than two errors">Δ vs 1</th>
              <th>min-max</th>
              <th title="places in matches: first / second / third, %">places 1/2/3</th>
              <th>score</th>
              <th title="the opponents' score in the same matches">opponents</th>
              <th>network</th>
              <th>contracts</th>
              <th>loot</th>
              <th>tax</th>
              <th>rejections</th>
              <th title="ticks when a nakaz inside the bot filled idle time">filled</th>
              <th title="ticks under the node's nakaz (a match defect)">under nakaz</th>
            </tr>
          </thead>
          <tbody>
            {view.stats.map((s) => {
              const all = s.places[0] + s.places[1] + s.places[2] || 1;
              return (
                <tr key={s.variant} className={s === best ? 'sel' : ''}>
                  <td>
                    {s.variant + 1}. {s.label}
                    <div className="muted">
                      {s.done} / {s.total} packs
                    </div>
                  </td>
                  <td className="num">
                    <b>{s.done ? fmt(s.mean, 2) : '—'}</b> ± {fmt(s.se, 2)}
                  </td>
                  <td className={'num ' + deltaClass(s)}>{deltaText(s)}</td>
                  <td className="num">{s.done ? `${s.min}-${s.max}` : '—'}</td>
                  <td className="num">{s.places.map((p) => Math.round((p / all) * 100)).join(' / ')}</td>
                  <td className="num">{fmt(s.score)}</td>
                  <td className="num">{fmt(s.opponentScore)}</td>
                  <td className="num">{fmt(s.network)}</td>
                  <td className="num">{fmt(s.orders)}</td>
                  <td className="num">{fmt(s.stolen)}</td>
                  <td className="num">{fmt(s.tax)}</td>
                  <td className={'num' + (s.denials > 0 ? ' bad' : '')}>{fmt(s.denials, 2)}</td>
                  <td className="num">{fmt(s.fills, 0)}</td>
                  <td className={'num' + (s.nakazTicks > 0 ? ' bad' : '')}>{fmt(s.nakazTicks, 1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Valleys</h2>
        <p className="muted">The variant's share per pack on each valley. Click - open the pack on the map.</p>
        <table className="grid heat">
          <thead>
            <tr>
              <th>valley</th>
              <th>opponents</th>
              {t.request.variants.map((_, v) => (
                <th key={v} className="num">
                  {v + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.grid.map((row, i) => (
              <tr key={i}>
                <td className="num">{t.request.seedFrom + i}</td>
                <td className="muted">{t.pairs[i]?.map(seatText).join(' + ')}</td>
                {row.map((v, j) => (
                  <td key={j} className="cell" style={{ background: cellColor(v) }} onClick={() => t.runs[j]?.[i] && onRun(t.runs[j]![i]!)}>
                    {v ?? '·'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
