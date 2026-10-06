/* Participant choice: our bot (head preset and tactics), an SDK archetype, a nakaz sample, our nakaz,
   an external bot or a mixed one. */

import { tr } from '../lib/i18n.ts';
import type { LabOptions, SeatKind, SeatSpec } from '../../shared/record.ts';

/* our bot's tactics as form fields */
interface TacticForm {
  fill: boolean;
  charter: string;
  after: number;
  noPact: boolean;
  /* scout:N - early scans at the rivals (bot/src/tactics.ts); null - off */
  scout: number | null;
}

/* unset - the battle's default tactics */
function readTactics(tactics: readonly string[] | undefined, defaults: readonly string[]): TacticForm {
  const out: TacticForm = { fill: false, charter: 'own', after: 6, noPact: false, scout: null };
  for (const t of tactics ?? defaults) {
    const [what, charter, after] = t.split(':');
    if (what === 'nopact') out.noPact = true;
    if (what === 'scout' && charter) out.scout = Number(charter) || null;
    if (what === 'fill' && charter) Object.assign(out, { fill: true, charter: charter === 'наш' ? 'own' : charter, after: Number(after ?? 0) || 0 });
  }
  return out;
}

/* tactics the form doesn't show (nofeed, k0, ram): rewriting the form, we don't lose them */
const keepOthers = (tactics: readonly string[]): string[] => tactics.filter((t) => !['fill', 'nopact', 'none', 'scout'].includes(t.split(':')[0]!));

/* everything off - an explicit none: without the field the bot would play with the defaults */
function writeTactics(f: TacticForm, others: readonly string[]): string[] {
  const out: string[] = [...others];
  if (f.fill) out.push(f.after > 0 ? `fill:${f.charter}:${f.after}` : `fill:${f.charter}`);
  if (f.noPact) out.push('nopact');
  if (f.scout) out.push(`scout:${f.scout}`);
  return out.length ? out : ['none'];
}

/* the mixed bot a new mixed seat starts from: the leader of the 04.10 measurement */
const DEFAULT_MIX = 'e=ours,k=a2';

/* a mixed bot's two sources: "ours" is our mirror head (полудень) with the battle tactics */
function MixSources({ sources, name, onChange }: { sources: readonly string[]; name: string; onChange: (name: string) => void }) {
  const parts = Object.fromEntries(name.split(',').map((x) => x.split('=') as [string, string]));
  const e = parts['e'] ?? 'ours';
  const k = parts['k'] ?? 'ours';
  const pick = (value: string, set: (v: string) => void) => (
    <select value={sources.includes(value) ? value : 'ours'} onChange={(ev) => set(ev.target.value)}>
      {sources.map((s) => (
        <option key={s} value={s}>
          {s === 'ours' ? tr('ours (полудень)', 'наш (полудень)') : s}
        </option>
      ))}
    </select>
  );
  return (
    <div className="tactics">
      <label title={tr('Tkachs, yard, bidding, scan, pacts, cries', 'ткачі, двір, торги, скан, угоди, кличі')}>
        {tr('economy', 'економіка')} {pick(e, (v) => onChange(`e=${v},k=${k}`))}</label>
      <label title={tr('Klinok orders: rams, jams, guards', 'команди клинків: тарани, глушіння, варта')}>
        {tr('Klinoks', 'клинки')} {pick(k, (v) => onChange(`e=${e},k=${v}`))}</label>
    </div>
  );
}

export function SeatEditor({ options, value, onChange, label }: { options: LabOptions; value: SeatSpec; onChange: (s: SeatSpec) => void; label: string }) {
  const encode = (s: SeatSpec) => s.kind + ':' + s.name;
  const tactics = readTactics(value.tactics, options.defaultTactics);
  const setTactics = (next: Partial<TacticForm>) => {
    const t = writeTactics({ ...tactics, ...next }, keepOthers(value.tactics ?? options.defaultTactics));
    /* same as the defaults - no field: the label "default tactics", as in battle */
    onChange(t.join(',') === options.defaultTactics.join(',') ? { kind: value.kind, name: value.name } : { ...value, tactics: t });
  };
  return (
    <div className="seat">
      <label className="field">
        <span>{label}</span>
        <select
          value={encode(value)}
          onChange={(e) => {
            const [kind, ...rest] = e.target.value.split(':');
            const next: SeatSpec = { kind: kind as SeatKind, name: rest.join(':') };
            if (next.kind === 'ours' && value.kind === 'ours' && value.tactics) next.tactics = value.tactics;
            onChange(next);
          }}
        >
          <optgroup label={tr('our bot (archetype head + pulse)', 'наш бот (голова архетипу + пульс)')}>
            {options.presets.map((p) => (
              <option key={p} value={'ours:' + p}>
                {tr('our bot', 'наш бот')} · {p}
                {p === options.defaultPreset ? tr(' (battle)', ' (бій)') : ''}
              </option>
            ))}
          </optgroup>
          <optgroup label={tr('SDK archetype (mirror)', 'архетип SDK (дзеркало)')}>
            {options.archetypes.map((p) => (
              <option key={p} value={'archetype:' + p}>
                {tr('archetype', 'архетип')} · {p}
              </option>
            ))}
          </optgroup>
          <optgroup label={tr('nakaz', 'наказ')}>
            <option value="our-nakaz:nakaz.yaml">{tr('our nakaz (bot/nakaz.yaml)', 'наш наказ (bot/nakaz.yaml)')}</option>
            {options.nakaz.map((p) => (
              <option key={p} value={'nakaz:' + p}>
                {tr('nakaz sample', 'зразок наказу')} · {p}
              </option>
            ))}
          </optgroup>
          {options.ext.length > 0 && (
            <optgroup label={tr('external bot (lab/ext)', 'зовнішній бот (lab/ext)')}>
              {options.ext.map((p) => (
                <option key={p} value={'ext:' + p}>
                  {tr('external', 'зовнішній')} · {p}
                </option>
              ))}
            </optgroup>
          )}
          {options.ext.length > 0 && (
            <optgroup label={tr('mixed bot (economy of one, Klinoks of another)', 'збірний бот (економіка одного, клинки іншого)')}>
              <option value={value.kind === 'mix' ? encode(value) : 'mix:' + DEFAULT_MIX}>{tr('mixed', 'збірний')} · {value.kind === 'mix' ? value.name : DEFAULT_MIX}</option>
            </optgroup>
          )}
        </select>
      </label>
      {value.kind === 'mix' && <MixSources sources={['ours', 'ours@scout:200', ...options.ext]} name={value.name} onChange={(name) => onChange({ kind: 'mix', name })} />}
      {value.kind === 'ours' && (
        <div className="tactics">
          <label title={tr('the head is silent - a nakaz inside the bot gives orders; the slot stays with the bot', 'голова мовчить - команди дає наказ усередині бота; слот лишається за ботом')}>
            <input type="checkbox" checked={tactics.fill} onChange={() => setTactics({ fill: !tactics.fill })} /> {tr('fill idle time', 'заповнювати простій')}
          </label>
          {tactics.fill && (
            <>
              <select value={tactics.charter} onChange={(e) => setTactics({ charter: e.target.value })}>
                {options.charters.map((c) => (
                  <option key={c} value={c}>
                    {c === 'own' ? tr('our nakaz', 'наш наказ') : c}
                  </option>
                ))}
              </select>
              <label title={tr("how many ticks of the head's silence to wait before the nakaz speaks", 'скільки тактів мовчання голови чекати, перш ніж говорить наказ')}>
                {tr('after', 'після')}{' '}
                <input
                  type="number"
                  min={0}
                  max={1200}
                  value={tactics.after}
                  onChange={(e) => setTactics({ after: Math.max(0, Math.min(1200, Math.floor(Number(e.target.value) || 0))) })}
                  style={{ width: 60 }}
                />{' '}
                {tr('ticks', 'тактів')}
              </label>
            </>
          )}
          <label title={tr("never offer or accept pacts: the tax is 10% of every tick's income", 'не пропонувати і не приймати угод: податок - 10% доходу кожного такту')}>
            <input type="checkbox" checked={tactics.noPact} onChange={() => setTactics({ noPact: !tactics.noPact })} /> {tr('no pacts', 'без угод')}
          </label>
          <label title={tr('scout:N - for the first N ticks the scans go to the rivals (tracking the units seen, then the contested ruins) instead of blips next to us', 'scout:N - перші N тактів скани йдуть до суперників (стеження за побаченими юнитами, далі спірні руїни), а не за відлунням поруч із нами')}>
            <input type="checkbox" checked={tactics.scout !== null} onChange={() => setTactics({ scout: tactics.scout === null ? 200 : null })} /> {tr('scout the rivals', 'розвідка суперників')}
          </label>
          {tactics.scout !== null && (
            <label>
              {tr('for', 'перші')}{' '}
              <input
                type="number"
                min={1}
                max={1200}
                value={tactics.scout}
                onChange={(e) => setTactics({ scout: Math.max(1, Math.min(1200, Math.floor(Number(e.target.value) || 1))) })}
                style={{ width: 64 }}
              />{' '}
              {tr('ticks', 'тактів')}
            </label>
          )}
        </div>
      )}
    </div>
  );
}
