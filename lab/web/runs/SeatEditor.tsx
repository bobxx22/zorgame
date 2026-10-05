/* Participant choice: our bot (head preset and tactics), an SDK archetype, a nakaz sample or our nakaz. */

import type { LabOptions, SeatKind, SeatSpec } from '../../shared/record.ts';

/* our bot's tactics as form fields */
interface TacticForm {
  fill: boolean;
  charter: string;
  after: number;
  noPact: boolean;
}

/* unset - the battle's default tactics */
function readTactics(tactics: readonly string[] | undefined, defaults: readonly string[]): TacticForm {
  const out: TacticForm = { fill: false, charter: 'own', after: 6, noPact: false };
  for (const t of tactics ?? defaults) {
    const [what, charter, after] = t.split(':');
    if (what === 'nopact') out.noPact = true;
    if (what === 'fill' && charter) Object.assign(out, { fill: true, charter: charter === 'наш' ? 'own' : charter, after: Number(after ?? 0) || 0 });
  }
  return out;
}

/* tactics the form doesn't show (nofeed, k0, ram): rewriting the form, we don't lose them */
const keepOthers = (tactics: readonly string[]): string[] => tactics.filter((t) => !['fill', 'nopact', 'none'].includes(t.split(':')[0]!));

/* everything off - an explicit none: without the field the bot would play with the defaults */
function writeTactics(f: TacticForm, others: readonly string[]): string[] {
  const out: string[] = [...others];
  if (f.fill) out.push(f.after > 0 ? `fill:${f.charter}:${f.after}` : `fill:${f.charter}`);
  if (f.noPact) out.push('nopact');
  return out.length ? out : ['none'];
}

/* the mixed bot a new mixed seat starts from: the leader of the 04.10 measurement */
const DEFAULT_MIX = 'e=ours,k=a2';

/* a mixed bot's two sources: "ours" is our battle bot with the default tactics */
function MixSources({ sources, name, onChange }: { sources: readonly string[]; name: string; onChange: (name: string) => void }) {
  const parts = Object.fromEntries(name.split(',').map((x) => x.split('=') as [string, string]));
  const e = parts['e'] ?? 'ours';
  const k = parts['k'] ?? 'ours';
  const pick = (value: string, set: (v: string) => void) => (
    <select value={sources.includes(value) ? value : 'ours'} onChange={(ev) => set(ev.target.value)}>
      {sources.map((s) => (
        <option key={s} value={s}>
          {s === 'ours' ? 'ours (battle)' : s}
        </option>
      ))}
    </select>
  );
  return (
    <div className="tactics">
      <label title="Tkachs, yard, bidding, scan, pacts, cries">economy {pick(e, (v) => onChange(`e=${v},k=${k}`))}</label>
      <label title="Klinok orders: rams, jams, guards">Klinoks {pick(k, (v) => onChange(`e=${e},k=${v}`))}</label>
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
          <optgroup label="our bot (archetype head + pulse)">
            {options.presets.map((p) => (
              <option key={p} value={'ours:' + p}>
                our bot · {p}
                {p === options.defaultPreset ? ' (battle)' : ''}
              </option>
            ))}
          </optgroup>
          <optgroup label="SDK archetype (mirror)">
            {options.archetypes.map((p) => (
              <option key={p} value={'archetype:' + p}>
                archetype · {p}
              </option>
            ))}
          </optgroup>
          <optgroup label="nakaz">
            <option value="our-nakaz:nakaz.yaml">our nakaz (bot/nakaz.yaml)</option>
            {options.nakaz.map((p) => (
              <option key={p} value={'nakaz:' + p}>
                nakaz sample · {p}
              </option>
            ))}
          </optgroup>
          {options.ext.length > 0 && (
            <optgroup label="external bot (lab/ext)">
              {options.ext.map((p) => (
                <option key={p} value={'ext:' + p}>
                  external · {p}
                </option>
              ))}
            </optgroup>
          )}
          {options.ext.length > 0 && (
            <optgroup label="mixed bot (economy of one, Klinoks of another)">
              <option value={value.kind === 'mix' ? encode(value) : 'mix:' + DEFAULT_MIX}>mixed · {value.kind === 'mix' ? value.name : DEFAULT_MIX}</option>
            </optgroup>
          )}
        </select>
      </label>
      {value.kind === 'mix' && <MixSources sources={['ours', ...options.ext]} name={value.name} onChange={(name) => onChange({ kind: 'mix', name })} />}
      {value.kind === 'ours' && (
        <div className="tactics">
          <label title="the head is silent - a nakaz inside the bot gives orders; the slot stays with the bot">
            <input type="checkbox" checked={tactics.fill} onChange={() => setTactics({ fill: !tactics.fill })} /> fill idle time
          </label>
          {tactics.fill && (
            <>
              <select value={tactics.charter} onChange={(e) => setTactics({ charter: e.target.value })}>
                {options.charters.map((c) => (
                  <option key={c} value={c}>
                    {c === 'own' ? 'our nakaz' : c}
                  </option>
                ))}
              </select>
              <label title="how many ticks of the head's silence to wait before the nakaz speaks">
                after{' '}
                <input
                  type="number"
                  min={0}
                  max={1200}
                  value={tactics.after}
                  onChange={(e) => setTactics({ after: Math.max(0, Math.min(1200, Math.floor(Number(e.target.value) || 0))) })}
                  style={{ width: 60 }}
                />{' '}
                ticks
              </label>
            </>
          )}
          <label title="never offer or accept pacts: the tax is 10% of every tick's income">
            <input type="checkbox" checked={tactics.noPact} onChange={() => setTactics({ noPact: !tactics.noPact })} /> no pacts
          </label>
        </div>
      )}
    </div>
  );
}
