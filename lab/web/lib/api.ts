/* Звернення панелі до сервера лабораторії. */

import type { LabOptions, MatchRecord, RunMeta, RunRequest, TournamentRequest, TournamentView } from '../../shared/record.ts';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  options: () => call<LabOptions>('/api/options'),
  runs: () => call<RunMeta[]>('/api/runs'),
  run: (id: string) => call<RunMeta>(`/api/runs/${id}`),
  start: (request: RunRequest) =>
    call<RunMeta>('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }),
  remove: (id: string) => call<{ deleted: string }>(`/api/runs/${id}`, { method: 'DELETE' }),
  match: (id: string, n: number) => call<MatchRecord>(`/api/runs/${id}/match/${n}`),
  tournaments: () => call<TournamentView[]>('/api/tournaments'),
  tournament: (id: string) => call<TournamentView>(`/api/tournaments/${id}`),
  startTournament: (request: TournamentRequest) =>
    call<TournamentView>('/api/tournaments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }),
  removeTournament: (id: string) => call<{ deleted: string }>(`/api/tournaments/${id}`, { method: 'DELETE' }),
};
