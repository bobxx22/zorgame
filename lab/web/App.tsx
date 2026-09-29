/* Лабораторія: #/ - запуски, #/run/<id>/<партія> - перегляд. */

import { useEffect, useState } from 'react';
import type { RunMeta } from '../shared/record.ts';
import { api } from './lib/api.ts';
import { RunsPage } from './runs/RunsPage.tsx';
import { Viewer } from './viewer/Viewer.tsx';

type Route = { page: 'runs' } | { page: 'run'; id: string; match: number };

function parse(hash: string): Route {
  const m = /^#\/run\/([a-z0-9-]+)\/(\d)$/.exec(hash);
  return m ? { page: 'run', id: m[1]!, match: Number(m[2]) } : { page: 'runs' };
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  const [run, setRun] = useState<RunMeta | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (route.page !== 'run') return;
    let alive = true;
    api.run(route.id).then(
      (r) => alive && setRun(r),
      () => alive && setRun(null),
    );
    return () => {
      alive = false;
    };
  }, [route]);

  const go = (hash: string) => {
    location.hash = hash;
  };

  return (
    <div className="app">
      <header className="bar">
        <a href="#/" className="brand">
          ЗОРЯ · лабораторія
        </a>
        {route.page === 'run' && run && (
          <nav className="matches">
            <span className="muted">
              долина {run.request.seed} · {run.request.ticks} тактів ·
            </span>
            {Array.from({ length: run.request.matches }, (_, i) => {
              const m = run.matches?.[i];
              return (
                <button key={i} className={route.match === i + 1 ? 'on' : ''} onClick={() => go(`#/run/${run.id}/${i + 1}`)}>
                  партія {i + 1}
                  {m && <span className="muted"> · {Object.entries(m.places).sort((a, b) => a[1] - b[1]).map(([s]) => s).join('>')}</span>}
                </button>
              );
            })}
            {run.shares && (
              <span className="muted">
                частки за пакет: {run.request.lineup.map((s, i) => `${i + 1}:${run.shares![i]}`).join(' ')}
              </span>
            )}
          </nav>
        )}
      </header>
      <main>
        {route.page === 'runs' && <RunsPage onOpen={(id, match) => go(`#/run/${id}/${match}`)} />}
        {route.page === 'run' && run && <Viewer run={run} match={route.match} />}
        {route.page === 'run' && !run && <p className="muted">Читаю запуск…</p>}
      </main>
    </div>
  );
}
