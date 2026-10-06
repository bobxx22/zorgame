/* Play mode: the human takes a seat against bots, a bot of choice advises.
   #/play - a new game and the games in progress, #/play/<id> - the game.

   The game waits on every decision tick. Orders are put together here: pick a
   unit in the list (or on the map), pick a cell on the map, press the action.
   The advisor's orders come with a reason and can be taken one by one or all
   at once. Then: play one tick, or several - silent or with the advisor at the
   wheel; the run stops early on what needs a human (a loss, a new unit, dawn). */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FoeEntry, MineUnit } from '@zoria/protocol';
import type { Order, PlayState, Sight } from '../../shared/play.ts';
import { seatText, SLOTS } from '../../shared/record.ts';
import type { Actor, Frame, LabOptions, MatchRecord, MatchStatic, NeedleRow, SeatSpec, Slot, UnitRow } from '../../shared/record.ts';
import { api } from '../lib/api.ts';
import { hexDist } from '../lib/hex.ts';
import { lang, tr, txt, useLang } from '../lib/i18n.ts';
import { ACTOR_COLOR, clsName, CRY_COUNT, cryText, denyWord, eventText, fmt, orderText } from '../lib/look.ts';
import { SeatEditor } from '../runs/SeatEditor.tsx';
import { DEFAULT_LAYERS, HexMap } from '../viewer/HexMap.tsx';
import type { Layers } from '../viewer/HexMap.tsx';
import { CellInfo } from '../viewer/panels.tsx';

const Dot = ({ a }: { a: Actor }) => <span className="dot" style={{ background: ACTOR_COLOR[a] }} />;
const randomSeed = () => Math.floor(Math.random() * 1_000_000);
const hx = (h: { q: number; r: number }) => `(${h.q}, ${h.r})`;

export function PlayPage({ id }: { id: string | null }) {
  useLang();
  const [options, setOptions] = useState<LabOptions | null>(null);
  useEffect(() => {
    api.options().then(setOptions, () => setOptions(null));
  }, []);
  if (!options) return <p className="muted">{tr('Reading the lab options…', 'Читаю налаштування лабораторії…')}</p>;
  return id ? <Game key={id} id={id} /> : <NewGame options={options} />;
}

/* ===== a new game ===== */

function NewGame({ options }: { options: LabOptions }) {
  const [seed, setSeed] = useState(randomSeed);
  const [ticks, setTicks] = useState(1200);
  const [seat, setSeat] = useState<0 | 1 | 2>(0);
  const strongest: [SeatSpec, SeatSpec] = [
    { kind: 'mix', name: 'e=ours,k=a2' },
    { kind: 'mix', name: 'e=a4,k=a3' },
  ];
  const [opponents, setOpponents] = useState<[SeatSpec, SeatSpec]>(strongest);
  const [advisor, setAdvisor] = useState<SeatSpec>({ kind: 'ours', name: options.defaultPreset });
  const [withAdvisor, setWithAdvisor] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [games, setGames] = useState<PlayState[]>([]);

  useEffect(() => {
    api.games().then(setGames, () => setGames([]));
  }, []);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const s = await api.startGame({ seed, ticks, seat, opponents, advisor: withAdvisor ? advisor : null });
      location.hash = '#/play/' + s.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStarting(false);
    }
  };

  return (
    <>
      <section className="card">
        <h2>{tr('Play against the bots', 'Зіграти проти ботів')}</h2>
        <p className="muted">
          {tr(
            'You take one seat of a match; the other two are bots. The match waits for your move on every decision tick. The advisor is a bot that sits in your seat\'s shadow, sees exactly what you see and proposes its orders with a reason.',
            'Ви сідаєте на одне місце партії, два інші - боти. Партія чекає вашого ходу на кожному такті рішення. Порадник - бот у тіні вашого місця: бачить рівно те, що й ви, і пропонує свої команди з поясненням.',
          )}
        </p>
        <div className="form">
          <label className="field">
            <span>{tr('valley lot', 'жереб долини')}</span>
            <span className="row">
              <input type="number" value={seed} onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: 110 }} />
              <button onClick={() => setSeed(randomSeed())}>{tr('random', 'випадковий')}</button>
            </span>
          </label>
          <label className="field">
            <span>{tr('ticks per match', 'тактів у партії')}</span>
            <select value={ticks} onChange={(e) => setTicks(Number(e.target.value))}>
              <option value={1200}>1200 ({tr('full', 'повна')})</option>
              <option value={600}>600</option>
              <option value={300}>300</option>
              <option value={120}>120 ({tr('a quick try', 'швидка спроба')})</option>
            </select>
          </label>
          <label className="field">
            <span>{tr('my seat', 'моє місце')}</span>
            <select value={seat} onChange={(e) => setSeat(Number(e.target.value) as 0 | 1 | 2)}>
              {SLOTS.map((s, i) => (
                <option key={s} value={i}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <h3>{tr('Opponents', 'Суперники')}</h3>
        <p className="muted">
          {tr('By default - the two strongest combinations of the 04-06.10 measurements: our economy + a2 Klinoks, and a4 economy + a3 Klinoks.', 'Типово - дві найсильніші комбінації перемірів 04-06.10: наша економіка + клинки a2 і економіка a4 + клинки a3.')}{' '}
          <button className="mini" onClick={() => setOpponents(strongest)}>
            {tr('the strongest', 'найсильніші')}
          </button>
        </p>
        <div className="variants">
          {opponents.map((o, i) => (
            <SeatEditor
              key={i}
              options={options}
              value={o}
              label={`${tr('opponent', 'суперник')} ${i + 1}`}
              onChange={(next) => setOpponents((cur) => (i === 0 ? [next, cur[1]] : [cur[0], next]))}
            />
          ))}
        </div>
        <h3>
          <label>
            <input type="checkbox" checked={withAdvisor} onChange={() => setWithAdvisor(!withAdvisor)} /> {tr('Advisor', 'Порадник')}
          </label>
        </h3>
        {withAdvisor && (
          <>
            <p className="muted">
              {tr(
                'Our battle bot also tells which part of it chose the order (head, tactic, pulse). Any other bot or combination advises too - the reasons are read off the game state.',
                'Наш бойовий бот ще й каже, яка його частина вибрала команду (голова, надбудова, пульс). Порадити може будь-який інший бот чи комбінація - пояснення читаються зі стану гри.',
              )}
            </p>
            <SeatEditor options={options} value={advisor} label={tr('advisor', 'порадник')} onChange={setAdvisor} />
          </>
        )}
        <div className="form" style={{ marginTop: 12 }}>
          <button className="primary" disabled={starting} onClick={() => void start()}>
            {starting ? tr('Starting…', 'Запускаю…') : tr('Start the game', 'Почати гру')}
          </button>
          {error && <span className="error">{error}</span>}
        </div>
      </section>
      {games.length > 0 && (
        <section className="card">
          <h2>{tr('Games in progress', 'Ігри, що тривають')}</h2>
          <table className="grid">
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td>
                    <a href={'#/play/' + g.id}>{g.id}</a>
                  </td>
                  <td>
                    {g.slot ?? '?'} · {g.request.opponents.map((o) => seatText(o, lang())).join(' / ')}
                  </td>
                  <td className="num">
                    {tr('tick', 'такт')} {g.progress} / {g.request.ticks}
                  </td>
                  <td>{statusText(g)}</td>
                  <td>
                    <button
                      className="mini"
                      onClick={() =>
                        void api.closeGame(g.id).then(() => setGames((all) => all.filter((x) => x.id !== g.id)))
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function statusText(s: PlayState): string {
  switch (s.status) {
    case 'starting':
      return tr('starting', 'запускається');
    case 'waiting':
      return tr('your move', 'ваш хід');
    case 'running':
      return tr('playing', 'грає');
    case 'done':
      return tr('over', 'завершено');
    default:
      return tr('failed', 'помилка');
  }
}

/* ===== the game ===== */

const RUNS = [1, 5, 10, 25, 50, 100] as const;

/* what the seat really sees: our units and needles from the truth, the rest - from the observe frame */
function fogged(frame: Frame, sight: Sight, slot: Slot): Frame {
  const mine = frame.u.filter((u) => u[1] === slot);
  const foes: UnitRow[] = sight.foe.map((f) => [f.id, f.p as Actor, f.cls === 'клинок' ? 1 : 0, f.q, f.r, 0, null, null, 0]);
  const ours = new Map(frame.n.filter(([, o]) => o === slot).map((row) => [row[0], row]));
  const n: NeedleRow[] = [...ours.values()];
  for (const e of sight.own) {
    const key = e.q + ',' + e.r;
    if (!e.owner || e.owner === slot || ours.has(key)) continue;
    n.push([key, e.owner as Actor, e.dark ? 0 : 1, 0]);
  }
  return { ...frame, u: [...mine, ...foes], n, heat: frame.heat.filter(([, a]) => a === slot), eye: { [slot]: frame.eye[slot] } };
}

function taskText(u: MineUnit): string {
  const t = u.task;
  if (!t) return tr('idle', 'без задачі');
  if (t.ram) return tr('ramming ', 'таранить ') + t.ram;
  if (t.home) return tr('going home', 'іде додому');
  if (t.site) return tr('building at ', 'будує на ') + hx(t.site);
  if (t.feed) return tr('feeding ', 'живить ') + hx(t.feed);
  if (t.jam) return tr('jamming ', 'глушить ') + hx(t.jam);
  if (t.goal) return (t.path > 0 ? tr('to ', 'до ') : tr('at ', 'на ')) + hx(t.goal);
  return t.path > 0 ? tr('moving', 'рухається') : tr('standing', 'стоїть');
}

function targetOf(o: Order, foe: readonly FoeEntry[]): [number, number] | null {
  switch (o.kind) {
    case 'move':
      return o.goal ? [o.goal.q, o.goal.r] : [o.q, o.r];
    case 'needle':
    case 'feed':
    case 'scan':
    case 'watch':
      return [o.q, o.r];
    case 'jam':
      return o.target ? [o.target.q, o.target.r] : null;
    case 'ram': {
      const f = foe.find((x) => x.id === o.target);
      return f ? [f.q, f.r] : null;
    }
    default:
      return null;
  }
}

const unitOfOrder = (o: Order): string | null => ('unit' in o ? o.unit : null);

/* a rival unit as last seen by our seat */
interface Seen {
  id: string;
  p: string;
  cls: string;
  q: number;
  r: number;
  t: number;
}

interface Race {
  ruin: { q: number; r: number };
  /* the tick we can be there; whether our Tkach already heads there */
  ours: number;
  goal: boolean;
  /* the earliest rival and when its first Tkach could be there */
  rival: Slot;
  eta: number;
}

/* the contested ruins, as the bot's scout:N counts them: a ruin we would reach within 40
   ticks and a rival could reach no later than 10 ticks after us. A rival's first Tkach
   leaves its yard on tick 1 + droneBuild and walks a cell per stepTkach ticks */
function races(st: MatchStatic, slot: Slot, t: number, sight: Sight, cfg: Record<string, number>): Race[] {
  const step = cfg['stepTkach'] ?? 2;
  const born = 1 + (cfg['droneBuild'] ?? 4);
  const tkachs = sight.units.filter((u) => u.cls === 'ткач');
  const goals = new Set(tkachs.flatMap((u) => {
    const g = u.task?.site ?? u.task?.goal;
    return g ? [g.q + ',' + g.r] : [];
  }));
  const owned = new Set([...sight.needles.map((n) => n.q + ',' + n.r), ...sight.own.filter((e) => e.owner).map((e) => e.q + ',' + e.r)]);
  const home = st.seats[slot];
  const rivals = SLOTS.filter((s) => s !== slot);
  const out: Race[] = [];
  for (const n of st.needles) {
    if (n.start || n.ring || owned.has(n.k)) continue;
    const ours = tkachs.length ? t + step * Math.min(...tkachs.map((u) => hexDist(u.q, u.r, n.q, n.r))) : t + born + step * hexDist(home.q, home.r, n.q, n.r);
    const eta = rivals.map((s) => ({ s, eta: born + step * hexDist(st.seats[s].q, st.seats[s].r, n.q, n.r) })).sort((a, b) => a.eta - b.eta)[0]!;
    if (ours - t > 40 || eta.eta > ours + 10) continue;
    out.push({ ruin: { q: n.q, r: n.r }, ours, goal: goals.has(n.k), rival: eta.s, eta: eta.eta });
  }
  return out.sort((a, b) => Number(b.goal) - Number(a.goal) || Math.abs(a.ours - a.eta) - Math.abs(b.ours - b.eta)).slice(0, 6);
}

function Game({ id }: { id: string }) {
  const L = useLang();
  const [state, setState] = useState<PlayState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sel, setSel] = useState<string | null>(null);
  const [cell, setCell] = useState<[number, number] | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [pending, setPending] = useState<Order[]>([]);
  const [run, setRun] = useState<number>(1);
  const [autopilot, setAutopilot] = useState(false);
  const [stopEarly, setStopEarly] = useState(true);
  const [fog, setFog] = useState(true);
  const [layers, setLayers] = useState<Layers>({ ...DEFAULT_LAYERS, ids: true });
  const [hold, setHold] = useState(true);
  const [keep, setKeep] = useState(256);
  const [rad, setRad] = useState(2);
  const [phrase, setPhrase] = useState(0);
  const [bid, setBid] = useState({ lot: 0, amount: 40 });
  /* across turns: rival units our seat has seen, and the cells our accepted scans looked at */
  const seenRef = useRef(new Map<string, Seen>());
  const lookedRef = useRef(new Map<string, number>());

  /* the state at opening; if the game is between decisions - wait for the next one */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        let s = await api.game(id);
        if (alive) setState(s);
        while (alive && (s.status === 'running' || s.status === 'starting')) {
          s = await api.game(id, true);
          if (alive) setState(s);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [id]);

  /* the tick reached during a long run */
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => {
      api.games().then(
        (all) => setProgress(all.find((g) => g.id === id)?.progress ?? 0),
        () => undefined,
      );
    }, 500);
    return () => clearInterval(timer);
  }, [busy, id]);

  const turn = state?.turn ?? null;
  const slot = state?.slot ?? null;

  useEffect(() => {
    if (!turn || !slot) return;
    for (const f of turn.sight.foe) if (f.p !== 'K' && f.p !== slot) seenRef.current.set(f.id, { id: f.id, p: f.p, cls: f.cls, q: f.q, r: f.r, t: turn.t });
    for (const v of turn.verdicts) if (v.ok && v.order.kind === 'scan') lookedRef.current.set(v.order.q + ',' + v.order.r, turn.t - 1);
  }, [turn, slot]);
  const st = state?.static ?? null;
  const sight = turn?.sight ?? null;

  const labels = useMemo(() => {
    const out = {} as Record<Slot, string>;
    if (!state) return out;
    const lineup: SeatSpec[] = [{ kind: 'human', name: 'human' }, ...state.request.opponents];
    lineup.forEach((spec, k) => {
      const s = SLOTS[(k + state.request.seat) % 3]!;
      out[s] = k === 0 ? tr('you', 'ви') : seatText(spec, L);
    });
    return out;
  }, [state, L]);

  const record: MatchRecord | null = useMemo(
    () =>
      st && state && slot
        ? {
            v: 1,
            meta: { index: state.request.seat, seed: state.request.seed, ticks: state.request.ticks, engine: '', seating: { A: 0, B: 1, C: 2 }, labels, ours: slot },
            static: st,
            frames: [],
            result: [],
          }
        : null,
    [st, state, slot, labels],
  );

  const frame = useMemo(() => {
    if (!turn?.frame || !sight || !slot) return null;
    return fog ? fogged(turn.frame, sight, slot) : turn.frame;
  }, [turn, sight, slot, fog]);

  if (error) return <p className="error">{error}</p>;
  if (!state) return <p className="muted">{tr('Reading the game…', 'Читаю гру…')}</p>;
  if (state.status === 'failed') {
    return (
      <section className="card">
        <h2>{tr('The game stopped', 'Гра зупинилася')}</h2>
        <p className="error">{state.error}</p>
        <a href="#/play">{tr('← a new game', '← нова гра')}</a>
      </section>
    );
  }
  if (state.status === 'done') return <Finished state={state} labels={labels} />;
  if (!turn || !sight || !slot || !st || !record || !frame) {
    return <p className="muted">{state.status === 'running' ? `${tr('Playing… tick', 'Граю… такт')} ${state.progress}` : tr('Starting the match…', 'Запускаю партію…')}</p>;
  }

  const cfg = state.cfg ?? {};
  const units = sight.units;
  const selected = units.find((u) => u.id === sel) ?? null;
  const hearth = st.seats[slot];
  const foes = sight.foe.filter((f) => f.p !== slot);
  const foeAtCell = cell ? foes.find((f) => f.q === cell[0] && f.r === cell[1]) : undefined;
  const myNeedleAtCell = cell ? sight.needles.some((n) => n.q === cell[0] && n.r === cell[1]) : false;
  /* water and mountains: a move there is rejected with "ground" (the engine's terrain table, pass 0) */
  const cellType = cell ? st.types[st.cells.find(([q, r]) => q === cell[0] && r === cell[1])?.[2] ?? 0] : undefined;
  const blocked = cellType === 'water' || cellType === 'mount';

  /* one order per unit: a new one replaces the unit's previous one */
  const add = (o: Order) => {
    const u = unitOfOrder(o);
    setPending((cur) => [...cur.filter((x) => u === null || unitOfOrder(x) !== u), o]);
  };
  const pickCell = (c: [number, number]) => {
    const own = frame.u.find(([, owner, , q, r]) => owner === slot && q === c[0] && r === c[1]);
    if (own && own[0] !== sel) {
      setSel(own[0]);
      setCell(null);
      return;
    }
    setCell(c);
  };

  const send = async (orders: Order[], ticks: number) => {
    setBusy(true);
    setProgress(turn.t);
    setError(null);
    try {
      let s = await api.act(id, { orders, run: ticks, autopilot, stop: stopEarly });
      while (s.status === 'running') s = await api.game(id, true);
      setState(s);
      setPending([]);
      if (s.turn && sel && !s.turn.sight.units.some((u) => u.id === sel)) setSel(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const marks: { cell: [number, number]; color: string }[] = [];
  if (selected) marks.push({ cell: [selected.q, selected.r], color: '#eeb968' });
  for (const a of turn.advice) {
    const t = targetOf(a.order, sight.foe);
    if (t) marks.push({ cell: t, color: 'rgba(111,210,138,0.9)' });
  }
  for (const o of pending) {
    const t = targetOf(o, sight.foe);
    if (t) marks.push({ cell: t, color: '#ffffff' });
  }
  const contested = races(st, slot, turn.t, sight, cfg);
  for (const race of contested) marks.push({ cell: [race.ruin.q, race.ruin.r], color: '#ff9f43' });
  const visibleNow = new Set(sight.foe.map((f) => f.id));
  const tracked = [...seenRef.current.values()].filter((s) => !visibleNow.has(s.id) && turn.t - s.t <= 30).sort((a, b) => b.t - a.t).slice(0, 6);
  for (const s of tracked) marks.push({ cell: [s.q, s.r], color: ACTOR_COLOR[s.p as Actor] ?? '#ffffff' });
  const scanAt = (q: number, r: number) => add({ kind: 'scan', q, r, rad: cfg['scanRad'] ?? 3 });
  const lookedAgo = (q: number, r: number): string => {
    const at = lookedRef.current.get(q + ',' + r);
    return at === undefined ? '' : `${turn.t - at} ${tr('t ago', 'т тому')}`;
  };

  const left = state.request.ticks - turn.t + 1;
  const runs = [...RUNS.filter((n) => n < left), left];
  const weightMax = cfg['squadWeight'] ?? 8;
  const autonomy = cfg['autonomy'] ?? 40;
  const score = sight.pub.score;

  return (
    <div className="viewer play">
      <section className="left">
        <HexMap
          record={record}
          frame={frame}
          layers={layers}
          focusSlot={slot}
          highlight={cell}
          onHover={setHover}
          onPick={pickCell}
          marks={marks}
        />
        <div className="timeline">
          <div className="controls">
            <span className="tick">
              {tr('tick', 'такт')} <b>{turn.t}</b> / {state.request.ticks}
              {sight.pub.dawn ? ' · ' + tr('dawn', 'зоря') : st.dawn > 0 ? ` · ${tr('dawn at', 'зоря на')} ${st.dawn}` : ''}
            </span>
            <label title={tr('show only what your seat sees, like a bot', 'показувати лише те, що бачить ваше місце, як бот')}>
              <input type="checkbox" checked={fog} onChange={() => setFog(!fog)} /> {tr('fog of war', 'туман війни')}
            </label>
            <label>
              <input type="checkbox" checked={layers.coverage} onChange={() => setLayers({ ...layers, coverage: !layers.coverage })} /> {tr('coverage', 'покриття')}
            </label>
            <label>
              <input type="checkbox" checked={layers.ids} onChange={() => setLayers({ ...layers, ids: !layers.ids })} /> {tr('unit names', 'імена юнитів')}
            </label>
          </div>
          <p className="muted hint">
            {tr(
              'Click your unit to select it, then click a cell: the actions below use both. Green rings - the advisor\'s targets, white - your orders.',
              'Клік по своєму юниту - вибрати його, далі клік по клітині: дії нижче беруть обидва. Зелені кільця - цілі порадника, білі - ваші команди.',
            )}
          </p>
        </div>
        <CellInfo record={record} frame={frame} cell={hover ?? cell} />
        <div className="card compact">
          <div className="actions">
            <b>{selected ? `${selected.id} · ${clsName(selected.cls)}` : tr('no unit selected', 'юнит не вибрано')}</b>
            {cell && <span className="muted">{tr('cell', 'клітина')} {hx({ q: cell[0], r: cell[1] })}</span>}
            {blocked && <span className="error">{tr('impassable: a move here is rejected ("ground")', 'непрохідна: хід сюди воротар відхилить («земля»)')}</span>}
          </div>
          {selected && (
            <div className="actions">
              <button disabled={!cell} onClick={() => cell && add({ kind: 'move', unit: selected.id, q: cell[0], r: cell[1], goal: { q: cell[0], r: cell[1] }, home: false })}>
                {tr('go here', 'іти сюди')}
              </button>
              {selected.cls === 'ткач' && (
                <>
                  <button disabled={!cell} onClick={() => cell && add({ kind: 'needle', unit: selected.id, q: cell[0], r: cell[1] })} title={`${cfg['costNeedle'] ?? 60} ${tr('charge', 'заряду')}`}>
                    {tr('build a needle here', 'будувати тут голку')}
                  </button>
                  <button disabled={!cell || !myNeedleAtCell} onClick={() => cell && add({ kind: 'feed', unit: selected.id, q: cell[0], r: cell[1] })}>
                    {tr('feed this needle', 'живити цю голку')}
                  </button>
                </>
              )}
              {selected.cls === 'клинок' && (
                <>
                  <button disabled={!cell} onClick={() => cell && add({ kind: 'jam', unit: selected.id, target: { q: cell[0], r: cell[1] }, hold })}>
                    {tr('jam this needle', 'глушити цю голку')}
                  </button>
                  <label>
                    <input type="checkbox" checked={hold} onChange={() => setHold(!hold)} /> {tr('hold', 'стояти')}
                  </label>
                  <button disabled={!foeAtCell} onClick={() => foeAtCell && add({ kind: 'ram', unit: selected.id, target: foeAtCell.id })}>
                    {tr('ram the unit here', 'таранити юнит тут')}
                    {foeAtCell ? ` ${foeAtCell.id}` : ''}
                  </button>
                </>
              )}
              <button onClick={() => add({ kind: 'move', unit: selected.id, q: hearth.q, r: hearth.r, goal: null, home: true })}>{tr('home', 'додому')}</button>
              <button onClick={() => add({ kind: 'halt', unit: selected.id })}>{tr('halt', 'стоп')}</button>
            </div>
          )}
          {selected?.cls === 'клинок' && foes.length > 0 && (
            <div className="actions">
              <span className="muted">{tr('ram:', 'таран:')}</span>
              {[...foes]
                .sort((a, c) => hexDist(selected.q, selected.r, a.q, a.r) - hexDist(selected.q, selected.r, c.q, c.r))
                .slice(0, 6)
                .map((f) => (
                  <button key={f.id} className="mini" style={{ color: ACTOR_COLOR[f.p as Actor] }} onClick={() => add({ kind: 'ram', unit: selected.id, target: f.id })}>
                    {f.id} · {clsName(f.cls)} · {hexDist(selected.q, selected.r, f.q, f.r)}
                  </button>
                ))}
            </div>
          )}
          <div className="actions">
            <button onClick={() => add({ kind: 'yard', cls: 'ткач' })} title={`${cfg['costTkach'] ?? 90} ${tr('charge', 'заряду')}`}>
              + {tr('Tkach', 'ткач')}
            </button>
            <button onClick={() => add({ kind: 'yard', cls: 'клинок' })} title={`${cfg['costKlinok'] ?? 50} ${tr('charge', 'заряду')}`}>
              + {tr('Klinok', 'клинок')}
            </button>
            <button disabled={!cell} onClick={() => cell && add({ kind: 'watch', q: cell[0], r: cell[1], keep })}>
              {tr('focus here', 'фокус сюди')}
            </button>
            <input type="number" min={0} max={1200} value={keep} onChange={(e) => setKeep(Math.max(0, Math.min(1200, Math.floor(Number(e.target.value) || 0))))} style={{ width: 64 }} title={tr('ear bytes set aside for a scan (the head uses 256)', 'байтів вух, відкладених на скан (голова бере 256)')} />
            <button disabled={!cell} onClick={() => cell && add({ kind: 'scan', q: cell[0], r: cell[1], rad })}>
              {tr('scan here', 'скан тут')}
            </button>
            <select value={rad} onChange={(e) => setRad(Number(e.target.value))} title={tr('scan radius', 'радіус скану')}>
              {[1, 2, 3].map((r) => (
                <option key={r} value={r}>
                  r{r}
                </option>
              ))}
            </select>
          </div>
          <div className="actions">
            <select value={phrase} onChange={(e) => setPhrase(Number(e.target.value))}>
              {Array.from({ length: CRY_COUNT }, (_, i) => (
                <option key={i} value={i}>
                  {cryText(i)}
                </option>
              ))}
            </select>
            <button onClick={() => add({ kind: 'cry', phrase })}>{tr('cry', 'клич')}</button>
            {SLOTS.filter((s) => s !== slot).map((s) => (
              <span key={s} className="row">
                <button className="mini" onClick={() => add({ kind: 'pact', op: 'offer', to: s })}>
                  {tr('pact →', 'угода →')} {s}
                </button>
                {sight.pact.in.some((p) => p.who === s) && (
                  <button className="mini" onClick={() => add({ kind: 'pact', op: 'accept', to: s })}>
                    {tr('accept', 'прийняти')} {s}
                  </button>
                )}
                {sight.pub.pact.active.some((l) => (l.a === slot && l.b === s) || (l.b === slot && l.a === s)) && (
                  <button className="mini" onClick={() => add({ kind: 'pact', op: 'break', to: s })}>
                    {tr('break', 'розірвати')} {s}
                  </button>
                )}
              </span>
            ))}
            {st.lots.some((lot) => lot.at > turn.t) && (
              <span className="row">
                <select value={bid.lot} onChange={(e) => setBid({ ...bid, lot: Number(e.target.value) })}>
                  {st.lots.map((lot, i) =>
                    lot.at > turn.t ? (
                      <option key={i} value={i}>
                        {tr('lot', 'лот')} {i} ({lot.at})
                      </option>
                    ) : null,
                  )}
                </select>
                <input type="number" min={0} value={bid.amount} onChange={(e) => setBid({ ...bid, amount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} style={{ width: 64 }} />
                <button onClick={() => add({ kind: 'bid', lot: bid.lot, amount: bid.amount })}>{tr('bid', 'ставка')}</button>
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="right">
        <table className="grid">
          <thead>
            <tr>
              <th>{tr('seat', 'місце')}</th>
              <th>{tr('who', 'хто')}</th>
              <th>{tr('score', 'рахунок')}</th>
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((s, i) => (
              <tr key={s} className={s === slot ? 'sel' : ''}>
                <td>
                  <Dot a={s} /> {s}
                </td>
                <td>{labels[s]}</td>
                <td className="num">{fmt(score[i] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="stats-line">
          <span>
            {tr('charge', 'заряд')} <b>{Math.round(sight.pulse.energy)}</b>/{cfg['energyCap'] ?? 360}
          </span>
          <span>
            {tr('channel', 'канал')} <b>{sight.pulse.chan}</b>/{sight.pulse.chanAt}
          </span>
          <span>
            {tr('ears', 'вуха')} <b>{sight.pulse.ear}</b>/{sight.pulse.earAt}
          </span>
          <span>
            {tr('needles', 'голки')} <b>{sight.needles.filter((n) => !n.dark).length}</b>/{sight.needles.length}
          </span>
          <span>
            {tr('swarm', 'рій')} <b>{turn.weight}</b>/{weightMax}
          </span>
          <span>
            {tr('minutes', 'хвилини')} <b>{fmt(sight.pulse.minutes)}</b>
          </span>
        </div>

        {turn.note && <p className="note">{txt(turn.note)}</p>}

        <div className="card compact">
          <h3>
            {tr('Advisor', 'Порадник')}
            {state.request.advisor ? <span className="muted"> · {seatText(state.request.advisor, L)}</span> : null}
          </h3>
          {!state.request.advisor && <p className="muted">{tr('No advisor in this game.', 'У цій грі без порадника.')}</p>}
          {state.request.advisor && turn.advice.length === 0 && <p className="muted">{tr('The advisor would stay silent this tick.', 'Порадник цього такту промовчав би.')}</p>}
          <ol className="advice">
            {turn.advice.map((a, i) => (
              <li key={i}>
                <div className="row">
                  <span className="cmd">{orderText(a.order as unknown as Record<string, unknown>)}</span>
                  <button className="mini" onClick={() => add(a.order)}>
                    {tr('take', 'взяти')}
                  </button>
                </div>
                <div className="why">{txt(a.why)}</div>
              </li>
            ))}
          </ol>
          {turn.advice.length > 0 && (
            <button onClick={() => setPending(turn.advice.map((a) => a.order))}>{tr('take all the advice', 'взяти всі поради')}</button>
          )}
        </div>

        <div className="card compact">
          <h3>{tr('Rival forecast', 'Прогноз суперників')}</h3>
          <p className="muted hint">
            {tr(
              'Ruins we would race a rival for (orange on the map): when we and the earliest rival could get there. A rival\'s first Tkach leaves its yard about tick 5 and walks a cell per 2 ticks. Scan a ruin once the rival could be near it; a seen rival Tkach stays inside a radius-3 scan for 3-5 ticks, a Klinok for 2-3.',
              'Руїни, за які ми змагаємося з суперником (помаранчеві на карті): коли можемо бути там ми і найшвидший суперник. Перший ткач суперника виходить із двору близько 5-го такту і йде клітину за 2 такти. Скануйте руїну, щойно суперник може бути поруч; побаченого ткача скан радіусом 3 тримає 3-5 тактів, клинка - 2-3.',
            )}
          </p>
          {contested.length === 0 && <p className="muted">{tr('No contested ruins within 40 ticks.', 'Спірних руїн у найближчі 40 тактів немає.')}</p>}
          {contested.length > 0 && (
            <table className="grid">
              <thead>
                <tr>
                  <th>{tr('ruin', 'руїна')}</th>
                  <th>{tr('we', 'ми')}</th>
                  <th>{tr('rival', 'суперник')}</th>
                  <th>{tr('looked', 'дивились')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contested.map((race) => (
                  <tr key={race.ruin.q + ',' + race.ruin.r}>
                    <td>
                      {hx(race.ruin)}
                      {race.goal ? <b className="tag">{tr('our goal', 'наша ціль')}</b> : null}
                    </td>
                    <td className="num">~{race.ours}</td>
                    <td className={'num' + (turn.t >= race.eta ? ' bad' : '')} title={turn.t >= race.eta ? tr('the rival may already be there', 'суперник уже може бути там') : undefined}>
                      <Dot a={race.rival} /> ~{race.eta}
                    </td>
                    <td className="muted">{lookedAgo(race.ruin.q, race.ruin.r)}</td>
                    <td>
                      <button className="mini" onClick={() => scanAt(race.ruin.q, race.ruin.r)}>
                        {tr('scan', 'скан')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tracked.length > 0 && (
            <>
              <h3>{tr('Rivals seen', 'Побачені суперники')}</h3>
              <table className="grid">
                <tbody>
                  {tracked.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Dot a={s.p as Actor} /> {s.id}
                      </td>
                      <td>{clsName(s.cls)}</td>
                      <td className="num">{hx(s)}</td>
                      <td className="muted">
                        {turn.t - s.t} {tr('t ago', 'т тому')}
                      </td>
                      <td>
                        <button className="mini" onClick={() => scanAt(s.q, s.r)}>
                          {tr('scan there', 'скан туди')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="card compact">
          <h3>{tr('My units', 'Мої юніти')}</h3>
          {units.length === 0 && <p className="muted">{tr('No units yet: order a Tkach in the yard.', 'Юнитів ще немає: замовте ткача у дворі.')}</p>}
          <table className="grid units">
            <tbody>
              {units.map((u) => (
                <tr key={u.id} className={u.id === sel ? 'sel' : ''} onClick={() => setSel(u.id === sel ? null : u.id)}>
                  <td>{u.id}</td>
                  <td>{clsName(u.cls)}</td>
                  <td className="num">{hx(u)}</td>
                  <td>{taskText(u)}</td>
                  <td className={'num' + (u.away > autonomy - 8 ? ' bad' : '')} title={tr('ticks out of the network / leash', 'тактів поза мережею / повідець')}>
                    {u.away > 0 ? `${u.away}/${autonomy}` : ''}
                  </td>
                  <td className="muted">
                    {u.wait > 0 ? tr('mid-step', 'у кроці') : ''}
                    {u.mute ? ' ' + tr('no hands', 'без рук') : ''}
                    {u.stuck ? ' ' + tr('stuck', 'застряг') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card compact">
          <h3>{tr('My orders for this tick', 'Мої команди на цей такт')}</h3>
          {pending.length === 0 && (
            <p className="muted">
              {tr('None - units keep their tasks. Six silent ticks in a row and the nakaz would take the slot, so a free keep-alive goes out by itself.', 'Немає - юніти продовжують свої задачі. Шість тихих тактів поспіль - і слот узяв би наказ, тож безкоштовна підтримка слоту піде сама.')}
            </p>
          )}
          <ol className="log">
            {pending.map((o, i) => (
              <li key={i}>
                <span className="cmd">{orderText(o as unknown as Record<string, unknown>)}</span>
                <button className="mini" onClick={() => setPending(pending.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <div className="actions">
            <label>
              {tr('play', 'грати')}{' '}
              <select value={Math.min(run, left)} onChange={(e) => setRun(Number(e.target.value))}>
                {runs.map((n) => (
                  <option key={n} value={n}>
                    {n === left && n > 1 ? `${n} (${tr('to the end', 'до кінця')})` : n}
                  </option>
                ))}
              </select>{' '}
              {tr('tick(s)', 'такт(ів)')}
            </label>
            <label title={tr('the advisor plays the ticks after this one', 'такти після цього грає порадник')}>
              <input type="checkbox" checked={autopilot} disabled={!state.request.advisor} onChange={() => setAutopilot(!autopilot)} /> {tr('advisor at the wheel', 'кермо - порадникові')}
            </label>
            <label title={tr('stop early on a loss, a captured needle, a new unit, dawn or a rejection', 'зупинитися раніше на втраті, захопленій голці, новому юниті, зорі чи відмові')}>
              <input type="checkbox" checked={stopEarly} onChange={() => setStopEarly(!stopEarly)} /> {tr('stop on events', 'зупинка на подіях')}
            </label>
          </div>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => void send(pending, Math.min(run, left))}>
              {busy ? `${tr('playing… tick', 'граю… такт')} ${progress}` : tr('send and play', 'надіслати й грати')}
            </button>
            {pending.length > 0 && <button onClick={() => setPending([])}>{tr('clear', 'очистити')}</button>}
          </div>
        </div>

        {turn.verdicts.length > 0 && (
          <div className="card compact">
            <h3>{tr('Gatekeeper on my last frame', 'Воротар про мій останній кадр')}</h3>
            <ol className="log">
              {turn.verdicts.map((v, i) => (
                <li key={i} className={v.ok ? '' : 'denied'}>
                  <span className={'cmd' + (v.ok ? '' : ' denied')}>
                    {v.ok ? '✓ ' : '✗ '}
                    {orderText(v.order as unknown as Record<string, unknown>)}
                    {!v.ok && <b> - {denyWord(v.code)}</b>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {sight.events.length > 0 && (
          <div className="card compact">
            <h3>{tr('What happened last tick', 'Що сталося минулого такту')}</h3>
            <ol className="log">
              {sight.events.map((e, i) => (
                <li key={i}>{eventText(e as unknown as Record<string, unknown>)}</li>
              ))}
            </ol>
          </div>
        )}
        <p>
          <button
            className="mini"
            onClick={() => {
              if (confirm(tr('Close this game? It will not be saved.', 'Закрити цю гру? Її не буде збережено.'))) void api.closeGame(id).then(() => (location.hash = '#/play'));
            }}
          >
            {tr('close the game', 'закрити гру')}
          </button>
        </p>
      </section>
    </div>
  );
}

function Finished({ state, labels }: { state: PlayState; labels: Record<Slot, string> }) {
  const rows = [...(state.result ?? [])].sort((a, b) => a.place - b.place);
  return (
    <section className="card">
      <h2>{tr('The match is over', 'Партію завершено')}</h2>
      <table className="grid">
        <thead>
          <tr>
            <th>{tr('place', 'місце')}</th>
            <th>{tr('who', 'хто')}</th>
            <th>{tr('share', 'частка')}</th>
            <th>{tr('score', 'рахунок')}</th>
            <th>{tr('needles', 'голки')}</th>
            <th>{tr('rejections', 'відмов')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slot} className={r.slot === state.slot ? 'sel' : ''}>
              <td>{r.place}</td>
              <td>
                <Dot a={r.slot} /> {r.slot} · {labels[r.slot]}
              </td>
              <td className="num">{r.share}</td>
              <td className="num">{fmt(r.score)}</td>
              <td className="num">{r.lit}</td>
              <td className="num">{r.denials}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        {state.runId && <a href={`#/run/${state.runId}/1`}>{tr('watch the match in the viewer →', 'переглянути партію у переглядачі →')}</a>}{' '}
        <a href="#/play">{tr('a new game', 'нова гра')}</a>
      </p>
    </section>
  );
}
