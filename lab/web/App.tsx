/* Lab: #/ - runs, #/tournaments - tournaments, #/tournament/<id> - tournament summary,
   #/run/<id>/<match> - match viewer, #/play - a game against bots, #/play/<id> - the game. */

import { useEffect, useState } from 'react';
import type { RunMeta } from '../shared/record.ts';
import { api } from './lib/api.ts';
import { setLang, tr, useLang } from './lib/i18n.ts';
import { PlayPage } from './play/PlayPage.tsx';
import { RunsPage } from './runs/RunsPage.tsx';
import { TournamentsPage, TournamentView } from './tournaments/TournamentsPage.tsx';
import { Viewer } from './viewer/Viewer.tsx';

type Route =
  | { page: 'runs' }
  | { page: 'tournaments' }
  | { page: 'tournament'; id: string }
  | { page: 'run'; id: string; match: number }
  | { page: 'play'; id: string | null };

function parse(hash: string): Route {
  const run = /^#\/run\/([a-z0-9-]+)\/(\d)$/.exec(hash);
  if (run) return { page: 'run', id: run[1]!, match: Number(run[2]) };
  const tournament = /^#\/tournament\/([a-z0-9-]+)$/.exec(hash);
  if (tournament) return { page: 'tournament', id: tournament[1]! };
  if (hash === '#/tournaments') return { page: 'tournaments' };
  const play = /^#\/play(?:\/([a-z0-9-]+))?$/.exec(hash);
  if (play) return { page: 'play', id: play[1] ?? null };
  return { page: 'runs' };
}

export function App() {
  const lang = useLang();
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
  const section =
    route.page === 'play' ? 'play' : route.page === 'tournaments' || route.page === 'tournament' || (route.page === 'run' && run?.tournament) ? 'tournaments' : 'runs';

  return (
    <div className="app">
      <header className="bar">
        <a href="#/" className="brand">
          {tr('ZORYA · lab', 'ЗОРЯ · лабораторія')}
        </a>
        <nav className="nav">
          <a href="#/" className={section === 'runs' ? 'on' : ''}>
            {tr('Runs', 'Запуски')}
          </a>
          <a href="#/tournaments" className={section === 'tournaments' ? 'on' : ''}>
            {tr('Tournaments', 'Турніри')}
          </a>
          <a href="#/play" className={section === 'play' ? 'on' : ''}>
            {tr('Play', 'Зіграти')}
          </a>
        </nav>
        {route.page === 'run' && run && (
          <nav className="matches">
            {run.tournament && (
              <a href={`#/tournament/${run.tournament.id}`} className="muted">
                {tr('← to the tournament', '← до турніру')}
              </a>
            )}
            <span className="muted">
              {tr('valley', 'долина')} {run.request.seed} · {run.request.ticks} {tr('ticks', 'тактів')} ·
            </span>
            {Array.from({ length: run.request.matches }, (_, i) => {
              const m = run.matches?.[i];
              return (
                <button key={i} className={route.match === i + 1 ? 'on' : ''} onClick={() => go(`#/run/${run.id}/${i + 1}`)}>
                  {tr('match', 'партія')} {i + 1}
                  {m && (
                    <span className="muted">
                      {' '}
                      ·{' '}
                      {Object.entries(m.places)
                        .sort((a, b) => a[1] - b[1])
                        .map(([s]) => s)
                        .join('>')}
                    </span>
                  )}
                </button>
              );
            })}
            {run.shares && (
              <span className="muted">
                {tr('shares per pack', 'частки за пакет')}: {run.request.lineup.map((_, i) => `${i + 1}:${run.shares![i]}`).join(' ')}
              </span>
            )}
          </nav>
        )}
        <span className="lang">
          <button className={'mini' + (lang === 'en' ? ' on' : '')} onClick={() => setLang('en')}>
            EN
          </button>
          <button className={'mini' + (lang === 'uk' ? ' on' : '')} onClick={() => setLang('uk')}>
            УК
          </button>
        </span>
      </header>
      <main>
        {route.page === 'runs' && <RunsPage onOpen={(id, match) => go(`#/run/${id}/${match}`)} />}
        {route.page === 'tournaments' && <TournamentsPage onOpen={(id) => go(`#/tournament/${id}`)} />}
        {route.page === 'tournament' && <TournamentView id={route.id} onRun={(runId) => go(`#/run/${runId}/1`)} />}
        {route.page === 'run' && run && <Viewer run={run} match={route.match} />}
        {route.page === 'run' && !run && <p className="muted">{tr('Reading the run…', 'Читаю запуск…')}</p>}
        {route.page === 'play' && <PlayPage id={route.id} />}
      </main>
    </div>
  );
}
