/* Запуски: форма нового пакета і список уже зіграних, з прогресом. */

import { useEffect, useState } from 'react';
import { seatText } from '../../shared/record.ts';
import type { LabOptions, RunMeta, RunRequest } from '../../shared/record.ts';
import { api } from '../lib/api.ts';
import { SeatEditor } from './SeatEditor.tsx';

const DEFAULT_LINEUP: RunRequest['lineup'] = [
  { kind: 'ours', name: 'широблог' },
  { kind: 'archetype', name: 'обхідник' },
  { kind: 'archetype', name: 'рівний' },
];

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

  const start = async () => {
    setError(null);
    try {
      const run = await api.start({ seed, ticks, matches, lineup });
      setRuns((list) => [run, ...list]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    await api.remove(id).catch(() => undefined);
    setRuns((list) => list.filter((r) => r.id !== id));
  };

  return (
    <div className="runs">
      <section className="card">
        <h2>Нова партія</h2>
        <p className="muted">
          Партії грає той самий рушій, що й вузол ({options?.engine.slice(0, 12) ?? '…'}), у процесі без мережі. Наш бот - зібраний bot/dist: голова
          архетипу, пульс і надбудови на вибір. Пакет - три партії однієї долини з пересадкою по місцях (правила 25.1).
        </p>
        {options && (
          <div className="form">
            <label className="field">
              <span>жереб долини</span>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
              <button className="mini" onClick={() => setSeed(Math.floor(Math.random() * 100000))}>
                випадковий
              </button>
            </label>
            <label className="field">
              <span>тактів у партії</span>
              <select value={ticks} onChange={(e) => setTicks(Number(e.target.value))}>
                <option value={1200}>1200 (повна)</option>
                <option value={600}>600</option>
                <option value={300}>300 (швидко)</option>
              </select>
            </label>
            <label className="field">
              <span>обсяг</span>
              <select value={matches} onChange={(e) => setMatches(Number(e.target.value) === 1 ? 1 : 3)}>
                <option value={3}>пакет із 3 партій</option>
                <option value={1}>одна партія</option>
              </select>
            </label>
            {lineup.map((seat, i) => (
              <SeatEditor
                key={i}
                label={`учасник ${i + 1}`}
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
              Зіграти
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>Запуски</h2>
        {runs.length === 0 && <p className="muted">Ще нічого не зіграно.</p>}
        <table className="grid runlist">
          <thead>
            <tr>
              <th>коли</th>
              <th>долина</th>
              <th>учасники (частки за пакет)</th>
              <th>стан</th>
              <th>партії</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{new Date(run.createdAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'medium' })}</td>
                <td className="num">
                  {run.request.seed} · {run.request.ticks} т
                </td>
                <td>
                  {run.request.lineup.map((seat, i) => (
                    <div key={i} className={seat.kind === 'ours' ? 'ours' : ''}>
                      {i + 1}. {seatText(seat)}
                      {run.shares && <b className="share"> {run.shares[i]}</b>}
                    </div>
                  ))}
                </td>
                <td>
                  {run.status === 'done' && `готово за ${((run.ms ?? 0) / 1000).toFixed(0)} с`}
                  {run.status === 'queued' && 'у черзі'}
                  {run.status === 'running' && (
                    <span>
                      партія {Math.min(run.progress.match + 1, run.request.matches)} / {run.request.matches}, такт {run.progress.t}
                      <progress
                        max={run.request.matches * run.request.ticks}
                        value={run.progress.match * run.request.ticks + run.progress.t}
                      />
                    </span>
                  )}
                  {run.status === 'failed' && <span className="error" title={run.error}>помилка</span>}
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
                  <button className="mini" disabled={run.status === 'running' || run.status === 'queued'} onClick={() => void remove(run.id)} title="видалити запуск">
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
