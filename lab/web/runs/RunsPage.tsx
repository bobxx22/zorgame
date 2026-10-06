/* Runs: a form for a new pack and the list of played ones, with progress. */

import { useEffect, useState } from 'react';
import { seatText } from '../../shared/record.ts';
import type { LabOptions, RunMeta, RunRequest, SeatSpec } from '../../shared/record.ts';
import { api } from '../lib/api.ts';
import { lang, tr } from '../lib/i18n.ts';
import { SeatEditor } from './SeatEditor.tsx';

const DEFAULT_LINEUP: RunRequest['lineup'] = [
  { kind: 'ours', name: 'полудень' },
  { kind: 'archetype', name: 'обхідник' },
  { kind: 'archetype', name: 'рівний' },
];

/* opponents for a random start: catalogue styles in our wrapper (with the
   default tactics), SDK archetypes, nakaz samples and external bots; nakaz
   heads - no, that's our bot, not an opponent */
function opponentPool(options: LabOptions): SeatSpec[] {
  return [
    ...options.presets.filter((name) => !name.startsWith('nakaz:')).map((name): SeatSpec => ({ kind: 'ours', name })),
    ...options.archetypes.map((name): SeatSpec => ({ kind: 'archetype', name })),
    ...options.nakaz.map((name): SeatSpec => ({ kind: 'nakaz', name })),
    ...options.ext.map((name): SeatSpec => ({ kind: 'ext', name })),
  ];
}

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function RunsPage({ onOpen }: { onOpen: (id: string, match: number) => void }) {
  const [options, setOptions] = useState<LabOptions | null>(null);
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [seed, setSeed] = useState(2026);
  const [ticks, setTicks] = useState(1200);
  const [matches, setMatches] = useState<1 | 3>(3);
  const [lineup, setLineup] = useState<RunRequest['lineup']>(DEFAULT_LINEUP);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.options().then(setOptions, (e: unknown) => setError(String(e)));
  }, []);

  const busy = runs.some((r) => r.status === 'running' || r.status === 'queued');
  useEffect(() => {
    let alive = true;
    const load = () =>
      api.runs().then(
        (list) => alive && setRuns(list),
        () => undefined,
      );
    void load();
    const timer = setInterval(load, busy ? 700 : 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [busy]);

  const start = async (request: RunRequest = { seed, ticks, matches, lineup }) => {
    setError(null);
    try {
      const run = await api.start(request);
      setRuns((list) => [run, ...list]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /* participant 1 - as chosen; the other two are different and random, the valley too */
  const startRandom = async () => {
    if (!options) return;
    const pool = opponentPool(options);
    const a = pick(pool);
    const rest = pool.filter((s) => s.kind !== a.kind || s.name !== a.name);
    const b = rest.length ? pick(rest) : a;
    const next: RunRequest['lineup'] = [lineup[0], a, b];
    const s = Math.floor(Math.random() * 100000);
    setLineup(next);
    setSeed(s);
    await start({ seed: s, ticks, matches, lineup: next });
  };

  const remove = async (id: string) => {
    await api.remove(id).catch(() => undefined);
    setRuns((list) => list.filter((r) => r.id !== id));
  };

  return (
    <div className="runs">
      <section className="card">
        <h2>{tr('New match', 'Нова партія')}</h2>
        <p className="muted">
          {tr('Matches are played by the same engine as the node', 'Партії грає той самий рушій, що й вузол')} ({options?.engine.slice(0, 12) ?? '…'}),{' '}
          {tr(
            'in process without a network. Our bot is the built bot/dist: an archetype head, the pulse and tactics to choose. A pack is three matches of one valley with seat rotation (rules 25.1).',
            'у процесі без мережі. Наш бот - зібраний bot/dist: голова архетипу, пульс і надбудови на вибір. Пакет - три партії однієї долини з пересадкою по місцях (правила 25.1).',
          )}
        </p>
        {options && (
          <div className="form">
            <label className="field">
              <span>{tr('valley lot', 'жереб долини')}</span>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              <button className="mini" onClick={() => setSeed(Math.floor(Math.random() * 100000))}>
                {tr('random', 'випадковий')}
              </button>
            </label>
            <label className="field">
              <span>{tr('ticks per match', 'тактів у партії')}</span>
              <select value={ticks} onChange={(e) => setTicks(Number(e.target.value))}>
                <option value={1200}>1200 ({tr('full', 'повна')})</option>
                <option value={600}>600</option>
                <option value={300}>300 ({tr('quick', 'швидко')})</option>
              </select>
            </label>
            <label className="field">
              <span>{tr('size', 'обсяг')}</span>
              <select value={matches} onChange={(e) => setMatches(Number(e.target.value) === 1 ? 1 : 3)}>
                <option value={3}>{tr('a pack of 3 matches', 'пакет із 3 партій')}</option>
                <option value={1}>{tr('a single match', 'одна партія')}</option>
              </select>
            </label>
            {lineup.map((seat, i) => (
              <SeatEditor
                key={i}
                label={`${tr('participant', 'учасник')} ${i + 1}`}
                options={options}
                value={seat}
                onChange={(next) => {
                  const copy = [...lineup] as RunRequest['lineup'];
                  copy[i] = next;
                  setLineup(copy);
                }}
              />
            ))}
            <button className="primary" onClick={() => void start()}>
              {tr('Play', 'Зіграти')}
            </button>
            <button
              className="primary"
              onClick={() => void startRandom()}
              title={tr(
                'participant 1 - as chosen; the other two are random from all catalogue styles (our bot with the default tactics), SDK archetypes, nakaz samples and external bots; the valley is random too',
                'учасник 1 - як вибрано; двоє інших - випадкові з усіх стилів каталогу (наш бот із типовими надбудовами), архетипів SDK, зразків наказу і зовнішніх ботів; долина теж випадкова',
              )}
            >
              {tr('Play with random ones', 'Зіграти з випадковими')}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>{tr('Runs', 'Запуски')}</h2>
        {runs.length === 0 && <p className="muted">{tr('Nothing played yet.', 'Ще нічого не зіграно.')}</p>}
        <table className="grid runlist">
          <thead>
            <tr>
              <th>{tr('when', 'коли')}</th>
              <th>{tr('valley', 'долина')}</th>
              <th>{tr('participants (shares per pack)', 'учасники (частки за пакет)')}</th>
              <th>{tr('status', 'стан')}</th>
              <th>{tr('matches', 'партії')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.createdAt).toLocaleString(lang() === 'uk' ? 'uk-UA' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                <td className="num">
                  {run.request.seed} · {run.request.ticks} {tr('t', 'т')}
                </td>
                <td>
                  {run.request.lineup.map((seat, i) => (
                    <div key={i} className={seat.kind === 'ours' || seat.kind === 'human' ? 'ours' : ''}>
                      {i + 1}. {seatText(seat, lang())}
                      {run.shares && <b className="share"> {run.shares[i]}</b>}
                    </div>
                  ))}
                </td>
                <td>
                  {run.status === 'done' && (run.ms ? `${tr('done in', 'готово за')} ${(run.ms / 1000).toFixed(0)} ${tr('s', 'с')}` : tr('done', 'готово'))}
                  {run.status === 'queued' && tr('queued', 'у черзі')}
                  {run.status === 'running' && (
                    <span>
                      {tr('match', 'партія')} {Math.min(run.progress.match + 1, run.request.matches)} / {run.request.matches}, {tr('tick', 'такт')} {run.progress.t}
                      <progress
                        max={run.request.matches * run.request.ticks}
                        value={run.progress.match * run.request.ticks + run.progress.t}
                      />
                    </span>
                  )}
                  {run.status === 'failed' && <span className="error" title={run.error}>{tr('error', 'помилка')}</span>}
                </td>
                <td>
                  {Array.from({ length: run.request.matches }, (_, i) => {
                    const ready = run.status === 'done' || run.progress.match > i;
                    return (
                      <button key={i} className="mini" disabled={!ready} onClick={() => onOpen(run.id, i + 1)}>
                        {i + 1}
                      </button>
                    );
                  })}
                </td>
                <td>
                  <button className="mini" disabled={run.status === 'running' || run.status === 'queued'} onClick={() => void remove(run.id)} title={tr('delete the run', 'видалити запуск')}>
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
